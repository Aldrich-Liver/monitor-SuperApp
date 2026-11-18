import { parseArgs } from "node:util";
import { readJson, writeJson } from "../files.js";
import { detailText } from "../format.js";
import { slackClient } from "../slack.js";
import { mergeCache } from "./cache.js";

const { values: args } = parseArgs({
  options: {
    details: { type: "string", default: ".analyst/details.json" },
    analysis: { type: "string", default: ".analyst/analysis.json" },
    cache: { type: "string", default: ".analyst/cache.json" },
    "next-cache": { type: "string", default: ".analyst/cache.next.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const details = readJson(args.details);
const written = readJson(args.analysis, {});
const { cache, resolved } = mergeCache(readJson(args.cache, {}), details.failures, written);

const dryRun = args["dry-run"];
const slack = dryRun
  ? null
  : slackClient({ token: process.env.SLACK_ANALYST_BOT_TOKEN || process.env.SLACK_BOT_TOKEN, channel: details.channel });
if (!slack && !dryRun) {
  console.error("Falta SLACK_ANALYST_BOT_TOKEN o SLACK_BOT_TOKEN. Usa --dry-run para ver los mensajes.");
  process.exit(1);
}

const total = details.failures.length;
for (const [i, f] of details.failures.entries()) {
  const text = detailText(f, resolved.get(f.key), i + 1, total);
  if (dryRun) console.log(`--- respuesta ${i + 1}/${total} ---\n${text}\n`);
  else await slack.post(text, details.thread_ts);
}

writeJson(args["next-cache"], cache, false);
console.log(`${dryRun ? "(dry-run) " : ""}${total} respuesta(s) en el hilo. Caché: ${args["next-cache"]}`);
