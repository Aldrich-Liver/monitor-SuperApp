import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readJson, writeJson } from "../files.js";
import { applicableGuidelines, isGuideline, ruleMeta } from "./guidelines.js";
import { appForRepo, twinRepo } from "./pr.js";

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

const git = (dir, gitArgs, opts = {}) =>
  execFileSync("git", ["-C", dir, ...gitArgs], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const gitOk = (dir, gitArgs) => {
  try {
    git(dir, gitArgs);
    return true;
  } catch {
    return false;
  }
};

/** The app clone next to the monitor in the Super App environment; cloned on the spot if it is missing. */
function repoDir(name, { clone = true } = {}) {
  for (const dir of [resolve(args["repos-dir"], name), join("/agent/repos", name), join("/workspace", name)]) {
    if (existsSync(join(dir, ".git"))) return dir;
  }
  if (!clone) return null;
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
let baseBranch = payload.pr.base;
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
  git(dir, ["for-each-ref", "--points-at", head, "--format=%(refname:short)", `refs/remotes/${ns}`])
    .split("\n")
    .map((r) => r.slice(ns.length + 1))
    .find((r) => r && r !== "HEAD" && !r.startsWith("pr/")) ?? null;

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

const guidelineFiles = git(dir, ["ls-tree", "-r", "--name-only", head])
  .split("\n")
  .filter(isGuideline)
  .map((path) => ({ path, meta: path.endsWith(".md") ? null : ruleMeta(git(dir, ["show", `${head}:${path}`])) }));
const guidelines = applicableGuidelines(guidelineFiles, files.map((f) => f.path));

let twin = null;
const twinName = twinRepo(config, repo);
if (twinName) {
  twin = { repo: twinName, branch: headBranch, branchExists: null };
  if (headBranch) {
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
  pr: { ...payload.pr, base: baseBranch, head, baseCommit, headBranch, merged },
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
if (twin) console.log(`Rama gemela en ${twin.repo}: ${twin.branchExists === null ? "no se pudo comprobar" : twin.branchExists ? "sí" : "no"}.`);
console.log(`Contexto: ${args.out}`);
