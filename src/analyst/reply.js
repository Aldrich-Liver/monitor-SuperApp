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

const threads = new Map();
for (const f of details.failures) {
  const ts = f.thread_ts ?? details.thread_ts;
  threads.set(ts, [...(threads.get(ts) ?? []), f]);
}
let failed = 0;
for (const [threadTs, group] of threads) {
  for (const [i, f] of group.entries()) {
    const text = detailText(f, resolved.get(f.key), i + 1, group.length);
    if (dryRun) console.log(`--- respuesta en el hilo ${threadTs} ---\n${text}\n`);
    else {
      await slack.post(text, threadTs).catch((err) => {
        failed++;
        console.error(`No se pudo responder en el hilo de ${f.key}: ${err.message}`);
      });
    }
  }
}

writeJson(args["next-cache"], cache, false);
console.log(
  `${dryRun ? "(dry-run) " : ""}${details.failures.length - failed} respuesta(s) en ${threads.size} hilo(s). Caché: ${args["next-cache"]}`
);
if (failed) process.exit(1);
