import { parseArgs } from "node:util";
import { sampleEvent, topIssues } from "../crashlytics.js";
import { summarizeEvent } from "../event.js";
import { readJson, writeJson } from "../files.js";
import { shortTitle } from "../format.js";
import { findRepoDir } from "../repos.js";
import { fetchPr } from "../reviewer/github.js";
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
const config = readJson(args.config);
const warnings = [];
const repo = (name) => (name ? { name, dir: findRepoDir(name, args["repos-dir"]) } : null);

/**
 * Why the Corrector can't commit on the PR's branch, or null when it can. A fork's branch is out of
 * reach of the repo's token, and a PR from `main` would mean pushing to `main`.
 */
function blocked(pr, github) {
  if (!github) return null;
  if (github.state !== "open") return github.state === "merged" ? "ya se fusionó" : "está cerrado";
  if (github.headRepo && github.headRepo.toLowerCase() !== `${pr.owner}/${pr.repo}`.toLowerCase()) return `viene de un fork (${github.headRepo})`;
  if (!github.headBranch || github.headBranch === "main" || github.headBranch === github.base) return `su rama es \`${github.headBranch ?? "?"}\``;
  return null;
}

async function prContext() {
  const prs = [];
  for (const pr of payload.prs) {
    const github = await fetchPr(pr);
    if (!github) warnings.push(`No se pudo leer ${pr.url} en GitHub; usa git y gh para la rama.`);
    prs.push({ ...pr, dir: findRepoDir(pr.repo, args["repos-dir"]), github, blocked: blocked(pr, github) });
  }
  return {
    source: payload.source,
    prs,
    failure: payload.failure ?? null,
    channel: payload.channel,
    thread_ts: payload.thread_ts,
    permalink: payload.permalink ?? null,
    requested_by: payload.requested_by ?? null,
    request: payload.request ?? null,
    thread: payload.thread ?? [],
    warnings,
  };
}

async function failureContext() {
  const failure = payload.failure;
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

  return {
    failure,
    sampleEvent: event ? summarizeEvent(event) : null,
    repos: { app: repo(failure.sourceRepo), twin: repo(twinRepo(config, failure.sourceRepo)) },
    channel: payload.channel,
    thread_ts: payload.thread_ts,
    permalink: payload.permalink ?? null,
    requested_by: payload.requested_by ?? null,
    thread: payload.thread ?? [],
    warnings,
  };
}

const isPrFix = payload?.source === "pr-fix-request" && payload.prs?.length && payload.thread_ts;
const isFailureFix = payload?.source === "crash-fix-request" && payload.failure?.appId && payload.failure?.sourceRepo && payload.thread_ts;
if (!isPrFix && !isFailureFix) {
  console.error(`${args.payload} no es una solicitud de corrección válida.`);
  process.exit(1);
}

const context = isPrFix ? await prContext() : await failureContext();
writeJson(args.out, context);
for (const w of warnings) console.warn(`Aviso: ${w}`);

if (isPrFix) {
  for (const pr of context.prs) {
    const g = pr.github;
    const review = pr.review ? `revisión: ${pr.review.status}` : "sin revisión en el hilo";
    console.log(`${pr.url} · rama ${g?.headBranch ?? "?"} · de ${g?.author ?? "?"} · ${review}${pr.blocked ? ` · no se puede: ${pr.blocked}` : ""}`);
    console.log(`  Repo: ${pr.dir ?? `${pr.repo} (no está clonado)`}`);
  }
} else {
  const { failure, sampleEvent: ev, repos } = context;
  console.log(`${failure.app} ${failure.version ?? "?"} · \`${failure.title ?? "?"}\` · issue ${failure.issueId ?? "?"}`);
  console.log(`Commit de la versión: ${ev?.buildRevision ?? "desconocido"} · frame: ${ev?.blameFrame ?? "?"}`);
  console.log(`Repos: ${repos.app.dir ?? `${failure.sourceRepo} (no está clonado)`}${repos.twin ? ` · gemelo ${repos.twin.dir ?? `${repos.twin.name} (no está clonado)`}` : ""}`);
}
console.log(`Contexto: ${args.out}`);
