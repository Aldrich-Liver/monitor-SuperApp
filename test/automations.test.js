import assert from "node:assert/strict";
import { test } from "node:test";
import { crashlyticsLink, failureFromThread, fixInProgress, fixRequester, linkedFixPrs, noChangeVerdict, threadTarget } from "../src/fixer/thread.js";
import { parsePr } from "../src/reviewer/pr.js";
import { FIX_VERBS, REVIEW_VERBS, askPattern, pendingBotMentions, pendingMentions, reviewVerdict } from "../src/reviewer/thread.js";
import { bugReportText, detailText, fixAckText, fixResultText, neutralize, prOpenedText, testsComment, testsText, twinMissingText, twinOpenedText } from "../src/format.js";
import { testsVerdict } from "../src/tester/thread.js";
import { compileErrors, lintVerdict, parseJunit, parseLint, testStatus } from "../src/tester/results.js";

const config = {
  apps: [
    { name: "Super App Android", appId: "1:393935496247:android:0eb1222bba3d03d8ee8bb2", bundle: "com.liverpool.superapp1", sourceRepo: "sw-crp-super-app-android" },
    { name: "Super App iOS", appId: "1:393935496247:ios:4851fc5034ce76a4ee8bb2", bundle: "com.example.superAppV2", sourceRepo: "sw-crp-super-app-ios" },
    { name: "Contacto Logístico Android", appId: "1:393935496247:android:6cfb996092b513b2ee8bb2", bundle: "mx.liverpool.contactologistico" },
  ],
};

const ANDROID_PR = "https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/14";

test("reads JUnit reports: totals, skipped and the first line of each failure", () => {
  const xml = `<?xml version="1.0"?>
<testsuite name="mx.app.ArranqueTest" tests="3" failures="1">
  <testcase name="arranca sin red" classname="mx.app.ArranqueTest" time="0.1"/>
  <testcase name="omite" classname="mx.app.ArranqueTest"><skipped/></testcase>
  <testcase name="espera &quot;firebase&quot;" classname="mx.app.ArranqueTest">
    <failure message="expected:&lt;1&gt; but was:&lt;2&gt;&#10;segunda línea" type="AssertionError">stack</failure>
  </testcase>
</testsuite>`;
  const other = `<testsuite><testcase name="x" classname="Otra"><error type="IllegalStateException">boom
at Otra.kt:3</error></testcase></testsuite>`;
  assert.deepEqual(parseJunit([xml, other]), {
    total: 4,
    failed: 2,
    skipped: 1,
    failures: [
      { test: 'ArranqueTest.espera "firebase"', message: "expected:<1> but was:<2>" },
      { test: "Otra.x", message: "boom" },
    ],
  });
});

test("only lint errors in files the PR touches count against it", () => {
  const root = "/agent/repos/monitor-SuperApp/.tester/worktree";
  const xml = `<issues format="6">
    <issue id="RestrictedApi" severity="Error" message="dispatchKeyEvent can only be called…" category="Correctness">
        <location file="${root}/app/src/main/kotlin/MainActivity.kt" line="48" column="18"/>
    </issue>
    <issue id="ContextCastToActivity" severity="Error" message="LocalContext should not be cast to Activity">
        <location file="${root}/app/src/main/kotlin/modulos/vcm/Pantalla.kt" line="12"/>
    </issue>
    <issue id="UnusedResources" severity="Warning" message="No se usa">
        <location file="${root}/app/src/main/res/values/strings.xml" line="3"/>
    </issue>
  </issues>`;
  const issues = parseLint(xml, root);
  assert.equal(issues[0].file, "app/src/main/kotlin/MainActivity.kt");
  const verdict = lintVerdict(issues, ["app/src/main/kotlin/modulos/vcm/Pantalla.kt"]);
  assert.equal(verdict.errors, 1);
  assert.equal(verdict.previousErrors, 1);
  assert.equal(verdict.warnings, 1);
  assert.deepEqual(verdict.issues.map((i) => [i.id, i.line]), [["ContextCastToActivity", 12]]);
});

test("pulls Kotlin compile errors out of the Gradle log, or what went wrong", () => {
  const root = "/w";
  const log = "> Task :app:compileDevDebugKotlin FAILED\ne: file:///w/app/src/main/kotlin/A.kt:10:5 Unresolved reference 'foo'.\nw: file:///w/B.kt:1:1 aviso";
  assert.deepEqual(compileErrors(log, root), [{ file: "app/src/main/kotlin/A.kt", line: 10, message: "Unresolved reference 'foo'." }]);
  const other = "FAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not resolve all files for configuration\n  ':app:devDebugRuntimeClasspath'.\n\n* Try:";
  assert.match(compileErrors(other, root)[0].message, /^Could not resolve all files for configuration ':app:devDebugRuntimeClasspath'\.$/);
});

test("decides the run's status from Gradle's exit, the tests and lint", () => {
  const ok = { total: 10, failed: 0 };
  assert.equal(testStatus({ timedOut: true, exitCode: 1, tests: ok, lint: null }), "timeout");
  assert.equal(testStatus({ timedOut: false, exitCode: 1, tests: null, lint: null }), "build-failed");
  assert.equal(testStatus({ timedOut: false, exitCode: 1, tests: { total: 10, failed: 1 }, lint: { errors: 0 } }), "failed");
  assert.equal(testStatus({ timedOut: false, exitCode: 1, tests: ok, lint: { errors: 2 } }), "failed");
  // lintDevDebug fails on main's own errors: with none new, the PR passes.
  assert.equal(testStatus({ timedOut: false, exitCode: 1, tests: ok, lint: { errors: 0, previousErrors: 4 } }), "passed");
  assert.equal(testStatus({ timedOut: false, exitCode: 1, tests: ok, lint: null }), "error");
});

test("the test result reads the same in the thread and on GitHub", () => {
  const result = {
    app: "Super App Android",
    pr: { url: ANDROID_PR, number: 14, headSha: "3f2a9c1aa" },
    status: "failed",
    tasks: [":app:testDevDebugUnitTest", ":app:lintDevDebug"],
    tests: { total: 2217, failed: 1, skipped: 0, failures: [{ test: "ArranqueTest.espera", message: "expected:<1> but was:<2>" }] },
    lint: { errors: 0, previousErrors: 4, warnings: 99, issues: [] },
    durationS: 266,
  };
  const text = testsText(result);
  assert.equal(
    text,
    `:x: *Pruebas fallidas* · <${ANDROID_PR}|PR #14> · \`3f2a9c1\` · 1 de 2217 pruebas falló · lint sin errores nuevos · 4 min · \`ArranqueTest.espera\``
  );
  const lint = { errors: 1, issues: [{ file: "app/src/main/java/Arranque.kt", line: 9, id: "UnusedVariable", message: "never used" }] };
  assert.match(testsText({ ...result, lint }), /1 error nuevo de lint · 4 min\n• `ArranqueTest\.espera`\n• `Arranque\.kt:9` UnusedVariable$/);
  const comment = testsComment(result);
  assert.match(comment, /^\*\*❌ Pruebas fallidas\*\* · `3f2a9c1` · 1 de 2217 pruebas falló/);
  assert.match(comment, /- `ArranqueTest\.espera`: expected:<1> but was:<2>/);
  assert.match(testsText({ ...result, status: "passed", tests: { total: 5, failed: 0, failures: [] } }), /^:white_check_mark: \*Pruebas OK\*.*5 pruebas · lint/);
});

test("the PR announcement carries plain links so the thread can be found by them", () => {
  const pr = { url: ANDROID_PR, number: 14, title: "Arranque: <rápido>", headBranch: "fix/arranque", author: "dev" };
  const twinPr = { url: "https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/9", number: 9 };
  const withTwin = prOpenedText({ pr, app: "Super App Android", twin: { repo: "sw-crp-super-app-ios", branch: "fix/arranque", pr: twinPr } });
  assert.equal(
    withTwin,
    `:arrow_heading_up: *PR nuevo* · Super App Android #14 · Arranque: ‹rápido› · de dev\n${ANDROID_PR} · gemelo iOS: https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/9`
  );
  const missing = prOpenedText({ pr, app: "Super App Android", twin: { repo: "sw-crp-super-app-ios", branch: "fix/arranque", pr: null } });
  assert.ok(missing.endsWith(`${ANDROID_PR} · :warning: falta el gemelo en iOS`));
  assert.equal(twinMissingText({ repo: "sw-crp-super-app-ios", branch: "fix/arranque" }), ":warning: Falta el gemelo en iOS (rama `fix/arranque`). Si solo aplica a una plataforma, dilo en el PR.");
  const unknown = prOpenedText({ pr, app: "Super App Android", twin: { repo: "sw-crp-super-app-ios", branch: "fix/arranque" } });
  assert.ok(!/gemelo/i.test(unknown));
  assert.ok(twinOpenedText({ pr: twinPr, app: "Super App iOS" }).includes("<https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/9|PR #9>"));
});

// As Slack returns them: Send to Slack turned the report's bold into italics and joined its lines.
const report = {
  ts: "1795060856.226779",
  bot_id: "B1",
  text: ":rotating_light: _Falla nueva en Super App Android 1.5.10 (295)_ · No fatal · `ArranqueAnfitrion$PasoArranqueExcedido.‹init›` &gt; qt - El paso de arranque 'firebase' no terminó en 10s 4 eventos · 3 usuarios · desde 1.5.8 :thread: Detalle, solución propuesta y seguimiento en el hilo. · Ref. CR-E6CF6D",
};
const detail = {
  ts: "1795060900.000100",
  bot_id: "B2",
  text:
    "*Super App Android 1.5.10 (295)* · No fatal\n*Error:* `ArranqueAnfitrion$PasoArranqueExcedido.&lt;init&gt;`\n*Dónde:* `ArranqueAnfitrion.protegido (ArranqueAnfitrion.kt:76)`\n" +
    "*Qué está pasando:* La app no se cierra &amp; tarda.\n*Solución propuesta:* Inscribir en paralelo.\n" +
    "<https://console.firebase.google.com/v1/appid/project/crp-dev-dig-superapp/crashlytics/app/1:393935496247:android:0eb1222bba3d03d8ee8bb2/issues/6848060ad69f7ba1a836c6c636f1731a?&amp;time=1:2&amp;versions=1.5.10%20(295)|Ver en Crashlytics>",
};

test("recognizes a bug from its thread: report, the Analista's detail and its Crashlytics link", () => {
  assert.deepEqual(failureFromThread([report, detail], config), {
    app: "Super App Android",
    appId: "1:393935496247:android:0eb1222bba3d03d8ee8bb2",
    sourceRepo: "sw-crp-super-app-android",
    version: "1.5.10 (295)",
    title: "ArranqueAnfitrion$PasoArranqueExcedido.<init>",
    issueId: "6848060ad69f7ba1a836c6c636f1731a",
    crashlyticsUrl:
      "https://console.firebase.google.com/v1/appid/project/crp-dev-dig-superapp/crashlytics/app/1:393935496247:android:0eb1222bba3d03d8ee8bb2/issues/6848060ad69f7ba1a836c6c636f1731a?&time=1:2&versions=1.5.10%20(295)",
    ref: "CR-E6CF6D",
    analysis: { cause: "La app no se cierra & tarda.", fix: "Inscribir en paralelo." },
  });
  const withoutDetail = failureFromThread([report], config);
  assert.equal(withoutDetail.issueId, null);
  assert.equal(withoutDetail.version, "1.5.10 (295)");
  assert.equal(failureFromThread([{ ts: "1", text: "hola" }], config), null);
  assert.equal(crashlyticsLink("https://console.firebase.google.com/project/p/crashlytics/app/android:com.liverpool.superapp1/issues/abc123").app, "android:com.liverpool.superapp1");
});

test("the Corrector reads the same bug from the short report and detail as Slack shows them", () => {
  const f = {
    app: "Super App Android",
    version: "1.5.10 (295)",
    newEvents: 4,
    impactedUsers: 3,
    totalEvents: 4,
    sourceRepo: "sw-crp-super-app-android",
    issue: { title: "mx.liverpool.ArranqueAnfitrion$PasoArranqueExcedido.<init>", subtitle: "No terminó en 10s", errorType: "NON_FATAL", uri: detail.text.match(/<(https:[^|]+)\|/)[1] },
    sampleEvent: { blameFrame: "mx.liverpool.ArranqueAnfitrion.protegido (ArranqueAnfitrion.kt:76)" },
  };
  // Send to Slack turns bold into italics and joins the lines.
  const posted = bugReportText(f, { esc: neutralize, ref: "CR-E6CF6D" }).replace(/\*/g, "_").replace(/\n/g, " ");
  const reply = detailText(f, { cause: "La app no se cierra & tarda.", fix: "Inscribir en paralelo." });
  assert.match(reply, /^\*Super App Android 1\.5\.10 \(295\)\* · No fatal · `ArranqueAnfitrion\.kt:76` · <https:\S+\|Ver en Crashlytics>\n> No terminó en 10s\n/);
  assert.deepEqual(failureFromThread([{ ts: "1", text: posted }, { ts: "2", text: reply }], config), failureFromThread([report, detail], config));
});

test("finds the bug's thread from a Ref., a thread link or a ts", () => {
  assert.deepEqual(threadTarget("arregla Ref. cr-e6cf6d porfa"), { ref: "CR-E6CF6D" });
  assert.deepEqual(threadTarget("https://liverpool.slack.com/archives/C0ABC/p1795060900000100?thread_ts=1795060856.226779&cid=C0ABC"), { ts: "1795060856.226779" });
  assert.deepEqual(threadTarget("https://liverpool.slack.com/archives/C0ABC/p1795060856226779"), { ts: "1795060856.226779" });
  assert.deepEqual(threadTarget("1795060856.226779"), { ts: "1795060856.226779" });
  assert.equal(threadTarget("sin nada"), null);
});

test("knows when the bug already has a PR, who asked and whether the Corrector is on it", () => {
  const ask = { ts: "1795061000.000100", user: "U123", text: "<@U0CURSOR> corrige esta falla" };
  const ack = { ts: "1795061001.000100", bot_id: "B2", text: ":wrench: El *Corrector* toma esta falla de Super App Android: …" };
  const done = { ts: "1795062000.000100", bot_id: "B2", text: `:hammer_and_wrench: *Corrección propuesta*\n• <${ANDROID_PR}|PR #14> · sw-crp-super-app-android` };
  const now = 1795061001 * 1000 + 60_000;
  assert.equal(fixRequester([report, detail, ask, ack]), "U123");
  assert.ok(fixInProgress([report, ask, ack], now));
  assert.ok(!fixInProgress([report, ask, ack], now + 3 * 3600 * 1000));
  assert.ok(!fixInProgress([report, ask, ack, done], now));
  assert.deepEqual(linkedFixPrs([report, done], "sw-crp-super-app-android").map((p) => p.number), [14]);
  assert.deepEqual(linkedFixPrs([report, done], "sw-crp-super-app-ios"), []);
});

test("the Corrector's answer links each PR in the thread", () => {
  const prs = [
    { url: ANDROID_PR, number: 14, repo: "sw-crp-super-app-android" },
    { url: "https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/9", number: 9, repo: "sw-crp-super-app-ios" },
  ];
  const text = fixResultText({ status: "fixed", summary: "Ya no se frena.", tested: "Suite de Android", notTested: "iOS no se compiló." }, prs, { requester: "UDEV" });
  assert.equal(
    text,
    `:hammer_and_wrench: *Corrección propuesta* · <${ANDROID_PR}|Android #14> · <https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/9|iOS #9> · <@UDEV>\n` +
      "Ya no se frena.\n*Falta:* iOS no se compiló; el merge lo hace una persona."
  );
  const noChange = fixResultText({ status: "no-change", summary: "Es del sistema." }, []);
  assert.equal(noChange, ":information_source: *Sin cambios de código*\nEs del sistema.");
  assert.equal(noChangeVerdict([report, { ts: "1795062000.000100", bot_id: "B2", text: noChange }]).summary, "Es del sistema.");
});

test("finds mentions of the Corrector that it hasn't answered, in any thread", async () => {
  const NOW = 1_800_000_000_000;
  const at = (minutesAgo) => String(NOW / 1000 - minutesAgo * 60);
  const fixer = { userId: "UFIX", botId: "BFIX" };
  const bug = { ts: at(300), text: report.text, reply_count: 3, latest_reply: at(5) };
  const done = { ts: at(400), text: "otra falla", reply_count: 2, latest_reply: at(30) };
  const threads = {
    [bug.ts]: [bug, { ts: at(200), bot_id: "B2", text: detail.text }, { ts: at(5), user: "UDEV", text: "<@UFIX> corrige esta falla" }],
    [done.ts]: [done, { ts: at(40), user: "UDEV", text: "<@UFIX> arréglala" }, { ts: at(30), bot_id: "BFIX", user: "UFIX", text: "toma" }],
  };
  const slack = { channel: "C1", history: async () => [bug, done], replies: async (ts) => threads[ts] };
  const pending = await pendingBotMentions(slack, fixer, { now: NOW });
  assert.deepEqual(pending.map((p) => [p.thread_ts, p.request.user, p.messages.length]), [[bug.ts, "UDEV", 3]]);
});

test("reads the Revisor's verdict for the latest review asked of each PR", () => {
  const pr = parsePr(ANDROID_PR);
  const ios = parsePr("https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/9");
  const link = `<${ANDROID_PR}|PR #14>`;
  const ack = (ts) => ({ ts, text: `:eyes: Reviso el ${link} de Super App Android con los lineamientos…` });
  const tests = { ts: "3", text: `:x: *Pruebas fallidas* · ${link} de Super App Android` };
  const changes = { ts: "4", text: `:warning: *Cambios necesarios* · ${link} · Super App Android\n1. falta la prueba` };
  const approve = { ts: "6", text: `:white_check_mark: *Visto bueno* · ${link} · Super App Android` };
  assert.equal(reviewVerdict([report], pr), null);
  assert.equal(reviewVerdict([report, ack("2"), tests], pr).status, "pending");
  assert.equal(reviewVerdict([report, ack("2"), tests, changes], pr).status, "changes");
  // A second round: the earlier verdict no longer counts until the new one arrives.
  assert.equal(reviewVerdict([report, ack("2"), changes, ack("5")], pr).status, "pending");
  assert.deepEqual(reviewVerdict([report, ack("2"), changes, ack("5"), approve], pr), { status: "approve", ts: "6", text: approve.text });
  assert.equal(reviewVerdict([report, ack("2"), { ts: "3", text: ":warning: No se pudo activar al Revisor de PRs: webhook 500" }], pr).status, "error");
  assert.equal(reviewVerdict([report, ack("2"), changes], ios), null);
});

test("the Corrector first posts its PRs as in verification, without counting as its final answer", () => {
  const prs = [{ url: ANDROID_PR, number: 14, repo: "sw-crp-super-app-android" }];
  const interim = fixResultText({ status: "in-review", summary: "Ya no se frena.", tested: "no debe salir" }, prs);
  assert.equal(interim, `:arrows_counterclockwise: *PR abiertos, en verificación* · <${ANDROID_PR}|Android #14>\nYa no se frena.`);
  assert.ok(!interim.includes("no debe salir"));
  const ack = { ts: "1795061001.000100", text: ":wrench: El *Corrector* toma esta falla de Super App Android: …" };
  const now = 1795061001 * 1000 + 60_000;
  assert.ok(fixInProgress([report, ack, { ts: "1795061100.000100", text: interim }], now));
  const final = fixResultText({ status: "fixed", summary: "Listo.", checks: "2219 pruebas OK", review: "Visto bueno en los dos PR, 2 rondas", pending: "Probar el APK release" }, prs);
  assert.match(final, /\n\*Pruebas:\* 2219 pruebas OK · \*Revisión:\* Visto bueno en los dos PR, 2 rondas\n/);
  assert.match(final, /\*Falta:\* Probar el APK release; el merge lo hace una persona\.$/);
  assert.ok(fixInProgress([report, { ts: "1795061001.000100", text: fixAckText() }], now));
  assert.ok(!fixInProgress([report, ack, { ts: "1795061100.000100", text: interim }, { ts: "1795062000.000100", text: final }], now));
});

test("reads the result Pruebas de PRs posted for the PR's latest commit", () => {
  const pr = parsePr(ANDROID_PR);
  const base = { app: "Super App Android", tasks: [], tests: { total: 5, failed: 0, failures: [] }, lint: null, durationS: 200 };
  const failed = { ts: "2", text: testsText({ ...base, pr: { url: ANDROID_PR, number: 14, headSha: "aaaaaaa111" }, status: "failed", tests: { total: 5, failed: 1, failures: [] } }) };
  const passed = { ts: "3", text: testsText({ ...base, pr: { url: ANDROID_PR, number: 14, headSha: "bbbbbbb222" }, status: "passed" }) };
  const review = { ts: "4", text: `:eyes: Reviso el <${ANDROID_PR}|PR #14> de Super App Android…` };
  assert.equal(testsVerdict([report, failed, review], pr, "aaaaaaa111").status, "failed");
  assert.equal(testsVerdict([report, failed, review], pr, "bbbbbbb222"), null);
  assert.deepEqual(testsVerdict([report, failed, passed, review], pr, "bbbbbbb222"), { status: "passed", ts: "3", text: passed.text });
  assert.equal(testsVerdict([report, passed], parsePr("https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/15"), "bbbbbbb222"), null);
});

test("picks up '@Cursor corrige esta falla' that reached an automation instead of the Corrector", async () => {
  const NOW = 1_800_000_000_000;
  const at = (minutesAgo) => String(NOW / 1000 - minutesAgo * 60);
  const fixer = { userId: "UFIX", botId: "BFIX" };
  const bug = { ts: at(300), bot_id: "BCURSOR", text: report.text, reply_count: 3, latest_reply: at(1) };
  const answeredBug = { ts: at(500), bot_id: "BCURSOR", text: report.text, reply_count: 3, latest_reply: at(50) };
  const threads = {
    [bug.ts]: [
      bug,
      { ts: at(299), bot_id: "BMON", user: "UMON", text: ":mag: <@UCURSOR>, revisa y corrige esta falla" },
      { ts: at(200), user: "UDEV", text: "<@UJUAN> corrige esta falla porfa" },
      { ts: at(10), user: "UDEV", text: "<@UCURSOR> corrige esta falla" },
      { ts: at(1), user: "UDEV", text: "<@UCURSOR> corrige esta falla" },
    ],
    [answeredBug.ts]: [
      answeredBug,
      { ts: at(60), user: "UDEV", text: "<@UCURSOR> arregla esto" },
      { ts: at(50), bot_id: "BFIX", user: "UFIX", text: ":wrench: El *Corrector* toma esta falla…" },
    ],
  };
  const slack = { channel: "C1", history: async () => [bug, answeredBug], replies: async (ts) => threads[ts] };
  const FIX_ASK = askPattern("UCURSOR", FIX_VERBS);
  const pending = await pendingBotMentions(slack, fixer, { now: NOW, asks: FIX_ASK, minAgeMin: 5 });
  assert.deepEqual(pending.map((p) => [p.thread_ts, p.request.ts, p.via]), [[bug.ts, at(10), "ask"]]);
  assert.equal((await pendingBotMentions(slack, fixer, { now: NOW })).length, 0);
  assert.ok(!FIX_ASK.test("corrige esta falla"));
  assert.ok(!FIX_ASK.test("<@UJUAN> arregla esto"));
  assert.ok(!FIX_ASK.test("<@UCURSOR> ¿quién corrigió esto?"));
  assert.equal(askPattern(undefined, FIX_VERBS), null);
});

test("picks up '@Cursor revisa este PR' with a link that the Revisor hasn't answered", async () => {
  const NOW = 1_800_000_000_000;
  const at = (minutesAgo) => String(NOW / 1000 - minutesAgo * 60);
  const reviewer = { userId: "UREV", botId: "BREV" };
  const top = { ts: at(100), bot_id: "BCURSOR", text: `:arrow_heading_up: PR nuevo ${ANDROID_PR}`, reply_count: 2, latest_reply: at(10) };
  const threads = {
    [top.ts]: [top, { ts: at(20), user: "UDEV", text: "<@UCURSOR> revisa otra vez" }, { ts: at(10), user: "UDEV", text: `<@UCURSOR> revisa este PR <${ANDROID_PR}>` }],
  };
  const slack = { channel: "C1", history: async () => [top], replies: async (ts) => threads[ts] };
  const pending = await pendingMentions(slack, reviewer, { now: NOW, cursorUserId: "UCURSOR" });
  assert.deepEqual(pending.map((p) => [p.request.ts, p.prs[0].number]), [[at(10), 14]]);
  assert.equal((await pendingMentions(slack, reviewer, { now: NOW, cursorUserId: "UOTRO" })).length, 0);
  assert.ok(askPattern("U1", REVIEW_VERBS).test("<@U1> ¿lo revisas?"));
});
