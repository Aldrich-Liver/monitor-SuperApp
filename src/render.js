import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { digestBugs, digestDue } from "./bugs.js";
import { normalizeState } from "./detect.js";
import { readJson, writeJson } from "./files.js";
import { bugReportText, digestText, errorText, neutralize, versionText } from "./format.js";
import { slackClient } from "./slack.js";

const SEARCH_MARGIN_MS = 5 * 60 * 1000;

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    state: { type: "string", default: ".monitor/state.next.json" },
    config: { type: "string", default: "config/apps.json" },
    out: { type: "string", default: ".monitor/messages.json" },
    "post-with-bot": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
const config = readJson(args.config);
const state = normalizeState(readJson(args.state, null));
const now = new Date();
const newRef = () => `CR-${randomBytes(3).toString("hex").toUpperCase()}`;
const errors = result.findings.filter((f) => f.type === "error");
const version = result.findings.find((f) => f.type === "new_version");
const failures = new Map(result.findings.filter((f) => f.type === "failure").map((f) => [f.key, f]));

// Only reads the channel: a message rendered in an earlier check that Cursor did post is not sent again.
const slack = slackClient();
async function alreadyPosted(ref, renderedAt) {
  if (!slack || !ref || !renderedAt) return null;
  try {
    return (await slack.findRefs([ref], (Date.parse(renderedAt) - SEARCH_MARGIN_MS) / 1000)).get(ref) ?? null;
  } catch (err) {
    console.warn(`No se pudo buscar en el canal el mensaje Ref. ${ref}: ${err.message}`);
    return null;
  }
}

const messages = errors.map((e) => errorText(e.message, { esc: neutralize }));
if (version) messages.push(versionText(version, { esc: neutralize }));

let reports = 0;
for (const bug of Object.values(state.bugs).filter((b) => b.status === "new")) {
  if (bug.reportTs) continue;
  const ts = await alreadyPosted(bug.ref, bug.renderedAt);
  if (ts) {
    bug.reportTs = ts;
    continue;
  }
  bug.ref ??= newRef();
  bug.renderedAt = now.toISOString();
  const f = failures.get(bug.key) ?? { ...bug, version: bug.lastVersion, newEvents: bug.events, impactedUsers: bug.users };
  messages.push(bugReportText(f, { esc: neutralize, ref: bug.ref, test: Boolean(bug.test), testLabel: result.testLabel !== false }));
  reports++;
}

let digest = false;
const digestDay = result.test ? null : digestDue(now, state.digestOn, config.digestHour ?? 9);
if (digestDay) {
  const open = digestBugs(state.bugs);
  const pending = state.digest?.day === digestDay ? state.digest : null;
  if (!open.length) {
    state.digestOn = digestDay;
    state.digest = null;
  } else if (!pending?.ts) {
    const ts = await alreadyPosted(pending?.ref, pending?.renderedAt);
    if (ts) state.digest = { ...pending, ts };
    else {
      const ref = pending?.ref ?? newRef();
      state.digest = { day: digestDay, ref, renderedAt: now.toISOString(), keys: open.map((b) => b.key) };
      messages.push(digestText(open, { now, quietHours: config.resolveAfterHours ?? 48, ref, esc: neutralize }));
      digest = true;
    }
  }
}

writeJson(args.state, state, false);
writeJson(args.out, messages);

if (!messages.length) console.log("No hay nada que enviar con Send to Slack.");
else {
  console.log(
    `${messages.length} mensaje(s) para enviar con Send to Slack (${reports} falla(s) nueva(s)${digest ? ", resumen de la mañana" : ""}): ${args.out}`
  );
}

// For tests outside an automation, where Send to Slack isn't available.
if (args["post-with-bot"] && messages.length) {
  if (!slack) {
    console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL.");
    process.exit(1);
  }
  for (const text of messages) await slack.post(text, null, { topLevel: true });
  console.log("Publicado con el bot del monitor en lugar de Cursor.");
}
