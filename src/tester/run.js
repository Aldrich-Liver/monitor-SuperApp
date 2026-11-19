import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readJson, writeJson } from "../files.js";
import { findRepoDir, git, gitOk } from "../repos.js";
import { fetchPr } from "../reviewer/github.js";
import { appForRepo, parsePr } from "../reviewer/pr.js";
import { compileErrors, lintVerdict, parseJunit, parseLint, testStatus } from "./results.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: ".tester/result.json" },
    log: { type: "string", default: ".tester/gradle.log" },
    worktree: { type: "string", default: ".tester/worktree" },
    tasks: { type: "string", default: ":app:testDevDebugUnitTest,:app:lintDevDebug" },
    "timeout-min": { type: "string", default: "15" },
    "repos-dir": { type: "string", default: ".." },
    config: { type: "string", default: "config/apps.json" },
    "include-closed": { type: "boolean", default: false },
  },
});

const TEST_RESULTS = "app/build/test-results/testDevDebugUnitTest";
const LINT_REPORT = "app/build/reports/lint-results-devDebug.xml";
// Gradle runs the PR's code: it gets only what a build needs, never the automation's secrets.
const BUILD_ENV = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TERM", "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "GRADLE_USER_HOME"];

const config = readJson(args.config);
const pr = parsePr(positionals.join(" "));
const started = Date.now();

function finish(result, code = 0) {
  writeJson(args.out, { ...result, pr: { ...pr, ...(result.pr ?? {}) }, durationS: Math.round((Date.now() - started) / 1000) });
  process.exit(code);
}

if (!pr) {
  console.error("Uso: npm run tests:run -- <URL del PR en GitHub>");
  process.exit(1);
}
const app = appForRepo(config, pr.repo);
if (!app) {
  console.error(`${pr.repo} no es un repo de las apps monitoreadas.`);
  process.exit(1);
}
if (!/android/i.test(app.name)) {
  console.log(`${app.name} no compila en la nube (Linux): solo se prueban PRs de Android.`);
  finish({ app: app.name, status: "skipped", reason: "iOS no compila en la nube" });
}

const github = await fetchPr(pr);
if ((github?.state === "closed" || github?.state === "merged") && !args["include-closed"]) {
  console.log(`El PR #${pr.number} ya está ${github.state === "merged" ? "fusionado" : "cerrado"}: no se prueba.`);
  finish({ app: app.name, status: "skipped", reason: "PR cerrado" });
}

let dir = findRepoDir(pr.repo, args["repos-dir"]);
if (!dir) {
  dir = resolve(".tester/repos", pr.repo);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--filter=blob:none", `https://github.com/${pr.owner}/${pr.repo}.git`, dir], { stdio: "inherit" });
  }
}

let originUrl = "";
try {
  originUrl = git(dir, ["remote", "get-url", "origin"]);
} catch {}
const fromOrigin = originUrl.toLowerCase().replace(/\.git$/, "").endsWith(`/${pr.owner}/${pr.repo}`.toLowerCase());
const remote = fromOrigin ? "origin" : `https://github.com/${pr.owner}/${pr.repo}.git`;
const ns = fromOrigin ? "origin" : "pr-source";
const prRef = `refs/remotes/${ns}/pr/${pr.number}`;
const base = github?.base ?? "main";
try {
  git(dir, ["fetch", "--quiet", remote, `+refs/heads/${base}:refs/remotes/${ns}/${base}`, `+refs/pull/${pr.number}/head:${prRef}`]);
} catch (err) {
  const detail = err.stderr?.toString().trim() || err.message;
  console.error(`No se pudo descargar el PR #${pr.number} de ${pr.owner}/${pr.repo}: ${detail}`);
  finish({ app: app.name, status: "error", reason: "no se pudo descargar el PR" }, 1);
}
const head = git(dir, ["rev-parse", prRef]);
const baseCommit = gitOk(dir, ["merge-base", `${ns}/${base}`, head]) ? git(dir, ["merge-base", `${ns}/${base}`, head]) : null;
const changedFiles = baseCommit ? git(dir, ["diff", "--name-only", baseCommit, head]).split("\n").filter(Boolean) : [];

const worktree = resolve(args.worktree);
if (existsSync(worktree)) {
  try {
    git(dir, ["worktree", "remove", "--force", worktree]);
  } catch {
    rmSync(worktree, { recursive: true, force: true });
  }
}
git(dir, ["worktree", "prune"]);
mkdirSync(dirname(worktree), { recursive: true });
git(dir, ["worktree", "add", "--force", "--detach", worktree, head]);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), "android-sdk");
if (existsSync(join(dir, "local.properties"))) copyFileSync(join(dir, "local.properties"), join(worktree, "local.properties"));
else writeFileSync(join(worktree, "local.properties"), `sdk.dir=${sdk}\n`);

const env = Object.fromEntries(BUILD_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
env.ANDROID_HOME ??= sdk;
const tasks = args.tasks.split(",").map((t) => t.trim()).filter(Boolean);
const timeoutMs = Number(args["timeout-min"]) * 60 * 1000;
mkdirSync(dirname(resolve(args.log)), { recursive: true });
const logFd = openSync(args.log, "w");

console.log(`PR #${pr.number} de ${pr.repo} (${head.slice(0, 7)}): ./gradlew ${tasks.join(" ")}. Límite: ${args["timeout-min"]} min.`);
const { exitCode, timedOut } = await new Promise((done) => {
  // Its own process group, so a timeout also stops the test JVMs and any forked daemon.
  const child = spawn("./gradlew", ["--no-daemon", "--continue", "--console=plain", ...tasks], {
    cwd: worktree,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, timeoutMs);
  child.on("exit", (code) => {
    clearTimeout(timer);
    done({ exitCode: code ?? 1, timedOut: expired });
  });
  child.on("error", () => {
    clearTimeout(timer);
    done({ exitCode: 1, timedOut: false });
  });
});

const log = readFileSync(args.log, "utf8");
const resultsDir = join(worktree, TEST_RESULTS);
const junit = existsSync(resultsDir)
  ? readdirSync(resultsDir)
      .filter((f) => f.startsWith("TEST-") && f.endsWith(".xml"))
      .map((f) => readFileSync(join(resultsDir, f), "utf8"))
  : [];
const tests = junit.length ? parseJunit(junit) : null;
const lintFile = join(worktree, LINT_REPORT);
const lint = existsSync(lintFile) ? lintVerdict(parseLint(readFileSync(lintFile, "utf8"), worktree), changedFiles) : null;
const status = testStatus({ timedOut, exitCode, tests, lint });

const result = {
  app: app.name,
  pr: { headSha: head, headBranch: github?.headBranch ?? null, title: github?.title ?? null, base },
  status,
  tasks,
  exitCode,
  tests,
  lint,
  compileErrors: status === "build-failed" || status === "error" ? compileErrors(log, worktree) : [],
  changedFiles: changedFiles.length,
  log: args.log,
};

try {
  git(dir, ["worktree", "remove", "--force", worktree]);
} catch {}

const summary = tests ? `${tests.total} pruebas, ${tests.failed} fallidas` : "sin resultados de pruebas";
const lintSummary = lint ? `lint: ${lint.errors} error(es) nuevos, ${lint.previousErrors} previos` : "lint no corrió";
console.log(`Resultado: ${status} · ${summary} · ${lintSummary}. Detalle: ${args.out}`);
finish(result);
