import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { botIdentity, slackClient } from "../slack.js";
import { appForRepo, reviewableRepos } from "./pr.js";
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
const pending = await pendingMentions(reader, reviewer, { hours: Number(args.hours), minAgeMin: Number(args["min-age-min"]) });

let requested = 0;
for (const item of pending) {
  const prs = item.prs.filter((p) => appForRepo(config, p.repo));
  if (!prs.length && !args["dry-run"]) {
    const text = `:information_source: Solo reviso PRs de ${reviewableRepos(config).join(" o ")}.`;
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
