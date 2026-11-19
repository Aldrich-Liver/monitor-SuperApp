import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readJson, writeJson } from "../files.js";
import { findRepoDir, git, gitOk } from "../repos.js";
import { fetchPr } from "./github.js";
import { applicableGuidelines, guidelineKind, needsMeta, ruleMeta } from "./guidelines.js";
import { appForRepo, prUrls, twinRepo } from "./pr.js";

const { values: args } = parseArgs({
  options: {
    payload: { type: "string", default: ".reviewer/payload.json" },
    out: { type: "string", default: ".reviewer/context.json" },
    diff: { type: "string", default: ".reviewer/diff.patch" },
    "repos-dir": { type: "string", default: ".." },
    config: { type: "string", default: "config/apps.json" },
  },
});

const payload = readJson(args.payload);
if (payload?.source !== "pr-review-request" || !payload.pr?.repo || !payload.pr?.number) {
  console.error(`${args.payload} no es una solicitud de revisión válida.`);
  process.exit(1);
}
const config = readJson(args.config);
const { owner, repo, number } = payload.pr;
if (!appForRepo(config, repo)) {
  console.error(`${repo} no es un repo de las apps monitoreadas.`);
  process.exit(1);
}

/** The app clone next to the monitor in the Super App environment; cloned on the spot if it is missing. */
function repoDir(name, { clone = true } = {}) {
  const found = findRepoDir(name, args["repos-dir"]);
  if (found || !clone) return found;
  const dir = resolve(".reviewer/repos", name);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--filter=blob:none", `https://github.com/${owner}/${name}.git`, dir], { stdio: "inherit" });
  }
  return dir;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const dir = repoDir(repo);
// The local clone may be a copy of the repo the PR lives in; the PR and its base come from the PR's own repo.
let originUrl = "";
try {
  originUrl = git(dir, ["remote", "get-url", "origin"]);
} catch {}
const fromOrigin = originUrl.toLowerCase().replace(/\.git$/, "").endsWith(`/${owner}/${repo}`.toLowerCase());
const remote = fromOrigin ? "origin" : `https://github.com/${owner}/${repo}.git`;
const ns = fromOrigin ? "origin" : "pr-source";
const prRef = `refs/remotes/${ns}/pr/${number}`;
try {
  if (git(dir, ["rev-parse", "--is-shallow-repository"]) === "true") git(dir, ["fetch", "--quiet", "--unshallow", "origin"]);
  git(dir, ["fetch", "--quiet", "--prune", remote, `+refs/heads/*:refs/remotes/${ns}/*`, `+refs/pull/${number}/head:${prRef}`]);
} catch (err) {
  const detail = err.stderr?.toString().trim() || err.message;
  if (/couldn't find remote ref/i.test(detail)) fail(`El PR #${number} no existe en ${owner}/${repo}.`);
  fail(
    /not found|could not read|authentication|permission/i.test(detail)
      ? `No tengo acceso a ${owner}/${repo}. Solo puedo revisar PRs de los repos del environment Super App.`
      : `No se pudo descargar el PR #${number} de ${owner}/${repo}: ${detail}`
  );
}

const head = git(dir, ["rev-parse", prRef]);
const github = await fetchPr(payload.pr);
if (!github) console.warn("Sin acceso a la API de GitHub: la revisión no tendrá el título ni la descripción del PR.");
let baseBranch = payload.pr.base;
if (!baseBranch && github?.base && gitOk(dir, ["rev-parse", "--verify", `${ns}/${github.base}`])) baseBranch = github.base;
if (!baseBranch) {
  try {
    baseBranch = git(dir, ["symbolic-ref", "--short", `refs/remotes/${ns}/HEAD`]).replace(/^[^/]+\//, "");
  } catch {
    baseBranch = "main";
  }
}
const baseRef = `${ns}/${baseBranch}`;
if (!gitOk(dir, ["rev-parse", "--verify", baseRef])) fail(`No existe la rama base ${baseBranch} en ${repo}.`);

let baseCommit;
let merged = false;
if (gitOk(dir, ["merge-base", "--is-ancestor", head, baseRef])) {
  merged = true;
  // The commit on the base branch's main line where the PR came in; its first parent is the base before it.
  const entry = git(dir, ["rev-list", "--first-parent", "--ancestry-path", "--reverse", `${head}..${baseRef}`]).split("\n")[0];
  const before = entry && gitOk(dir, ["rev-parse", "--verify", `${entry}^1`]) ? git(dir, ["rev-parse", `${entry}^1`]) : null;
  if (!before || gitOk(dir, ["merge-base", "--is-ancestor", head, before])) {
    fail(`El PR #${number} ya está en ${baseBranch} sin un merge commit; no se puede aislar su cambio.`);
  }
  baseCommit = git(dir, ["merge-base", before, head]);
} else {
  baseCommit = git(dir, ["merge-base", baseRef, head]);
}

const headBranch =
  github?.headBranch ??
  git(dir, ["for-each-ref", "--points-at", head, "--format=%(refname:short)", `refs/remotes/${ns}`])
    .split("\n")
    .map((r) => r.slice(ns.length + 1))
    .find((r) => r && r !== "HEAD" && !r.startsWith("pr/")) ??
  null;

const commits = git(dir, ["log", "--format=%h %s (%an)", "--max-count=50", `${baseCommit}..${head}`]).split("\n").filter(Boolean);
const numstat = new Map(
  git(dir, ["diff", "--numstat", "-M", baseCommit, head])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...path] = line.split("\t");
      return [path.at(-1), { added: Number(added) || 0, removed: Number(removed) || 0 }];
    })
);
const files = git(dir, ["diff", "--name-status", "-M", baseCommit, head])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);
    return { status: status[0], path, ...(paths.length > 1 ? { from: paths[0] } : {}), ...(numstat.get(path) ?? {}) };
  });

const patch = git(dir, ["diff", "-M", baseCommit, head]);
mkdirSync(dirname(args.diff), { recursive: true });
writeFileSync(args.diff, patch + "\n");

// The team's current guidance lives on the base branch; guidance the PR adds or changes is read from the PR.
const listGuides = (ref) => git(dir, ["ls-tree", "-r", "--name-only", ref]).split("\n").filter((path) => guidelineKind(path));
const changed = new Set(files.map((f) => f.path));
const guideRefs = new Map(listGuides(baseRef).map((path) => [path, baseRef]));
for (const path of listGuides(head)) if (!guideRefs.has(path) || changed.has(path)) guideRefs.set(path, head);
const guidelineFiles = [...guideRefs].map(([path, ref]) => ({
  path,
  ref: ref === head ? "pr" : baseBranch,
  meta: needsMeta(path) ? ruleMeta(git(dir, ["show", `${ref}:${path}`])) : null,
}));
const guidelines = applicableGuidelines(guidelineFiles, files.map((f) => f.path));

let twin = null;
const twinName = twinRepo(config, repo);
if (twinName) {
  const linked = prUrls(github?.body).find((p) => p.repo.toLowerCase() === twinName.toLowerCase());
  twin = {
    repo: twinName,
    linkedPr: linked?.url ?? null,
    namedInDescription: github ? (github.body ?? "").toLowerCase().includes(twinName.toLowerCase()) : null,
    branch: headBranch,
    branchExists: null,
  };
  // After a merge the twin branch may already be deleted, so its absence says nothing.
  if (headBranch && !merged && github?.state !== "closed") {
    const twinDir = repoDir(twinName, { clone: false });
    try {
      const refs = twinDir
        ? git(twinDir, ["ls-remote", "--heads", "origin", headBranch])
        : git(".", ["ls-remote", "--heads", `https://github.com/${owner}/${twinName}.git`, headBranch]);
      twin.branchExists = refs.length > 0;
    } catch {
      twin.branchExists = null;
    }
  }
}

const context = {
  pr: {
    ...payload.pr,
    title: github?.title ?? null,
    description: github?.body ?? null,
    author: github?.author ?? null,
    state: github?.state ?? (merged ? "merged" : null),
    draft: github?.draft ?? null,
    base: baseBranch,
    head,
    baseCommit,
    headBranch,
    merged,
  },
  app: payload.app,
  repoDir: dir,
  channel: payload.channel,
  thread_ts: payload.thread_ts,
  requested_by: payload.requested_by,
  via: payload.via,
  thread: payload.thread ?? [],
  commits,
  files,
  totals: {
    files: files.length,
    added: files.reduce((n, f) => n + (f.added ?? 0), 0),
    removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
  },
  diff: args.diff,
  diffBytes: Buffer.byteLength(patch),
  guidelines,
  twin,
};
writeJson(args.out, context);

console.log(`PR #${number} de ${repo}: ${headBranch ?? head.slice(0, 7)} → ${baseBranch}${merged ? " (ya fusionado)" : ""}.`);
console.log(`${files.length} archivo(s), +${context.totals.added} −${context.totals.removed}, ${commits.length} commit(s). Diff: ${args.diff}`);
console.log(`Lineamientos que aplican: ${guidelines.map((g) => g.path).join(", ") || "ninguno"}.`);
if (twin) {
  const branch = twin.branchExists === null ? "no se pudo comprobar" : twin.branchExists ? "sí" : "no";
  console.log(`Gemelo en ${twin.repo}: PR enlazado ${twin.linkedPr ?? "no"}; rama ${branch}.`);
}
console.log(`Contexto: ${args.out}`);
