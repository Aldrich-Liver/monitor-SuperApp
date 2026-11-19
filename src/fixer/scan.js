import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { FIX_ASK, pendingBotMentions } from "../reviewer/thread.js";
import { botIdentity, slackClient } from "../slack.js";
import { FixRefused, requestFix } from "./requests.js";

const { values: args } = parseArgs({
  options: {
    hours: { type: "string", default: "26" },
    "min-age-min": { type: "string", default: "5" },
    config: { type: "string", default: "config/apps.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const token = process.env.SLACK_FIXER_BOT_TOKEN?.trim();
if (!token) {
  console.log("Sin SLACK_FIXER_BOT_TOKEN: no hay menciones al Corrector que buscar.");
  process.exit(0);
}
const reader = slackClient();
if (!reader) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL para leer el canal.");
  process.exit(1);
}

const config = readJson(args.config);
const fixer = await botIdentity(token);
const poster = slackClient({ token });
const dryRun = args["dry-run"];
const answer = async (text, threadTs) => {
  if (dryRun) return console.log(`--- respuesta en hilo ---\n${text}\n`);
  await poster.post(text, threadTs).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
};

// Each mention gets one answer from the Corrector, even a refusal; that answer is what marks it as handled.
let requested = 0;
const FAILURE_REPORT = /Ref\. CR-[0-9A-F]{6}/i;
const found = await pendingBotMentions(reader, fixer, { hours: Number(args.hours), minAgeMin: Number(args["min-age-min"]), asks: FIX_ASK });
// Without the bot's mention, only a request in a failure's thread counts as asking the Corrector.
const pending = found.filter((item) => item.via === "mention" || FAILURE_REPORT.test(item.messages[0]?.text ?? ""));
const threads = new Map();
for (const item of pending) threads.set(item.thread_ts, item);
for (const item of threads.values()) {
  try {
    await requestFix({ config, reader, poster, thread: item.messages, requester: item.request.user ?? null, via: "slack-mention", dryRun });
    requested++;
  } catch (err) {
    console.error(`No se pudo pedir la corrección del hilo ${item.thread_ts}: ${err.message}`);
    const notice = err instanceof FixRefused ? err.notice ?? `:information_source: ${err.message}` : null;
    if (notice) await answer(notice, item.thread_ts);
  }
}
console.log(`${pending.length} petición(es) pendiente(s) al Corrector; correcciones pedidas: ${requested}.`);
