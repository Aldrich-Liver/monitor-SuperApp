import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewAckText, reviewText } from "../src/format.js";
import { applicableGuidelines, globToRegExp, guidelineKind, ruleMeta } from "../src/reviewer/guidelines.js";
import { appForRepo, mentionsPr, parsePr, prUrls, twinRepo } from "../src/reviewer/pr.js";
import { reviewPayload } from "../src/reviewer/requests.js";
import { answered, findPrThread, pendingMentions, threadContext } from "../src/reviewer/thread.js";

const config = {
  apps: [
    { name: "Super App Android", sourceRepo: "sw-crp-super-app-android" },
    { name: "Super App iOS", sourceRepo: "sw-crp-super-app-ios" },
    { name: "Contacto Logístico Android" },
  ],
};
const PR_URL = "https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/7";
const pr = parsePr(PR_URL);

test("finds PR links in Slack text, once each, including wrapped and /files links", () => {
  const text = `<@U1> revisa <${PR_URL}|el PR> y <${PR_URL}/files> y https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/12`;
  assert.deepEqual(
    prUrls(text).map((p) => [p.repo, p.number]),
    [
      ["sw-crp-super-app-ios", 7],
      ["sw-crp-super-app-android", 12],
    ]
  );
  assert.ok(mentionsPr(`mira ${PR_URL}`, pr));
  assert.ok(!mentionsPr(`${PR_URL}0`, pr));
  assert.equal(parsePr("sin enlace"), null);
});

test("maps a repo to its app and its twin platform", () => {
  assert.equal(appForRepo(config, "SW-CRP-SUPER-APP-IOS").name, "Super App iOS");
  assert.equal(appForRepo(config, "otro-repo"), null);
  assert.equal(twinRepo(config, "sw-crp-super-app-ios"), "sw-crp-super-app-android");
});

test("reads rule and skill frontmatter", () => {
  assert.deepEqual(ruleMeta("---\ndescription: Evidencia\nglobs: app/**/*.kt, *.gradle\nalwaysApply: false\n---\nCuerpo"), {
    alwaysApply: false,
    globs: ["app/**/*.kt", "*.gradle"],
    description: "Evidencia",
    name: null,
  });
  assert.deepEqual(ruleMeta('---\nglobs:\n  - "src/**"\nalwaysApply: true\n---').globs, ["src/**"]);
  assert.equal(ruleMeta("---\nname: investigar-crash\ndescription: Corrige crashes\n---").name, "investigar-crash");
  assert.equal(ruleMeta("sin frontmatter").alwaysApply, false);
});

test("classifies the team's written guidance", () => {
  assert.equal(guidelineKind(".claude/skills/investigar-crash/SKILL.md"), "skill");
  assert.equal(guidelineKind("skills/x/SKILL.md"), "skill");
  assert.equal(guidelineKind(".cursor/rules/a.mdc"), "rule");
  assert.equal(guidelineKind("AGENTS.md"), "agents");
  assert.equal(guidelineKind(".github/pull_request_template.md"), "agents");
  assert.equal(guidelineKind("app/README.md"), "readme");
  assert.equal(guidelineKind("app/vas/PENDIENTES_VAS.md"), "doc");
  assert.equal(guidelineKind("_retirado/README.md"), null);
  assert.equal(guidelineKind(".claude/skills/x/referencia.md"), null);
  assert.equal(guidelineKind("app/Main.kt"), null);
});

test("matches globs the way rules use them", () => {
  assert.ok(globToRegExp("app/**/*.kt").test("app/src/main/A.kt"));
  assert.ok(globToRegExp("app/**/*.kt").test("app/A.kt"));
  assert.ok(globToRegExp("*.gradle").test("app/build.gradle"));
  assert.ok(!globToRegExp("app/*.kt").test("app/src/A.kt"));
});

test("selects the guidance that bears on the changed files", () => {
  const meta = (extra) => ({ alwaysApply: false, globs: [], description: null, name: null, ...extra });
  const guidelines = [
    { path: ".claude/skills/investigar-crash/SKILL.md", ref: "main", meta: meta({ name: "investigar-crash", description: "Corrige crashes" }) },
    { path: "AGENTS.md", ref: "main" },
    { path: "README.md", ref: "main" },
    { path: "PENDIENTE_XCODE.md" },
    { path: "app/core/designsystem/AGENTS.md", ref: "pr" },
    { path: "app/vas/PENDIENTES_VAS.md" },
    { path: "app/vas/README.md" },
    { path: "feature/AGENTS.md" },
    { path: ".cursor/rules/siempre.mdc", meta: meta({ alwaysApply: true }) },
    { path: ".cursor/rules/kotlin.mdc", meta: meta({ globs: ["**/*.kt"] }) },
    { path: ".cursor/rules/swift.mdc", meta: meta({ globs: ["**/*.swift"] }) },
    { path: ".cursor/rules/evidencia.mdc", meta: meta({ description: "Registro de evidencia" }) },
  ];
  const changed = ["app/core/designsystem/Boton.kt", ...Array.from({ length: 12 }, (_, i) => `app/vas/V${i}.kt`)];
  const result = applicableGuidelines(guidelines, changed);
  assert.deepEqual(
    result.map((g) => [g.path, g.kind, Array.isArray(g.appliesTo) ? g.matchedFiles ?? g.appliesTo.length : g.appliesTo]),
    [
      ["AGENTS.md", "agents", "todo el repo"],
      ["app/core/designsystem/AGENTS.md", "agents", 1],
      ["README.md", "readme", "todo el repo"],
      ["app/vas/README.md", "readme", 12],
      [".cursor/rules/siempre.mdc", "rule", "todo el repo"],
      [".cursor/rules/kotlin.mdc", "rule", 13],
      [".cursor/rules/evidencia.mdc", "rule", "si aplica"],
      ["PENDIENTE_XCODE.md", "doc", "si aplica"],
      ["app/vas/PENDIENTES_VAS.md", "doc", 12],
      [".claude/skills/investigar-crash/SKILL.md", "skill", "si aplica"],
    ]
  );
  assert.equal(result.find((g) => g.kind === "skill").name, "investigar-crash");
  assert.equal(result.find((g) => g.path === "app/core/designsystem/AGENTS.md").ref, "pr");
  assert.equal(result.find((g) => g.path === "app/vas/README.md").appliesTo.length, 10);
});

const msg = (ts, extra = {}) => ({ ts: String(ts), text: "", ...extra });

test("thread context keeps the report and the latest replies within the cap", () => {
  const messages = [msg(1, { text: "reporte", bot_profile: { name: "Cursor" }, bot_id: "B0" }), ...Array.from({ length: 20 }, (_, i) => msg(i + 2, { user: "U9", text: "x".repeat(1000) }))];
  const context = threadContext(messages);
  assert.equal(context[0].text, "reporte");
  assert.equal(context[0].author, "Cursor");
  assert.equal(context.at(-1).ts, "21");
  assert.ok(context.length < messages.length);
});

const reviewer = { userId: "UREV", botId: "BREV" };

function fakeSlack({ top, threads }) {
  return {
    channel: "C1",
    history: async () => top,
    replies: async (ts) => threads[ts],
  };
}

const NOW = 1_800_000_000_000;
const recent = (minutesAgo) => String(NOW / 1000 - minutesAgo * 60);

test("finds the thread where the PR link was posted most recently", async () => {
  const report = msg(recent(300), { reply_count: 3, latest_reply: recent(2) });
  const old = msg(recent(60 * 24 * 10), { reply_count: 1, latest_reply: recent(60 * 24 * 10) });
  const slack = fakeSlack({
    top: [report, old],
    threads: {
      [report.ts]: [report, msg(recent(200), { text: "análisis" }), msg(recent(5), { user: "UDEV", text: `<@UCUR> revisa <${PR_URL}>` }), msg(recent(2), { bot_id: "BCUR" })],
      [old.ts]: [old, msg(recent(60 * 24 * 10), { user: "U2", text: PR_URL })],
    },
  });
  const found = await findPrThread(slack, pr, { now: NOW });
  assert.equal(found.thread_ts, report.ts);
  assert.equal(found.request.user, "UDEV");
  assert.equal(found.messages.length, 4);
  assert.equal(await findPrThread(slack, parsePr("https://github.com/a/b/pull/1"), { now: NOW }), null);
});

test("a request in the main channel is answered in a thread under it", async () => {
  const ask = msg(recent(3), { user: "UDEV", text: `<@UREV> revisa la función nueva <${PR_URL}>` });
  const slack = fakeSlack({ top: [ask], threads: {} });
  const found = await findPrThread(slack, pr, { now: NOW });
  assert.equal(found.thread_ts, ask.ts);
  assert.equal(found.request, ask);
  const pending = await pendingMentions(slack, reviewer, { now: NOW });
  assert.deepEqual(pending.map((p) => p.thread_ts), [ask.ts]);
});

test("picks up mentions of the reviewer bot that it has not answered", async () => {
  const a = msg(recent(120), { reply_count: 2, latest_reply: recent(30) });
  const b = msg(recent(110), { reply_count: 2, latest_reply: recent(20) });
  const askA = msg(recent(30), { user: "UDEV", text: `<@UREV> ${PR_URL}` });
  const askB = msg(recent(25), { user: "UDEV", text: `<@UREV> <${PR_URL}>` });
  const slack = fakeSlack({
    top: [a, b],
    threads: {
      [a.ts]: [a, askA],
      [b.ts]: [b, askB, msg(recent(20), { user: "UREV", bot_id: "BREV", text: ":eyes: Reviso…" })],
    },
  });
  const pending = await pendingMentions(slack, reviewer, { now: NOW });
  assert.deepEqual(
    pending.map((p) => [p.thread_ts, p.prs[0].number]),
    [[a.ts, 7]]
  );
  assert.ok(answered([b, askB, msg(recent(20), { user: "UREV" })], askB, reviewer));
  assert.ok(!answered([b, msg(recent(40), { user: "UREV" }), askB], askB, reviewer));
});

test("the payload names who asked, but not when a bot asked", () => {
  const thread = { thread_ts: "1.0", request: msg("2.0", { user: "UDEV" }), messages: [msg("1.0", { text: "reporte" })] };
  const payload = reviewPayload({ pr, app: config.apps[1], channel: "C1", thread, via: "slack-cursor" });
  assert.equal(payload.source, "pr-review-request");
  assert.equal(payload.requested_by, "UDEV");
  assert.equal(payload.thread_ts, "1.0");
  const fromBot = reviewPayload({ pr, app: config.apps[1], channel: "C1", thread: { ...thread, request: msg("2.0", { user: "UB", bot_id: "B1" }) } });
  assert.equal(fromBot.requested_by, null);
  assert.equal(reviewPayload({ pr, app: config.apps[1], channel: "C1", thread: null }).channel, null);
});

test("formats the verdict for the thread", () => {
  const context = { pr: { ...pr, title: "Agenda de citas", headBranch: "feat/agenda" }, app: "Super App iOS", requested_by: "UDEV" };
  const ok = reviewText(context, { verdict: "approve", summary: "Sube el tiempo de espera <15s>.", fixesFailure: "Sí.", meetsGoal: "Sí.", items: [], githubPosted: true });
  assert.match(ok, /^:white_check_mark: \*Visto bueno\* · <https:\/\/github\.com\/Aldrich-Liver\/sw-crp-super-app-ios\/pull\/7\|PR #7> · Super App iOS · _Agenda de citas_ · `feat\/agenda`\n/);
  assert.match(ok, /<@UDEV> Sube el tiempo de espera &lt;15s&gt;\./);
  assert.match(ok, /¿Corrige la falla del hilo\?\* Sí\./);
  assert.doesNotMatch(ok, /Cumple su objetivo/);
  assert.match(ok, /La revisión también quedó en el PR de GitHub/);
  assert.match(reviewText(context, { verdict: "approve", meetsGoal: "Sí, agrega la agenda." }), /¿Cumple su objetivo\?\* Sí, agrega la agenda\./);
  assert.match(
    reviewText(context, { verdict: "approve", summary: "Listo.", previous: "Los 2 puntos se corrigieron.", fixesFailure: "Sí." }),
    /Listo\.\n\*Revisión anterior:\* Los 2 puntos se corrigieron\.\n\*¿Corrige la falla del hilo\?\*/
  );

  const items = Array.from({ length: 8 }, (_, i) => ({ file: "A.swift", line: i + 1, problem: `p${i}`, suggestion: "s", guideline: "AGENTS.md §2.1" }));
  const changes = reviewText(context, { verdict: "changes", summary: "Falta el gemelo.", items });
  assert.match(changes, /:warning: \*Cambios necesarios\*/);
  assert.match(changes, /1\. `A\.swift:1` · p0\n   _Sugerencia:_ s\n   _Lineamiento:_ AGENTS\.md §2\.1/);
  assert.match(changes, /_y 2 más en el PR\._/);
  assert.doesNotMatch(changes, /GitHub\._$/);

  assert.match(reviewText(context, { verdict: "error", summary: "No tengo acceso." }), /^:x: \*No pude revisar el\* <.*\|PR #7>: No tengo acceso\.$/);
  assert.match(reviewAckText({ pr, app: "Super App iOS", requester: "UDEV" }), /^:eyes: <@UDEV> Reviso el <.*\|PR #7> de Super App iOS/);
});
