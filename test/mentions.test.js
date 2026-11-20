import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { onFixerMention, onReviewerMention, onTesterMention } from "../src/mentions.js";

const config = {
  cursorUserId: "UCURSOR",
  apps: [
    { name: "Super App Android", sourceRepo: "sw-crp-super-app-android" },
    { name: "Super App iOS", sourceRepo: "sw-crp-super-app-ios" },
    { name: "Contacto Logístico Android" },
  ],
};
const ANDROID = "https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/9";
const IOS = "https://github.com/Aldrich-Liver/sw-crp-super-app-ios/pull/7";

let hooks;
const realFetch = globalThis.fetch;
beforeEach(() => {
  hooks = [];
  for (const name of ["REVIEWER", "FIXER", "TESTER"]) {
    process.env[`${name}_WEBHOOK_URL`] = `https://hooks.test/${name.toLowerCase()}`;
    process.env[`${name}_WEBHOOK_KEY`] = "k";
  }
  globalThis.fetch = async (url, init) => {
    hooks.push({ url, payload: JSON.parse(init.body) });
    return new Response("ok", { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeClient(messages) {
  const posts = [];
  const client = ({ channel }) => ({
    channel,
    replies: async () => messages,
    post: async (text, threadTs) => posts.push({ text, threadTs }),
    permalink: async () => "https://slack.test/p",
  });
  return { client, posts };
}

const parent = { ts: "100.0", text: `:arrow_heading_up: _PR nuevo en Super App Android_ · #9 · <${ANDROID}>` };

test("@Revisor de PRs with no link in a PR's thread reviews that thread's PRs at once", async () => {
  const twin = { ts: "101.0", bot_id: "BMON", text: `:link: Se abrió el gemelo en Super App iOS: <${IOS}|PR #7>` };
  const ask = { ts: "200.0", user: "UDEV", text: "<@UREV> revisa estos PRs ya subí correcciones" };
  const { client, posts } = fakeClient([parent, twin, ask]);
  const mention = { channel: "C1", ts: ask.ts, threadTs: parent.ts, user: "UDEV", text: ask.text };
  const out = await onReviewerMention({ config, mention, token: "x", client });
  assert.equal(out.requested, 2);
  assert.deepEqual(hooks.map((h) => [h.url, h.payload.pr.number, h.payload.requested_by, h.payload.thread_ts]), [
    ["https://hooks.test/reviewer", 9, "UDEV", "100.0"],
    ["https://hooks.test/reviewer", 7, "UDEV", "100.0"],
  ]);
  assert.match(posts[0].text, /^:eyes: Revisando el <[^>]*pull\/9\|PR #9>/);
});

test("@Revisor de PRs reviews only the PR linked in the message when there is one", async () => {
  const ask = { ts: "200.0", user: "UDEV", text: `<@UREV> y el de iOS <${IOS}>` };
  const { client } = fakeClient([parent, ask]);
  await onReviewerMention({ config, mention: { channel: "C1", ts: ask.ts, threadTs: parent.ts, user: "UDEV", text: ask.text }, token: "x", client });
  assert.deepEqual(hooks.map((h) => h.payload.pr.number), [7]);
});

test("@Revisor de PRs explains what it needs when there is no PR to review", async () => {
  const ask = { ts: "300.0", user: "UDEV", text: "<@UREV> ayuda" };
  const { client, posts } = fakeClient([ask]);
  const out = await onReviewerMention({ config, mention: { channel: "C1", ts: ask.ts, threadTs: ask.ts, user: "UDEV", text: ask.text }, token: "x", client });
  assert.equal(out.requested, 0);
  assert.equal(hooks.length, 0);
  assert.match(posts[0].text, /enlace del PR/);
});

test("@Corrector de fallas starts the Corrector in a failure's thread and refuses elsewhere", async () => {
  const report = {
    ts: "400.0",
    bot_id: "B1",
    text: ":rotating_light: _Falla nueva en Super App Android 1.5.10 (295)_ · No fatal · `Arranque.init` 4 eventos · 3 usuarios · Ref. CR-E6CF6D",
  };
  const ask = { ts: "401.0", user: "UDEV", text: "<@UFIX> corrige esta falla" };
  const { client, posts } = fakeClient([report, ask]);
  const out = await onFixerMention({ config, mention: { channel: "C1", ts: ask.ts, threadTs: report.ts, user: "UDEV", text: ask.text }, token: "x", client });
  assert.equal(out.requested, 1);
  assert.deepEqual(hooks.map((h) => [h.url, h.payload.requested_by, h.payload.failure.ref]), [["https://hooks.test/fixer", "UDEV", "CR-E6CF6D"]]);
  assert.match(posts[0].text, /Corrector\* toma esta falla/);

  hooks = [];
  const pr = { ts: "403.0", user: "UDEV", text: `Lo tomo: <${ANDROID}>` };
  const again = (text) => ({ channel: "C1", ts: "404.0", threadTs: report.ts, user: "UDEV", text });
  const withPr = fakeClient([report, pr, { ts: "404.0", user: "UDEV", text: "x" }]);
  assert.equal((await onFixerMention({ config, mention: again("<@UFIX> corrige esta falla"), token: "x", client: withPr.client })).requested, 0);
  assert.match(withPr.posts[0].text, /es una corrección nueva/);
  assert.equal((await onFixerMention({ config, mention: again("<@UFIX> corrige esta falla, es una corrección nueva"), token: "x", client: withPr.client })).requested, 1);

  hooks = [];
  const other = fakeClient([parent, { ts: "402.0", user: "UDEV", text: "<@UFIX> corrige" }]);
  const refused = await onFixerMention({ config, mention: { channel: "C1", ts: "402.0", threadTs: parent.ts, user: "UDEV", text: "<@UFIX> corrige" }, token: "x", client: other.client });
  assert.equal(refused.requested, 0);
  assert.equal(hooks.length, 0);
  assert.match(other.posts[0].text, /hilo de la falla/);
});

test("@Pruebas de PRs runs the tests of the Android PR only", async () => {
  const twin = { ts: "101.0", bot_id: "BMON", text: `<${IOS}|PR #7>` };
  const ask = { ts: "500.0", user: "UDEV", text: "<@UTEST> corre las pruebas" };
  const { client, posts } = fakeClient([parent, twin, ask]);
  const out = await onTesterMention({ config, mention: { channel: "C1", ts: ask.ts, threadTs: parent.ts, user: "UDEV", text: ask.text }, token: "x", client });
  assert.equal(out.requested, 1);
  assert.deepEqual(hooks.map((h) => [h.url, h.payload.source, h.payload.pr.number]), [["https://hooks.test/tester", "pr-tests-request", 9]]);
  assert.match(posts[0].text, /^:test_tube: Corriendo pruebas/);
});
