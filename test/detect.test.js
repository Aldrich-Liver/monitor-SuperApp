import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey, mergeCache } from "../src/analyst/cache.js";
import {
  countingSince,
  detectApp,
  errorFinding,
  normalizeAnalysis,
  normalizeState,
  versionChange,
  versionFinding,
} from "../src/detect.js";
import { bugReportText, detailText, handoffText, neutralize, shortTitle, versionText } from "../src/format.js";

const app = { name: "Super App Android", appId: "1:1:android:abc", sourceRepo: "sw-crp-super-app-android" };
const now = new Date("2026-11-18T18:00:00Z");
const V = "1.5.5 (290)";
const SINCE = "2026-11-11T18:00:00.000Z";
const issue = (id, events, extra = {}) => ({
  id,
  title: `mx.liverpool.superapp.Clase${id}.<init>`,
  subtitle: "detalle <init>",
  errorType: "NON_FATAL",
  firstSeenVersion: "1.5.2",
  uri: `https://console.firebase.google.com/${id}`,
  metrics: { eventsCount: String(events), impactedUsersCount: "2" },
  ...extra,
});

function run(prevAppState, issues, version = V) {
  return detectApp({ app, prevAppState, version, since: SINCE, reset: false, issues });
}

test("first check only records counts", () => {
  const { findings, appState } = run(undefined, [issue("a", 5)]);
  assert.equal(findings.length, 0);
  assert.deepEqual(appState, { version: V, since: SINCE, counts: { a: 5 }, seenAt: null });
});

test("remembers when the monitor first saw a version, and its build only for that version", () => {
  const build = { version: V, revision: "abc", checkedAt: SINCE };
  const prev = { version: V, since: SINCE, counts: {}, seenAt: "2026-11-15T00:00:00.000Z", build };
  assert.deepEqual(detectApp({ app, prevAppState: prev, version: V, since: SINCE, reset: false, issues: [], now }).appState, { ...prev, counts: {} });
  const next = detectApp({ app, prevAppState: prev, version: "1.5.6 (291)", since: SINCE, reset: false, issues: [], now }).appState;
  assert.equal(next.seenAt, now.toISOString());
  assert.equal(next.build, undefined);
});

test("reports every issue whose count grew, known or new, sorted by new events", () => {
  const prev = { version: V, since: SINCE, counts: { a: 5, b: 3 } };
  const { findings, appState } = run(prev, [issue("a", 6), issue("b", 3), issue("c", 4)]);
  assert.deepEqual(
    findings.map((f) => [f.issue.id, f.newEvents, f.totalEvents]),
    [
      ["c", 4, 4],
      ["a", 1, 6],
    ]
  );
  assert.deepEqual(appState.counts, { a: 6, b: 3, c: 4 });
  assert.equal(findings[0].sourceRepo, "sw-crp-super-app-android");
});

test("quiet when nothing grew", () => {
  const prev = { version: V, since: SINCE, counts: { a: 5 } };
  assert.equal(run(prev, [issue("a", 5)]).findings.length, 0);
});

test("a new release reports all of its failures", () => {
  const prev = { version: "1.5.4 (289)", since: SINCE, counts: { a: 50 } };
  const { findings } = run(prev, [issue("a", 2)], "1.5.6 (291)");
  assert.deepEqual(
    findings.map((f) => [f.issue.id, f.newEvents]),
    [["a", 2]]
  );
});

test("counting window stays fixed per version and restarts after 85 days", () => {
  const prev = { version: V, since: SINCE, counts: {} };
  assert.deepEqual(countingSince(prev, V, now, 7), { since: SINCE, reset: false });
  assert.equal(countingSince(prev, "1.5.6 (291)", now, 7).reset, false);
  assert.equal(countingSince(prev, "1.5.6 (291)", now, 7).since, "2026-11-11T18:00:00.000Z");
  const old = { ...prev, since: "2026-08-01T00:00:00.000Z" };
  assert.equal(countingSince(old, V, now, 7).reset, true);
  const reset = detectApp({ app, prevAppState: old, version: V, since: SINCE, reset: true, issues: [issue("a", 9)] });
  assert.equal(reset.findings.length, 0);
});

test("a new or first-seen version produces the monitor-active message with every app", () => {
  assert.equal(versionChange(undefined, V), "first");
  assert.equal(versionChange({ version: V }, V), null);
  assert.equal(versionChange({ version: "1.5.4 (289)" }, V), "new");

  const steady = [{ app: "Super App iOS", latestVersion: "1.5.6 (291)", change: null, issues: 0 }];
  assert.equal(versionFinding(steady), null);

  const apps = [
    { app: "Super App Android", latestVersion: "1.5.6 (291)", previousVersion: "1.5.5 (290)", change: "new", issues: 2 },
    ...steady,
    { app: "Contacto Logístico Android", latestVersion: null, status: "sin datos en Crashlytics" },
    { app: "Contacto Logístico iOS", latestVersion: "1.0.0 (1)", change: "first", issues: 1 },
  ];
  const text = versionText(versionFinding(apps));
  assert.equal(
    text,
    [
      ":white_check_mark: *Monitor de Crashlytics activo* · versión nueva: Super App Android 1.5.6 (291)",
      "*Super App Android 1.5.6 (291)*: versión nueva (antes 1.5.5 (290)), 2 issues con eventos hasta ahora",
      "Super App iOS 1.5.6 (291): 0 issues con eventos en esta versión",
      "Contacto Logístico Android: sin datos en Crashlytics",
      "Contacto Logístico iOS 1.0.0 (1): 1 issue existente registrado",
      "Cada falla nueva de la última versión tiene su propio hilo, sin importar su gravedad; las abiertas van en el resumen de cada mañana.",
    ].join("\n")
  );
});

test("old or invalid state starts over", () => {
  assert.deepEqual(normalizeState({ v: 1, apps: { x: {} } }).apps, {});
  assert.deepEqual(normalizeState("basura").apps, {});
});

test("the same monitor error is reported at most every six hours", () => {
  const first = errorFinding("Crashlytics 403", null, now);
  assert.equal(first.finding.type, "error");
  const soon = errorFinding("Crashlytics 403", first.lastError, new Date(now.getTime() + 2 * 60 * 60 * 1000));
  assert.equal(soon.finding, null);
  const later = errorFinding("Crashlytics 403", first.lastError, new Date(now.getTime() + 7 * 60 * 60 * 1000));
  assert.equal(later.finding.type, "error");
});

test("each bug report is its own message, escapes Slack markup and carries its Ref.", () => {
  const prev = { version: V, since: SINCE, counts: {} };
  const [a, b] = run(prev, [issue("a", 3), issue("b", 1, { firstSeenVersion: "1.5.5", errorType: "FATAL" })]).findings;
  const text = bugReportText(a);
  assert.match(text, /^:rotating_light: \*Falla nueva en Super App Android 1\.5\.5 \(290\)\* · No fatal · `Clasea\.&lt;init&gt;`/);
  assert.match(text, /3 eventos · 2 usuarios · desde 1\.5\.2/);
  assert.doesNotMatch(text, /<init>|PRUEBA|Ref\./);
  assert.match(bugReportText(b), /Crash · `Claseb\.&lt;init&gt;`[\s\S]*1 evento · 2 usuarios · nuevo en esta versión/);
  assert.match(bugReportText(a, { test: true }), /^:test_tube: \*PRUEBA del monitor\*/);

  const forCursor = bugReportText(b, { esc: neutralize, ref: "CR-ABC123" });
  assert.match(forCursor, /`Claseb\.‹init›`/);
  assert.match(forCursor, /en el hilo\. · Ref\. CR-ABC123$/);
});

test("handoff names the analyst or mentions it", () => {
  assert.match(handoffText({ mention: null }), /^:mag: \*Analista Crashlytics\*, revisa esta falla/);
  assert.match(handoffText({ mention: "<@U123>", reopened: true }), /^:mag: <@U123>, revisa otra vez esta falla/);
});

test("detail reply includes the error, where it happened, the analysis and a link", () => {
  const prev = { version: V, since: SINCE, counts: {} };
  const [f] = run(prev, [issue("a", 4)]).findings;
  f.sampleEvent = { blameFrame: "mx.liverpool.superapp.Clasea.<init> (Clasea.kt:63) [com.liverpool.superapp1]" };
  const text = detailText(f, { cause: "La app espera demasiado & se rinde.", fix: "Subir el tiempo de espera." }, 1, 2);
  assert.match(text, /^\*1\/2 · Super App Android 1\.5\.5 \(290\)\* · No fatal/);
  assert.match(text, /\*Dónde:\* `Clasea\.&lt;init&gt; \(Clasea\.kt:63\)`\n/);
  assert.match(text, /\*Eventos:\* 4 nuevos · 4 en esta versión · 2 usuarios · desde 1\.5\.2/);

  f.sampleEvent = {
    blameFrame: `${f.issue.title} (Clasea.java:63) [com.liverpool.superapp1]`,
    frames: [`> ${f.issue.title} (Clasea.java:63)`, "  mx.liverpool.superapp.Arranque.protegido (Arranque.kt:55) [x]"],
  };
  assert.match(detailText(f, null, 1, 1), /\*Dónde:\* `Arranque\.protegido \(Arranque\.kt:55\)`/);
  assert.match(text, /\*Qué está pasando:\* La app espera demasiado &amp; se rinde\./);
  assert.match(text, /\*Solución propuesta:\* Subir el tiempo de espera\./);
  assert.match(text, /<https:\/\/console\.firebase\.google\.com\/a\|Ver en Crashlytics>/);
});

test("short titles keep the last class and method", () => {
  assert.equal(shortTitle("mx.liverpool.a.B$C.<init>"), "B$C.<init>");
  assert.equal(shortTitle("[libc.so] __futex_wait_ex"), "[libc.so] __futex_wait_ex");
  assert.equal(shortTitle("package:hive_ce/x.dart - StorageBackendVm.initialize"), "StorageBackendVm.initialize");
});

test("analyses are cached per issue and version and reused", () => {
  const f = { key: "1:1:android:abc:a", version: V, analysis: null };
  const { cache, resolved } = mergeCache({}, [f], { [f.key]: { causa: "x", solucion: "y" } }, now);
  assert.deepEqual(resolved.get(f.key), { cause: "x", fix: "y" });
  assert.deepEqual(cache[cacheKey(f)], { cause: "x", fix: "y", at: "2026-11-18" });

  const again = mergeCache(cache, [{ ...f, analysis: cache[cacheKey(f)] }], {}, now);
  assert.equal(again.resolved.get(f.key).cause, "x");
  assert.equal(normalizeAnalysis(""), null);
});
