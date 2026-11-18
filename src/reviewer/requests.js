import { reviewAckText, reviewerUnavailableText } from "../format.js";
import { triggerWebhook } from "../slack.js";
import { appForRepo } from "./pr.js";
import { threadContext } from "./thread.js";

export function reviewPayload({ pr, app, channel, thread, via, base }) {
  const requester = thread?.request?.user && !thread.request.bot_id ? thread.request.user : null;
  return {
    source: "pr-review-request",
    via,
    pr: { url: pr.url, owner: pr.owner, repo: pr.repo, number: pr.number, ...(base ? { base } : {}) },
    app: app.name,
    channel: thread ? channel : null,
    thread_ts: thread?.thread_ts ?? null,
    request_ts: thread?.request?.ts ?? null,
    requested_by: requester,
    thread: thread ? threadContext(thread.messages ?? []) : [],
  };
}

/**
 * Acknowledges in the thread and starts the Revisor Crashlytics automation. The acknowledgment is
 * also what tells `review:scan` that a mention was already picked up.
 */
export async function requestReview({ config, pr, thread, channel, via, base, poster, dryRun }) {
  const app = appForRepo(config, pr.repo);
  if (!app) throw new Error(`${pr.repo} no es un repo de las apps monitoreadas`);
  const payload = reviewPayload({ pr, app, channel, thread, via, base });

  const say = async (text) => {
    if (!payload.thread_ts) return;
    if (dryRun) return console.log(`--- respuesta en hilo ---\n${text}\n`);
    await poster.post(text, payload.thread_ts).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
  };

  await say(reviewAckText({ pr, app: app.name, requester: payload.requested_by }));
  if (dryRun) {
    console.log(`--- payload para el Revisor ---\n${JSON.stringify(payload, null, 2)}`);
    return payload;
  }
  try {
    await triggerWebhook(payload, {
      url: process.env.REVIEWER_WEBHOOK_URL,
      key: process.env.REVIEWER_WEBHOOK_KEY,
      names: "REVIEWER_WEBHOOK_URL o REVIEWER_WEBHOOK_KEY",
    });
  } catch (err) {
    await say(reviewerUnavailableText(err.message));
    throw err;
  }
  return payload;
}
