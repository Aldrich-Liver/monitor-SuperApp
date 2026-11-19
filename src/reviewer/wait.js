import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { writeJson } from "../files.js";
import { slackClient } from "../slack.js";
import { prUrls } from "./pr.js";
import { reviewVerdict } from "./thread.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    thread: { type: "string" },
    out: { type: "string", default: ".reviewer/verdicts.json" },
    "timeout-min": { type: "string", default: "30" },
    every: { type: "string", default: "30" },
  },
});

const prs = prUrls(positionals.join(" "));
if (!prs.length || !args.thread) {
  console.error("Uso: npm run review:wait -- <URL del PR> [<URL del PR>…] --thread <ts del hilo> [--timeout-min 30]");
  process.exit(1);
}
const slack = slackClient();
if (!slack) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL para leer el hilo.");
  process.exit(1);
}

// The Revisor answers in the thread; this waits for the verdict of the latest review asked for each PR.
const deadline = Date.now() + Number(args["timeout-min"]) * 60 * 1000;
let verdicts = [];
for (;;) {
  const messages = await slack.replies(args.thread).catch((err) => {
    console.error(`No se pudo leer el hilo: ${err.message}`);
    return null;
  });
  if (messages) {
    verdicts = prs.map((pr) => ({ pr: pr.url, ...(reviewVerdict(messages, pr) ?? { status: "not-requested", ts: null, text: null }) }));
    if (verdicts.every((v) => v.status !== "pending")) break;
  }
  if (Date.now() >= deadline) {
    verdicts = verdicts.map((v) => (v.status === "pending" ? { ...v, status: "timeout" } : v));
    break;
  }
  await sleep(Number(args.every) * 1000);
}

writeJson(args.out, verdicts);
for (const v of verdicts) console.log(`${v.pr}: ${v.status}`);
console.log(`Veredictos: ${args.out}`);
