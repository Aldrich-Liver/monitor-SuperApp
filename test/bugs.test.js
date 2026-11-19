import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { containsChanges, git } from "../src/repos.js";
import { digestBugs, digestDue, markReleased, mergedPr, pruneResolved, resolveQuiet, syncPrs, trackFailures } from "../src/bugs.js";
import { digestLinksText, digestText, neutralize } from "../src/format.js";
import { slackClient } from "../src/slack.js";

const H = 60 * 60 * 1000;
const t0 = new Date("2026-11-18T18:00:00Z");
const at = (hours) => new Date(t0.getTime() + hours * H);
const failure = (id, newEvents = 3, version = "1.5.5 (290)") => ({
  type: "failure",
  key: `app:${id}`,
  appId: "app",
  app: "Super App Android",
  sourceRepo: "sw-crp-super-app-android",
  version,
  newEvents,
  impactedUsers: 2,
  issue: { id, title: `mx.liverpool.Clase${id}.metodo`, errorType: "FATAL", firstSeenVersion: "1.5.5" },
});
const pr = (number, state, extra = {}) => ({
  owner: "Aldrich-Liver",
  repo: "sw-crp-super-app-android",
  number,
  url: `https://github.com/Aldrich-Liver/sw-crp-super-app-android/pull/${number}`,
  state,
  ...extra,
});

function openBug(hours = 0) {
  const { bugs } = trackFailures({}, [failure("a")], at(hours));
  Object.assign(bugs["app:a"], { status: "open", thread_ts: "111.222", ref: "CR-AAA111" });
  return bugs;
}

test("a new issue becomes a bug to report; recurring events only add up, without notices", () => {
  const first = trackFailures({}, [failure("a")], t0);
  assert.deepEqual(first.opened, ["app:a"]);
  assert.equal(first.bugs["app:a"].status, "new");
  assert.equal(first.outbox.length, 0);

  const bugs = openBug();
  const again = trackFailures(bugs, [failure("a", 4)], at(1));
  assert.deepEqual([again.opened, again.reopened, again.outbox], [[], [], []]);
  assert.equal(again.bugs["app:a"].events, 7);
  assert.equal(again.bugs["app:a"].thread_ts, "111.222");
  assert.equal(bugs["app:a"].events, 3, "the input state is not modified");
});

test("a report still waiting for its thread keeps its Ref. and adds up its events", () => {
  const { bugs } = trackFailures({}, [failure("a")], t0);
  bugs["app:a"].ref = "CR-AAA111";
  const again = trackFailures(bugs, [failure("a", 2)], at(1));
  assert.deepEqual([again.opened, again.outbox], [[], []]);
  assert.deepEqual([again.bugs["app:a"].status, again.bugs["app:a"].ref, again.bugs["app:a"].events], ["new", "CR-AAA111", 5]);
});

test("a PR linked in the thread puts the bug in correction, and back to open if it closes unmerged", () => {
  const bug = openBug()["app:a"];
  const [fixing] = syncPrs(bug, [pr(7, "open")], 48);
  assert.equal(bug.status, "fixing");
  assert.match(fixing.text, /^:hammer_and_wrench: \*En corrección\* con el <https:\S+\/pull\/7\|PR #7>\./);
  assert.equal(syncPrs(bug, [pr(7, "open")], 48).length, 0, "no repeated notice");

  const [closed] = syncPrs(bug, [pr(7, "closed")], 48);
  assert.equal(bug.status, "open");
  assert.match(closed.text, /se cerró sin fusionarse/);
});

test("PRs whose GitHub state is unknown keep their last state", () => {
  const bug = openBug()["app:a"];
  syncPrs(bug, [pr(7, "open")], 48);
  syncPrs(bug, [pr(7, null)], 48);
  assert.equal(bug.prs[0].state, "open");
  assert.equal(bug.status, "fixing");
});

test("the merge is announced once and the release that includes it starts the 48 h countdown", () => {
  const bug = openBug()["app:a"];
  syncPrs(bug, [pr(7, "open")], 48);
  const [merged] = syncPrs(bug, [pr(7, "merged", { mergeCommit: "abc" })], 48);
  assert.match(merged.text, /ya está fusionado/);
  assert.equal(syncPrs(bug, [pr(7, "merged", { mergeCommit: "abc" })], 48).length, 0);

  assert.equal(mergedPr(bug).number, 7);
  assert.deepEqual(markReleased(bug, { version: "1.5.6 (291)", included: false, method: "commit" }, at(2), 48), []);
  const [released] = markReleased(bug, { version: "1.5.6 (291)", included: true, method: "commit" }, at(10), 48);
  assert.match(released.text, /^:package: \*1\.5\.6 \(291\)\* ya incluye el <\S+\|PR #7>\. Si no hay eventos/);
  assert.deepEqual(bug.fix, { version: "1.5.6 (291)", since: at(10).toISOString(), pr: 7, method: "commit" });
  assert.equal(mergedPr(bug), null);

  assert.deepEqual(resolveQuiet(bug, at(55), 48), [], "48 h count from the release, not from the last event");
  const [resolved] = resolveQuiet(bug, at(58), 48);
  assert.equal(resolved.broadcast, true);
  assert.match(resolved.text, /^:white_check_mark: \*Resuelto\* · Super App Android · `Clasea\.metodo`\n48 h sin eventos en 1\.5\.6 \(291\), que incluye el/);
  assert.equal(bug.status, "resolved");
});

test("a merged PR announced when it is first linked does not get a second merge notice", () => {
  const bug = openBug()["app:a"];
  const notices = syncPrs(bug, [pr(7, "merged", { mergeCommit: "abc" })], 48);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /En corrección.*Ya está fusionado/);
});

test("48 h without events resolves an open bug, posted in its thread and in the channel", () => {
  const bugs = openBug();
  assert.deepEqual(resolveQuiet(bugs["app:a"], at(47), 48), []);
  const [notice] = resolveQuiet(bugs["app:a"], at(48), 48);
  assert.deepEqual([notice.key, notice.broadcast], ["app:a", true]);
  assert.match(notice.text, /48 h sin eventos en 1\.5\.5 \(290\)\. Nadie ligó un PR/);
  assert.equal(bugs["app:a"].resolvedVersion, "1.5.5 (290)");
});

test("a resolved bug that comes back reopens in the same thread and forgets its old PRs", () => {
  const bugs = openBug();
  syncPrs(bugs["app:a"], [pr(7, "open")], 48);
  resolveQuiet(bugs["app:a"], at(50), 48);
  const back = trackFailures(bugs, [failure("a", 2, "1.5.6 (291)")], at(60));
  const bug = back.bugs["app:a"];
  assert.deepEqual(back.reopened, ["app:a"]);
  assert.deepEqual([bug.status, bug.thread_ts, bug.prs, bug.sinceDigest], ["open", "111.222", [], 2]);
  assert.equal(back.outbox[0].broadcast, true);
  assert.match(back.outbox[0].text, /^:warning: \*Volvió a aparecer\* · Super App Android 1\.5\.6 \(291\)/);

  syncPrs(bug, [pr(7, "open")], 48);
  assert.equal(bug.status, "open", "the PR of the previous round is not taken again");
  syncPrs(bug, [pr(7, "open"), pr(9, "open")], 48);
  assert.equal(bug.status, "fixing");
});

test("events after the fixed release reopen the bug", () => {
  const bug = openBug()["app:a"];
  syncPrs(bug, [pr(7, "merged", { mergeCommit: "abc" })], 48);
  const dated = structuredClone(bug);
  markReleased(bug, { version: "1.5.6 (291)", included: true, method: "commit" }, at(5), 48);
  const back = trackFailures({ "app:a": bug }, [failure("a", 1, "1.5.6 (291)")], at(6));
  assert.deepEqual(back.reopened, ["app:a"]);
  assert.match(back.outbox[0].text, /Ya salió el <\S+\|PR #7> en 1\.5\.6 \(291\) y no la resolvió/);
  assert.equal(back.bugs["app:a"].fix, null);

  const [released] = markReleased(dated, { version: "1.5.6 (291)", included: true, method: "date" }, at(5), 48);
  assert.match(released.text, /\(por fecha: salió después de la fusión/);
  const unsure = trackFailures({ "app:a": dated }, [failure("a", 1, "1.5.6 (291)")], at(6));
  assert.match(unsure.outbox[0].text, /Se esperaba el <\S+\|PR #7> en 1\.5\.6 \(291\), pero puede que esa versión no lo traiga/);
});

test("a build from another copy of the history includes the PR when it has its changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-repo-"));
  try {
    const commit = (files, message) => {
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      git(dir, ["add", "-A"]);
      git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message]);
      return git(dir, ["rev-parse", "HEAD"]);
    };
    git(dir, ["init", "-q", "-b", "main"]);
    commit({ "Pago.kt": "uno\ndos\ntres\n", "Otro.kt": "a\n" }, "base");
    const merged = commit({ "Pago.kt": "uno\ndos corregido\ntres\n" }, "PR #7");

    git(dir, ["checkout", "-q", "--orphan", "release"]);
    const withoutFix = commit({ "Pago.kt": "uno\ndos\ntres\n", "Otro.kt": "a\n" }, "release sin el PR");
    const withFix = commit({ "Pago.kt": "uno\ndos corregido\ntres\n", "Otro.kt": "b\n" }, "release con el PR y más cambios");

    assert.equal(containsChanges(dir, withFix, merged), true);
    assert.equal(containsChanges(dir, withoutFix, merged), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolved bugs are forgotten after 30 days", () => {
  const bugs = openBug();
  resolveQuiet(bugs["app:a"], at(48), 48);
  assert.ok(pruneResolved(bugs, at(48 + 29 * 24))["app:a"]);
  assert.equal(pruneResolved(bugs, at(48 + 31 * 24))["app:a"], undefined);
});

test("the morning summary goes out once a day from the configured hour, Mexico City time", () => {
  const nineCdmx = new Date("2026-11-19T15:00:00Z");
  assert.equal(digestDue(new Date("2026-11-19T14:59:00Z"), "2026-11-18", 9), null);
  assert.equal(digestDue(nineCdmx, "2026-11-18", 9), "2026-11-19");
  assert.equal(digestDue(nineCdmx, "2026-11-19", 9), null);
  assert.equal(digestDue(new Date("2026-11-20T05:00:00Z"), "2026-11-19", 9), null, "23:00 CDMX is still the 19th");
});

test("the summary lists open bugs first, with their thread links", () => {
  const { bugs } = trackFailures({}, [failure("a", 3), failure("b", 9)], t0);
  Object.assign(bugs["app:a"], { status: "open", thread_ts: "1.1" });
  Object.assign(bugs["app:b"], { status: "open", thread_ts: "2.2" });
  syncPrs(bugs["app:b"], [pr(7, "merged", { mergeCommit: "abc" })], 48);
  const { bugs: more } = trackFailures(bugs, [failure("c", 20)], t0);

  const open = digestBugs(more);
  assert.deepEqual(open.map((b) => b.key), ["app:a", "app:b"], "bugs without a thread are left out");
  open[0].ref = "CR-AAA111";
  const text = digestText(open, { now: t0, quietHours: 48, ref: "CR-DIG001", esc: neutralize });
  assert.match(text, /^:clipboard: \*Fallas abiertas de Crashlytics\* · 2 al 18 nov\.? · 1 sin PR, 1 en corrección/);
  assert.match(text, /`Clasea\.metodo` · 3 eventos en 24 h · desde el 18 nov\.? · sin PR · CR-AAA111\n/);
  assert.match(text, /en corrección con el PR #7 \(fusionado, espera versión\)\n/);
  assert.doesNotMatch(text, /<|Ref\. CR-AAA111/, "Cursor posts it: no link markup, and only its own Ref.");
  assert.match(text, /tras 48 h sin eventos\._\n:thread: Enlaces a cada hilo en este hilo\. · Ref\. CR-DIG001$/);

  const links = digestLinksText(open, { "app:a": "https://slack.example/p1" });
  assert.equal(links, ":link: *Hilos de las fallas abiertas*\n• <https://slack.example/p1|CR-AAA111> · Super App Android · `Clasea.metodo`");
  assert.equal(digestLinksText(open, {}), null);
});

test("bots never start a conversation in the channel", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { json: async () => ({ ok: true, ts: "9.9", channel: "C1" }) };
  };
  try {
    const slack = slackClient({ token: "xoxb-test", channel: "C1" });
    await assert.rejects(slack.post("hola"), /solo responden en hilos/);
    await slack.post("aviso", "1.1", { broadcast: true });
    assert.deepEqual(calls.map((c) => [c.thread_ts, c.reply_broadcast]), [["1.1", true]]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
