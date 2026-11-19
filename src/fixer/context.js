import { parseArgs } from "node:util";
import { sampleEvent, topIssues } from "../crashlytics.js";
import { summarizeEvent } from "../event.js";
import { readJson, writeJson } from "../files.js";
import { shortTitle } from "../format.js";
import { findRepoDir } from "../repos.js";
import { twinRepo } from "../reviewer/pr.js";

const { values: args } = parseArgs({
  options: {
    payload: { type: "string", default: ".fixer/payload.json" },
    out: { type: "string", default: ".fixer/context.json" },
    "repos-dir": { type: "string", default: ".." },
    config: { type: "string", default: "config/apps.json" },
  },
});

const payload = readJson(args.payload);
const failure = payload?.failure;
if (payload?.source !== "crash-fix-request" || !failure?.appId || !failure?.sourceRepo || !payload.thread_ts) {
  console.error(`${args.payload} no es una solicitud de corrección válida.`);
  process.exit(1);
}
const config = readJson(args.config);
const warnings = [];

// A thread without the Analista's detail has no Crashlytics link: the issue is found by its title.
if (!failure.issueId && failure.version && failure.title) {
  try {
    const issues = await topIssues(failure.appId, failure.version, new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
    const match = issues.find((i) => shortTitle(i.title) === failure.title || i.title === failure.title);
    if (match) Object.assign(failure, { issueId: match.id, crashlyticsUrl: match.uri ?? null });
  } catch (err) {
    warnings.push(`No se pudo buscar el issue en Crashlytics: ${err.message}`);
  }
}

let event = null;
if (failure.issueId) {
  event = await sampleEvent(failure.appId, failure.issueId, failure.version).catch((err) => {
    warnings.push(`Sin evento de muestra de Crashlytics: ${err.message}`);
    return null;
  });
} else warnings.push("No se identificó el issue de Crashlytics: solo hay lo que dice el hilo.");

const repo = (name) => (name ? { name, dir: findRepoDir(name, args["repos-dir"]) } : null);
const twinName = twinRepo(config, failure.sourceRepo);
const context = {
  failure,
  sampleEvent: event ? summarizeEvent(event) : null,
  repos: { app: repo(failure.sourceRepo), twin: repo(twinName) },
  channel: payload.channel,
  thread_ts: payload.thread_ts,
  permalink: payload.permalink ?? null,
  requested_by: payload.requested_by ?? null,
  thread: payload.thread ?? [],
  warnings,
};
writeJson(args.out, context);

for (const w of warnings) console.warn(`Aviso: ${w}`);
const ev = context.sampleEvent;
console.log(`${failure.app} ${failure.version ?? "?"} · \`${failure.title ?? "?"}\` · issue ${failure.issueId ?? "?"}`);
console.log(`Commit de la versión: ${ev?.buildRevision ?? "desconocido"} · frame: ${ev?.blameFrame ?? "?"}`);
console.log(`Repos: ${context.repos.app.dir ?? `${failure.sourceRepo} (no está clonado)`}${twinName ? ` · gemelo ${context.repos.twin.dir ?? `${twinName} (no está clonado)`}` : ""}`);
console.log(`Contexto: ${args.out}`);
