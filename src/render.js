import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { normalizeState } from "./detect.js";
import { readJson, writeJson } from "./files.js";
import { bugReportText, errorText, neutralize, versionText } from "./format.js";
import { slackClient } from "./slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    state: { type: "string", default: ".monitor/state.next.json" },
    out: { type: "string", default: ".monitor/messages.json" },
    thread: { type: "string", default: ".monitor/thread.json" },
    "post-with-bot": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
const state = normalizeState(readJson(args.state, null));
const errors = result.findings.filter((f) => f.type === "error");
const version = result.findings.find((f) => f.type === "new_version");
const failures = new Map(result.findings.filter((f) => f.type === "failure").map((f) => [f.key, f]));

const messages = errors.map((e) => errorText(e.message, { esc: neutralize }));
if (version) messages.push(versionText(version, { esc: neutralize }));

// A bug still `new` from an earlier check whose report never got its thread is posted again.
const reports = [];
for (const bug of Object.values(state.bugs).filter((b) => b.status === "new")) {
  const f = failures.get(bug.key) ?? { ...bug, version: bug.lastVersion, newEvents: bug.events, impactedUsers: bug.users };
  bug.ref = `CR-${randomBytes(3).toString("hex").toUpperCase()}`;
  const text = bugReportText(f, { esc: neutralize, ref: bug.ref, test: Boolean(bug.test), testLabel: result.testLabel !== false });
  messages.push(text);
  reports.push({ key: bug.key, ref: bug.ref });
}

writeJson(args.state, state, false);
writeJson(args.thread, { renderedAt: new Date().toISOString(), reports });
writeJson(args.out, messages);

if (!messages.length) console.log("Sin fallas nuevas: no hay nada que enviar con Send to Slack.");
else console.log(`${messages.length} mensaje(s) para enviar con Send to Slack (${reports.length} falla(s) nueva(s)): ${args.out}`);

// For tests outside an automation, where Send to Slack isn't available.
if (args["post-with-bot"] && messages.length) {
  const slack = slackClient();
  if (!slack) {
    console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL.");
    process.exit(1);
  }
  for (const text of messages) await slack.post(text);
  console.log("Publicado con el bot del monitor en lugar de Cursor.");
}
