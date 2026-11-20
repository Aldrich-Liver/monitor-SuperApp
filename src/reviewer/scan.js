import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { botIdentity, slackClient } from "../slack.js";
import { appForRepo } from "./pr.js";
import { requestReview } from "./requests.js";
import { pendingMentions } from "./thread.js";

const { values: args } = parseArgs({
  options: {
    hours: { type: "string", default: "26" },
    "min-age-min": { type: "string", default: "5" },
    config: { type: "string", default: "config/apps.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const token = process.env.SLACK_REVIEWER_BOT_TOKEN?.trim();
if (!token) {
  console.log("Sin SLACK_REVIEWER_BOT_TOKEN: no hay menciones al Revisor que buscar.");
  process.exit(0);
}
const reader = slackClient();
if (!reader) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL para leer el canal.");
  process.exit(1);
}

const config = readJson(args.config);
const reviewer = await botIdentity(token);
const poster = slackClient({ token });
const pending = await pendingMentions(reader, reviewer, { hours: Number(args.hours), minAgeMin: Number(args["min-age-min"]), cursorUserId: config.cursorUserId });

let requested = 0;
const seen = new Set();
for (const item of pending.sort((a, b) => Number(b.request.ts) - Number(a.request.ts))) {
  const all = item.prs.filter((p) => !seen.has(`${item.thread_ts} ${p.url}`));
  for (const p of item.prs) seen.add(`${item.thread_ts} ${p.url}`);
  if (!all.length) continue;
  const prs = all.filter((p) => appForRepo(config, p.repo));
  if (!prs.length && !args["dry-run"]) {
    const apps = config.apps.filter((a) => a.sourceRepo).map((a) => a.name);
    const text = `:information_source: Solo reviso PRs de ${apps.join(" o ")}.`;
    await poster.post(text, item.thread_ts).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
  }
  for (const pr of prs) {
    try {
      await requestReview({ config, pr, thread: item, channel: reader.channel, via: "slack-mention", poster, dryRun: args["dry-run"] });
      requested++;
    } catch (err) {
      console.error(`No se pudo pedir la revisión de ${pr.url}: ${err.message}`);
    }
  }
}
console.log(`${pending.length} petición(es) pendiente(s) al Revisor; revisiones pedidas: ${requested}.`);
