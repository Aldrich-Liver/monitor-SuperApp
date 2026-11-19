import { posix } from "node:path";

const MAX_LISTED = 10;
const MESSAGE_CHARS = 300;

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function decode(text = "") {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrs(text) {
  const out = {};
  for (const m of text.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

const firstLine = (text = "") => text.trim().split("\n")[0].trim();

/** Totals and failed cases of Gradle's JUnit XML reports, one text per `TEST-*.xml` file. */
export function parseJunit(xmlTexts) {
  const result = { total: 0, failed: 0, skipped: 0, failures: [] };
  for (const xml of xmlTexts) {
    for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const tc = attrs(m[1]);
      const inner = m[2] ?? "";
      result.total++;
      if (/<skipped\b/.test(inner)) result.skipped++;
      const failure = inner.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
      if (!failure) continue;
      result.failed++;
      const a = attrs(failure[2]);
      const message = firstLine(a.message || decode(failure[3] ?? "")) || a.type || "sin mensaje";
      const className = (tc.classname ?? "").split(".").pop();
      result.failures.push({ test: `${className}.${tc.name}`, message: truncate(message, MESSAGE_CHARS) });
    }
  }
  return result;
}

function relative(file, rootDir) {
  const root = rootDir.replace(/\/+$/, "") + "/";
  return file.startsWith(root) ? file.slice(root.length) : file;
}

/** Android lint's XML report as a list of issues with paths relative to the repo. */
export function parseLint(xml, rootDir) {
  const issues = [];
  for (const m of xml.matchAll(/<issue\b([\s\S]*?)>([\s\S]*?)<\/issue>/g)) {
    const a = attrs(m[1]);
    const location = m[2].match(/<location\b([\s\S]*?)\/>/);
    const loc = location ? attrs(location[1]) : {};
    issues.push({
      id: a.id,
      severity: a.severity,
      message: truncate(firstLine(a.message), MESSAGE_CHARS),
      file: loc.file ? relative(loc.file, rootDir) : null,
      line: loc.line ? Number(loc.line) : null,
    });
  }
  return issues;
}

const isError = (issue) => issue.severity === "Error" || issue.severity === "Fatal";

/**
 * `main` already carries lint errors, so only the ones in files the PR touches count against it;
 * the rest are reported as previous.
 */
export function lintVerdict(issues, changedFiles) {
  const changed = new Set(changedFiles.map((f) => posix.normalize(f)));
  const errors = issues.filter(isError);
  const fresh = errors.filter((i) => i.file && changed.has(posix.normalize(i.file)));
  return {
    errors: fresh.length,
    previousErrors: errors.length - fresh.length,
    warnings: issues.filter((i) => i.severity === "Warning").length,
    issues: fresh.slice(0, MAX_LISTED),
  };
}

/** Kotlin (`e: file:///…`) and javac (`…: error: …`) compile errors from the Gradle log, first ones only. */
export function compileErrors(log, rootDir) {
  const out = [];
  for (const raw of log.split("\n")) {
    const line = raw.trim();
    let m = line.match(/^e: (?:file:\/\/)?(\S+?):(\d+):\d+ (.+)$/);
    if (!m) m = line.match(/^(\S+\.(?:java|kt)):(\d+): error: (.+)$/);
    if (!m) continue;
    out.push({ file: relative(m[1], rootDir), line: Number(m[2]), message: truncate(m[3], MESSAGE_CHARS) });
    if (out.length >= MAX_LISTED) break;
  }
  if (!out.length) {
    const what = log.match(/\* What went wrong:\n([\s\S]*?)\n\n/);
    if (what) out.push({ file: null, line: null, message: truncate(what[1].replace(/\s+/g, " ").trim(), MESSAGE_CHARS) });
  }
  return out;
}

/**
 * `passed`, `failed` (tests or new lint errors), `build-failed` (it didn't compile), `timeout`, or
 * `error` (Gradle failed for another reason).
 */
export function testStatus({ timedOut, exitCode, tests, lint }) {
  if (timedOut) return "timeout";
  if (!tests || tests.total === 0) return exitCode === 0 ? "passed" : "build-failed";
  if (tests.failed > 0 || (lint?.errors ?? 0) > 0) return "failed";
  if (exitCode !== 0 && !lint) return "error";
  return "passed";
}
