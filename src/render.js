import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { readJson, writeJson } from "./files.js";
import { errorText, neutralize, summaryText, versionText } from "./format.js";
import { slackClient } from "./slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    out: { type: "string", default: ".monitor/messages.json" },
    thread: { type: "string", default: ".monitor/thread.json" },
    "post-with-bot": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
const failures = result.findings.filter((f) => f.type === "failure");
const errors = result.findings.filter((f) => f.type === "error");
const version = result.findings.find((f) => f.type === "new_version");

const messages = errors.map((e) => errorText(e.message, { esc: neutralize }));
if (version) messages.push(versionText(version, { esc: neutralize }));
if (failures.length) {
  const ref = `CR-${randomBytes(3).toString("hex").toUpperCase()}`;
  messages.push(summaryText(result, failures, { esc: neutralize, ref }));
  writeJson(args.thread, { ref, renderedAt: new Date().toISOString() });
}
writeJson(args.out, messages);

if (!messages.length) console.log("Sin fallas: no hay nada que enviar.");
else console.log(`${messages.length} mensaje(s) para enviar con Send to Slack: ${args.out}`);

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
