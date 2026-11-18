import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { releaseVersions, sampleEvent, topIssues } from "./crashlytics.js";
import { detectApp, errorFinding, normalizeState } from "./detect.js";
import { summarizeEvent } from "./event.js";

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: "config/apps.json" },
    state: { type: "string", default: ".monitor/state.json" },
    out: { type: "string", default: ".monitor/result.json" },
    "next-state": { type: "string", default: ".monitor/state.next.json" },
  },
});

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`Aviso: ${path} no es JSON válido; se reinicia el estado.`);
    return fallback;
  }
}

function writeJson(path, data, pretty = true) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}

const config = readJson(args.config);
const prevState = normalizeState(readJson(args.state, null));
const now = new Date();
const nextState = { v: 1, apps: { ...prevState.apps }, lastError: prevState.lastError };
const findings = [];
const appStatus = [];
const errors = [];

for (const app of config.apps) {
  try {
    const versions = await releaseVersions(app.appId, config.releaseLookbackDays);
    const watched = versions.slice(0, config.watchLatestVersions);
    const issuesByVersion = {};
    for (const v of watched) {
      issuesByVersion[v.displayName] = await topIssues(app.appId, v.displayName, config.issueLookbackDays);
    }

    const { findings: appFindings, appState } = detectApp({
      app,
      prevAppState: prevState.apps[app.appId],
      versions,
      issuesByVersion,
      now,
      forgetAfterDays: config.forgetIssuesAfterDays,
    });

    for (const f of appFindings) {
      if (f.issue) {
        const event = await sampleEvent(app.appId, f.issue.id, f.version).catch(() => null);
        f.sampleEvent = event ? summarizeEvent(event) : null;
      }
    }

    nextState.apps[app.appId] = appState;
    findings.push(...appFindings);
    appStatus.push({
      app: app.name,
      latestVersion: watched[0]?.displayName ?? null,
      crashFreeUsersPercentage: watched[0]?.metrics.crashFreeUsersPercentage ?? null,
      issuesInLatest: watched[0] ? issuesByVersion[watched[0].displayName].length : 0,
      status: versions.length ? "ok" : "sin datos en Crashlytics",
    });
  } catch (err) {
    errors.push({ app: app.name, message: err.message });
    appStatus.push({ app: app.name, status: `error: ${err.message}` });
  }
}

if (errors.length) {
  const byMessage = new Map();
  for (const e of errors) byMessage.set(e.message, [...(byMessage.get(e.message) ?? []), e]);
  const summary = [...byMessage]
    .map(([message, list]) => `${list.length === config.apps.length ? "Todas las apps" : list.map((e) => e.app).join(", ")}: ${message}`)
    .join("\n");
  const { finding, lastError } = errorFinding(summary, prevState.lastError, now);
  nextState.lastError = lastError;
  if (finding) findings.push(finding);
} else {
  nextState.lastError = null;
}

const result = {
  checkedAt: now.toISOString(),
  projectId: config.projectId,
  apps: appStatus,
  findings,
  stateChanged: JSON.stringify(nextState) !== JSON.stringify(prevState),
};

writeJson(args.out, result);
writeJson(args["next-state"], nextState, false);

const counts = findings.reduce((acc, f) => ({ ...acc, [f.type]: (acc[f.type] ?? 0) + 1 }), {});
console.log(`Revisión ${result.checkedAt}`);
for (const s of appStatus) {
  console.log(`- ${s.app}: ${s.latestVersion ?? "-"} (${s.status}${s.issuesInLatest != null ? `, ${s.issuesInLatest} issues` : ""})`);
}
console.log(`Hallazgos: ${findings.length ? JSON.stringify(counts) : "ninguno"}`);
console.log(`Estado cambió: ${result.stateChanged}`);
console.log(`Resultado: ${args.out} | Estado nuevo: ${args["next-state"]}`);
