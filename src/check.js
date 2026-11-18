import { parseArgs } from "node:util";
import { releaseVersions, topIssues } from "./crashlytics.js";
import { countingSince, detectApp, errorFinding, normalizeState, versionChange, versionFinding } from "./detect.js";
import { readJson, writeJson } from "./files.js";

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: "config/apps.json" },
    state: { type: "string", default: ".monitor/state.json" },
    out: { type: "string", default: ".monitor/result.json" },
    "next-state": { type: "string", default: ".monitor/state.next.json" },
  },
});

const config = readJson(args.config);
const prevState = normalizeState(readJson(args.state, null));
const now = new Date();
const nextState = { v: 2, apps: { ...prevState.apps }, lastError: prevState.lastError, lastCheckedAt: now.toISOString() };
const findings = [];
const appStatus = [];
const errors = [];

for (const app of config.apps) {
  try {
    const [latest] = await releaseVersions(app.appId, config.releaseLookbackDays);
    if (!latest) {
      appStatus.push({ app: app.name, latestVersion: null, status: "sin datos en Crashlytics" });
      continue;
    }
    const prevAppState = prevState.apps[app.appId];
    const { since, reset } = countingSince(prevAppState, latest.displayName, now, config.initialLookbackDays);
    const issues = await topIssues(app.appId, latest.displayName, since);
    const { findings: appFindings, appState } = detectApp({
      app,
      prevAppState,
      version: latest.displayName,
      since,
      reset,
      issues,
    });
    nextState.apps[app.appId] = appState;
    findings.push(...appFindings);
    const change = versionChange(prevAppState, latest.displayName);
    appStatus.push({
      app: app.name,
      latestVersion: latest.displayName,
      previousVersion: change === "new" ? prevAppState.version : null,
      change,
      issues: Object.keys(appState.counts).length,
      status: prevAppState ? (change ? `versión nueva (antes ${prevAppState.version})` : "ok") : "primera revisión: solo se registraron los contadores",
      failures: appFindings.length,
    });
  } catch (err) {
    errors.push({ app: app.name, message: err.message });
    appStatus.push({ app: app.name, status: `error: ${err.message}`, error: true });
  }
}

findings.sort((a, b) => b.newEvents - a.newEvents);
const version = versionFinding(appStatus);
if (version) findings.unshift(version);

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
  previousCheckAt: prevState.lastCheckedAt,
  projectId: config.projectId,
  apps: appStatus,
  findings,
};

writeJson(args.out, result);
writeJson(args["next-state"], nextState, false);

const failures = findings.filter((f) => f.type === "failure");
console.log(`Revisión ${result.checkedAt}`);
for (const s of appStatus) console.log(`- ${s.app}: ${s.latestVersion ?? "-"} (${s.status})`);
console.log(`Fallas: ${failures.length}`);
if (version) console.log("Versión nueva: se publicará el mensaje de monitor activo.");
if (findings.some((f) => f.type === "error")) console.log("Error del monitor: se reportará.");
console.log(`Resultado: ${args.out} | Estado nuevo: ${args["next-state"]}`);
