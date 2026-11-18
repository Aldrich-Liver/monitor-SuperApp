import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { reviewText } from "../format.js";
import { slackClient } from "../slack.js";

const { values: args } = parseArgs({
  options: {
    context: { type: "string", default: ".reviewer/context.json" },
    payload: { type: "string", default: ".reviewer/payload.json" },
    review: { type: "string", default: ".reviewer/review.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const review = readJson(args.review);
if (!["approve", "changes", "error"].includes(review?.verdict)) {
  console.error(`${args.review} debe tener "verdict": "approve", "changes" o "error".`);
  process.exit(1);
}
// When review:context failed there is no context yet; the request itself is enough to answer.
const context = readJson(args.context) ?? readJson(args.payload);
if (!context?.pr) {
  console.error(`Faltan ${args.context} y ${args.payload}.`);
  process.exit(1);
}

const text = reviewText(context, review);
if (args["dry-run"]) {
  console.log(`--- respuesta en hilo ---\n${text}`);
  process.exit(0);
}
if (!context.thread_ts || !context.channel) {
  console.log("La solicitud no vino de un hilo de Slack: no hay dónde responder.");
  process.exit(0);
}
const slack = slackClient({
  token: process.env.SLACK_REVIEWER_BOT_TOKEN || process.env.SLACK_ANALYST_BOT_TOKEN || process.env.SLACK_BOT_TOKEN,
  channel: context.channel,
});
if (!slack) {
  console.error("Falta SLACK_REVIEWER_BOT_TOKEN (o SLACK_ANALYST_BOT_TOKEN / SLACK_BOT_TOKEN).");
  process.exit(1);
}
await slack.post(text, context.thread_ts);
console.log(`Revisión publicada en el hilo (${review.verdict}).`);
