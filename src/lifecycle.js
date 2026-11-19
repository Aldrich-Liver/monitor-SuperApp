import { parseArgs } from "node:util";
import { ACTIVE, markReleased, mergedPr, prKey, pruneResolved, resolveQuiet, syncPrs, trackFailures } from "./bugs.js";
import { versionEvent } from "./crashlytics.js";
import { normalizeState } from "./detect.js";
import { buildRevision } from "./event.js";
import { readJson, writeJson } from "./files.js";
import { findRepoDir, git, gitOk } from "./repos.js";
import { fetchPr } from "./reviewer/github.js";
import { prUrls } from "./reviewer/pr.js";
import { slackClient } from "./slack.js";

const BUILD_RETRY_MS = 6 * 60 * 60 * 1000;

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    state: { type: "string", default: ".monitor/state.next.json" },
    config: { type: "string", default: "config/apps.json" },
    "repos-dir": { type: "string", default: ".." },
  },
});

const config = readJson(args.config);
const quietHours = config.resolveAfterHours ?? 48;
const result = readJson(args.result);
const state = normalizeState(readJson(args.state, null));
const now = new Date();

const failures = result.findings.filter((f) => f.type === "failure").map((f) => (result.test ? { ...f, test: true } : f));
const tracked = trackFailures(state.bugs, failures, now);
const bugs = tracked.bugs;
const outbox = [...state.outbox, ...tracked.outbox];
for (const key of [...tracked.opened, ...tracked.reopened]) bugs[key].needsAnalysis = true;
for (const key of tracked.reopened) bugs[key].reopenedAt = now.toISOString();

const slack = slackClient();
const textOf = (m) => [m.text ?? "", ...(m.attachments ?? []).map((a) => a.from_url ?? "")].join("\n");

/** PRs of the bug's own app repo linked anywhere in its thread, oldest first. */
async function linkedPrs(bug) {
  const messages = await slack.replies(bug.thread_ts);
  const seen = new Map();
  for (const m of messages) {
    for (const pr of prUrls(textOf(m))) {
      if (pr.repo.toLowerCase() !== bug.sourceRepo.toLowerCase() || seen.has(prKey(pr))) continue;
      seen.set(prKey(pr), { ...pr, linkedAt: new Date(Number(m.ts) * 1000).toISOString(), linkedBy: m.user ?? null });
    }
  }
  return [...seen.values()];
}

async function withGithubState(pr) {
  const gh = await fetchPr(pr).catch(() => null);
  if (!gh) return { ...pr, state: null };
  return { ...pr, title: gh.title, state: gh.state, mergeCommit: gh.mergeCommit, mergedAt: gh.mergedAt };
}

let prChecks = 0;
if (!slack) console.warn("Sin SLACK_BOT_TOKEN o SLACK_CHANNEL: no se buscan PR en los hilos.");
for (const bug of Object.values(bugs)) {
  if (!slack || !ACTIVE.has(bug.status) || !bug.thread_ts || !bug.sourceRepo) continue;
  try {
    const linked = await linkedPrs(bug);
    if (!linked.length && !bug.prs.length) continue;
    prChecks++;
    outbox.push(...syncPrs(bug, await Promise.all(linked.map(withGithubState)), quietHours));
  } catch (err) {
    console.warn(`No se pudieron revisar los PR del hilo de ${bug.key}: ${err.message}`);
  }
}

const fetchedRepos = new Set();
/** Whether the app's latest version includes the commit; null when the commit can't be checked here. */
function includesCommit(repo, revision, commit) {
  const dir = findRepoDir(repo, args["repos-dir"]);
  if (!dir) return null;
  if (!fetchedRepos.has(dir)) {
    fetchedRepos.add(dir);
    try {
      git(dir, ["fetch", "--quiet", "origin"]);
    } catch {}
  }
  for (const sha of [revision, commit]) {
    if (!gitOk(dir, ["cat-file", "-e", `${sha}^{commit}`])) {
      try {
        git(dir, ["fetch", "--quiet", "origin", sha]);
      } catch {
        return null;
      }
    }
  }
  return gitOk(dir, ["merge-base", "--is-ancestor", commit, revision]);
}

async function appBuild(appId) {
  const app = state.apps[appId];
  if (!app?.version) return null;
  const cached = app.build?.version === app.version ? app.build : null;
  if (cached && (cached.revision || now - Date.parse(cached.checkedAt) < BUILD_RETRY_MS)) return cached;
  const event = await versionEvent(appId, app.version).catch((err) => {
    console.warn(`Sin evento de ${app.version} para leer su commit: ${err.message}`);
    return null;
  });
  app.build = { version: app.version, revision: buildRevision(event?.buildStamp), checkedAt: now.toISOString() };
  return app.build;
}

async function releaseOf(bug, pr) {
  const app = state.apps[bug.appId];
  const build = await appBuild(bug.appId);
  if (!build) return null;
  if (build.revision) {
    const included = includesCommit(bug.sourceRepo, build.revision, pr.mergeCommit);
    if (included !== null) return { version: build.version, included, method: "commit" };
  }
  // Without the build commit: a version the monitor first saw after the merge is taken to include it.
  const included = Boolean(app.seenAt && pr.mergedAt && Date.parse(pr.mergedAt) < Date.parse(app.seenAt));
  return { version: build.version, included, method: "date" };
}

for (const bug of Object.values(bugs)) {
  const pr = mergedPr(bug);
  if (!pr) continue;
  try {
    outbox.push(...markReleased(bug, await releaseOf(bug, pr), now, quietHours));
  } catch (err) {
    console.warn(`No se pudo saber si la versión incluye el PR #${pr.number}: ${err.message}`);
  }
}

for (const bug of Object.values(bugs)) outbox.push(...resolveQuiet(bug, now, quietHours));

state.bugs = pruneResolved(bugs, now);
state.outbox = outbox;
writeJson(args.state, state, false);

const byStatus = Object.values(state.bugs).reduce((acc, b) => ({ ...acc, [b.status]: (acc[b.status] ?? 0) + 1 }), {});
console.log(
  `Bugs: ${tracked.opened.length} nuevo(s), ${tracked.reopened.length} reabierto(s); ` +
    `abiertos ${byStatus.open ?? 0}, en corrección ${byStatus.fixing ?? 0}, resueltos ${byStatus.resolved ?? 0}.`
);
console.log(`Hilos con PR revisados: ${prChecks}. Avisos para publicar en hilos: ${outbox.length}.`);
