import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { slackClient } from "../slack.js";
import { appForRepo, mentionsPr, parsePr, reviewableRepos } from "./pr.js";
import { requestReview } from "./requests.js";
import { findPrThread } from "./thread.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    thread: { type: "string" },
    base: { type: "string" },
    via: { type: "string" },
    hours: { type: "string", default: "48" },
    wait: { type: "string", default: "0" },
    config: { type: "string", default: "config/apps.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const config = readJson(args.config);
const pr = parsePr(positionals.join(" "));
if (!pr) {
  console.error("Uso: npm run review:request -- <URL del PR en GitHub> [--thread <ts>] [--base <rama>] [--via <origen>] [--wait <s>] [--dry-run]");
  process.exit(1);
}
if (!appForRepo(config, pr.repo)) {
  console.error(`Solo reviso PRs de ${reviewableRepos(config).join(" o ")}; ${pr.repo} no es uno de ellos.`);
  process.exit(1);
}

const dryRun = args["dry-run"];
const reader = slackClient();
const poster = slackClient({
  token: process.env.SLACK_REVIEWER_BOT_TOKEN || process.env.SLACK_ANALYST_BOT_TOKEN || process.env.SLACK_BOT_TOKEN,
});

async function locateThread() {
  if (!reader) {
    console.error("Sin SLACK_BOT_TOKEN o SLACK_CHANNEL: la revisión irá solo al PR de GitHub.");
    return null;
  }
  if (args.thread) {
    const messages = await reader.replies(args.thread).catch((err) => {
      console.error(`No se pudo leer el hilo ${args.thread}: ${err.message}`);
      return [];
    });
    const request = [...messages].reverse().find((m) => mentionsPr(m.text, pr)) ?? null;
    return { thread_ts: args.thread, request, messages };
  }
  // Slack may take a few seconds to list a message Cursor just posted with the link.
  const deadline = Date.now() + Number(args.wait) * 1000;
  let found = await findPrThread(reader, pr, { hours: Number(args.hours) });
  while (!found && Date.now() < deadline) {
    await sleep(5000);
    found = await findPrThread(reader, pr, { hours: Number(args.hours) });
  }
  if (!found) console.error(`No encontré en el canal un mensaje con ${pr.url} en las últimas ${args.hours} h: la revisión irá solo al PR.`);
  return found;
}

const thread = await locateThread();
if (thread) console.log(`Hilo: ${thread.thread_ts}${thread.request ? ` (mensaje ${thread.request.ts})` : ""}.`);
try {
  await requestReview({
    config,
    pr,
    thread,
    channel: reader?.channel ?? null,
    via: args.via ?? (args.thread ? "automation" : "slack-cursor"),
    base: args.base,
    poster,
    dryRun,
  });
} catch (err) {
  console.error(`No se pudo activar al Revisor: ${err.message}`);
  process.exit(1);
}
console.log(`${dryRun ? "(dry-run) " : ""}Revisión pedida: ${pr.url}${thread ? "; el resultado llegará al hilo." : "."}`);
