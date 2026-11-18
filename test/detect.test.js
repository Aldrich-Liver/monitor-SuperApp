import assert from "node:assert/strict";
import { test } from "node:test";
import { detectApp, errorFinding, normalizeState } from "../src/detect.js";
import { buildMessages, neutralize, toText } from "../src/format.js";

const app = { name: "Super App Android", appId: "1:1:android:abc" };
const now = new Date("2026-11-18T16:00:00Z");
const issue = (id, extra = {}) => ({
  id,
  title: `Error ${id}`,
  subtitle: "detalle <init>",
  errorType: "NON_FATAL",
  firstSeenVersion: "1.5.5",
  metrics: { eventsCount: "3", impactedUsersCount: "2" },
  ...extra,
});
const versions = [{ displayName: "1.5.5 (290)", metrics: { totalUsersCount: "10" } }];

function run(prevAppState, list, vs = versions) {
  return detectApp({
    app,
    prevAppState,
    versions: vs,
    issuesByVersion: vs[0] ? { [vs[0].displayName]: list } : {},
    now,
    forgetAfterDays: 45,
  });
}

test("first run records existing issues without alerting on them", () => {
  const { findings, appState } = run(undefined, [issue("a"), issue("b")]);
  assert.deepEqual(
    findings.map((f) => f.type),
    ["baseline"]
  );
  assert.equal(findings[0].issueCount, 2);
  assert.deepEqual(Object.keys(appState.issues).sort(), ["a", "b"]);
  assert.equal(appState.latestVersion, "1.5.5 (290)");
});

test("alerts once for an issue that was not seen before", () => {
  const prev = { latestVersion: "1.5.5 (290)", issues: { a: "2026-11-18" }, regressed: [] };
  const first = run(prev, [issue("a"), issue("c")]);
  assert.deepEqual(
    first.findings.map((f) => [f.type, f.issue?.id]),
    [["new_issue", "c"]]
  );
  assert.equal(first.findings[0].issue.impactedUsersCount, 2);

  const second = run(first.appState, [issue("a"), issue("c")]);
  assert.equal(second.findings.length, 0);
});

test("alerts once when a known issue regresses", () => {
  const prev = { latestVersion: "1.5.5 (290)", issues: { a: "2026-11-18" }, regressed: [] };
  const regressedIssue = issue("a", { signals: ["SIGNAL_REGRESSED"] });
  const first = run(prev, [regressedIssue]);
  assert.deepEqual(
    first.findings.map((f) => f.type),
    ["regressed"]
  );
  assert.equal(run(first.appState, [regressedIssue]).findings.length, 0);

  const cleared = run(first.appState, [issue("a")]);
  assert.deepEqual(cleared.appState.regressed, []);
  assert.equal(run(cleared.appState, [regressedIssue]).findings[0].type, "regressed");
});

test("reports a new release once", () => {
  const prev = { latestVersion: "1.5.4 (289)", issues: {}, regressed: [] };
  const { findings, appState } = run(prev, []);
  assert.deepEqual(
    findings.map((f) => [f.type, f.previousVersion]),
    [["new_version", "1.5.4 (289)"]]
  );
  assert.equal(run(appState, []).findings.length, 0);
});

test("apps without Crashlytics data keep quiet after the baseline", () => {
  const first = run(undefined, [], []);
  assert.equal(first.findings[0].type, "baseline");
  assert.equal(first.findings[0].version, null);
  assert.equal(run(first.appState, [], []).findings.length, 0);
});

test("forgets issues not seen for a long time", () => {
  const prev = { latestVersion: "1.5.5 (290)", issues: { old: "2026-09-01", a: "2026-11-01" }, regressed: [] };
  const { appState } = run(prev, []);
  assert.deepEqual(Object.keys(appState.issues), ["a"]);
});

test("invalid state falls back to an empty state", () => {
  assert.deepEqual(normalizeState("basura"), { v: 1, apps: {}, lastError: null });
  assert.deepEqual(normalizeState({ v: 2 }).apps, {});
});

test("the same error is reported at most every two hours", () => {
  const first = errorFinding("Crashlytics 403", null, now);
  assert.equal(first.finding.type, "error");
  const soon = errorFinding("Crashlytics 403", first.lastError, new Date(now.getTime() + 30 * 60 * 1000));
  assert.equal(soon.finding, null);
  const later = errorFinding("Crashlytics 403", first.lastError, new Date(now.getTime() + 3 * 60 * 60 * 1000));
  assert.equal(later.finding.type, "error");
});

test("issue messages escape Slack markup and include the analysis", () => {
  const prev = { latestVersion: "1.5.5 (290)", issues: {}, regressed: [] };
  const { findings } = run(prev, [issue("z")]);
  const [msg] = buildMessages({ apps: [], findings }, { [findings[0].key]: "Probable timeout & reintento" });
  const text = JSON.stringify(msg.blocks);
  assert.match(text, /detalle &lt;init&gt;/);
  assert.match(text, /Probable timeout &amp; reintento/);
  assert.match(msg.text, /Issue nuevo en Super App Android 1\.5\.5 \(290\)/);
});

test("text rendering for the Slack tool has no raw angle brackets", () => {
  const prev = { latestVersion: "1.5.5 (290)", issues: {}, regressed: [] };
  const { findings } = run(prev, [issue("z", { uri: "https://console.firebase.google.com/x" })]);
  findings[0].sampleEvent = {
    exception: { title: "Fatal Exception: X", message: "falló <init>" },
    frames: ["> a.B.<init> (B.kt:1)"],
    device: "samsung (SM-A525M)",
    buildRevision: "d96837e13dede78c1fce7d08226836a10220ec0a",
  };
  const [text] = buildMessages({ apps: [], findings }, {}, { esc: neutralize }).map(toText);
  assert.doesNotMatch(text, /[<>]/);
  assert.match(text, /‹init›/);
  assert.match(text, /commit d96837e13d/);
  assert.match(text, /Abrir en Crashlytics: https:\/\/console\.firebase\.google\.com\/x/);
  assert.match(text, /Usuarios \/ eventos\*: 2 \/ 3/);
});
