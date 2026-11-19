import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { writeJson } from "../files.js";
import { fetchPr } from "../reviewer/github.js";
import { parsePr } from "../reviewer/pr.js";
import { slackClient } from "../slack.js";
import { testsVerdict } from "./thread.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    thread: { type: "string" },
    out: { type: "string", default: ".tester/verdict.json" },
    "timeout-min": { type: "string", default: "25" },
    every: { type: "string", default: "30" },
  },
});

const pr = parsePr(positionals.join(" "));
if (!pr || !args.thread) {
  console.error("Uso: npm run tests:wait -- <URL del PR> --thread <ts del hilo> [--timeout-min 25]");
  process.exit(1);
}
const slack = slackClient();
if (!slack) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL para leer el hilo.");
  process.exit(1);
}

// Pruebas de PRs runs on every push GitHub reports; this waits for its result for the PR's latest commit.
const deadline = Date.now() + Number(args["timeout-min"]) * 60 * 1000;
let sha = null;
let verdict = null;
for (;;) {
  sha = (await fetchPr(pr))?.headSha ?? sha;
  const messages = await slack.replies(args.thread).catch((err) => {
    console.error(`No se pudo leer el hilo: ${err.message}`);
    return null;
  });
  verdict = messages && sha ? testsVerdict(messages, pr, sha) : null;
  if (verdict || Date.now() >= deadline) break;
  await sleep(Number(args.every) * 1000);
}

const result = { pr: pr.url, sha, ...(verdict ?? { status: "timeout", ts: null, text: null }) };
writeJson(args.out, result);
console.log(`${pr.url} @ ${sha?.slice(0, 7) ?? "?"}: ${result.status}. Resultado: ${args.out}`);
