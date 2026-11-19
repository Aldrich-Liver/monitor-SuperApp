import { parseArgs } from "node:util";
import { releaseVersions, topIssues } from "./crashlytics.js";
import { detectApp } from "./detect.js";
import { readJson, writeJson } from "./files.js";

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: "config/apps.json" },
    app: { type: "string" },
    issue: { type: "string" },
    out: { type: "string", default: ".monitor/test-result.json" },
    "no-label": { type: "boolean", default: false },
  },
});

const config = readJson(args.config);
const app = args.app
  ? config.apps.find((a) => a.name === args.app || a.appId === args.app)
  : config.apps.find((a) => a.sourceRepo);
if (!app) {
  console.error(`No existe la app ${args.app} en ${args.config}.`);
  process.exit(1);
}

const now = new Date();
const [latest] = await releaseVersions(app.appId, config.releaseLookbackDays);
if (!latest) {
  console.error(`${app.name} no tiene versiones con datos en Crashlytics.`);
  process.exit(1);
}

let findings = [];
let since;
for (const days of [1, 7]) {
  since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const issues = await topIssues(app.appId, latest.displayName, since);
  const prevAppState = { version: latest.displayName, since, counts: {} };
  ({ findings } = detectApp({ app, prevAppState, version: latest.displayName, since, reset: false, issues }));
  if (args.issue) findings = findings.filter((f) => f.issue.id === args.issue);
  if (findings.length) break;
}
if (!findings.length) {
  console.error(`No hay fallas en ${app.name} ${latest.displayName} en los últimos 7 días para usar en la prueba.`);
  process.exit(1);
}

const result = {
  test: true,
  ...(args["no-label"] ? { testLabel: false } : {}),
  checkedAt: now.toISOString(),
  previousCheckAt: since,
  projectId: config.projectId,
  apps: [{ app: app.name, latestVersion: latest.displayName, status: "prueba" }],
  findings: findings.slice(0, 1),
};
writeJson(args.out, result);
const [f] = result.findings;
console.log(`Prueba: ${f.app} ${f.version} · ${f.issue.title} · ${f.newEvents} eventos desde ${since}`);
const flags = `--result ${args.out} --state .monitor/test-state.json`;
console.log(`Resultado: ${args.out}. Publica con:`);
console.log(`  npm run bugs -- ${flags} && npm run render -- ${flags} --post-with-bot && npm run notify -- ${flags}`);
