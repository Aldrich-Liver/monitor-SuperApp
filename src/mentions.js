import { mentionHelpText } from "./format.js";
import { FixRefused, requestFix } from "./fixer/requests.js";
import { appForRepo } from "./reviewer/pr.js";
import { requestReview } from "./reviewer/requests.js";
import { requestedPrs } from "./reviewer/thread.js";
import { slackClient } from "./slack.js";
import { requestTests, testableApp } from "./tester/requests.js";

/**
 * What each bot does when someone mentions it in Slack. The Agent SDK channels in `bot/channels`
 * call these the moment the mention arrives; `review:scan` and `fix:scan` pick up the ones they miss.
 *
 * `mention` is `{ channel, ts, threadTs, user, text }`. `token` is the mentioned bot's token: it reads
 * the thread and answers in it.
 */

async function threadOf(slack, mention) {
  const messages = await slack.replies(mention.threadTs).catch(() => []);
  const request = messages.find((m) => m.ts === mention.ts) ?? { ts: mention.ts, user: mention.user, text: mention.text };
  return { thread_ts: mention.threadTs, request, messages: messages.length ? messages : [request] };
}

/** "es una corrección nueva" asks for another fix even when the failure already has a PR. */
export const NEW_FIX = /correcci[oó]n nueva|nueva correcci[oó]n|otra correcci[oó]n/i;

const sourceApps = (config) => config.apps.filter((a) => a.sourceRepo).map((a) => a.name);

export async function onReviewerMention({ config, mention, token, client = slackClient }) {
  const slack = client({ token, channel: mention.channel });
  const thread = await threadOf(slack, mention);
  const prs = requestedPrs(thread.request, thread.messages);
  const reviewable = prs.filter((pr) => appForRepo(config, pr.repo));
  if (!reviewable.length) {
    const text = prs.length ? `:information_source: Solo reviso PRs de ${sourceApps(config).join(" o ")}.` : mentionHelpText("reviewer");
    await slack.post(text, mention.threadTs);
    return { requested: 0 };
  }
  let requested = 0;
  for (const pr of reviewable) {
    try {
      await requestReview({ config, pr, thread, channel: mention.channel, via: "slack-bot", poster: slack });
      requested++;
    } catch (err) {
      console.error(`No se pudo pedir la revisión de ${pr.url}: ${err.message}`);
    }
  }
  return { requested };
}

export async function onFixerMention({ config, mention, token, client = slackClient }) {
  const slack = client({ token, channel: mention.channel });
  const { messages, request } = await threadOf(slack, mention);
  try {
    const force = NEW_FIX.test(mention.text ?? "");
    await requestFix({ config, reader: slack, poster: slack, thread: messages, requester: request.user ?? null, force, via: "slack-bot" });
    return { requested: 1 };
  } catch (err) {
    console.error(`No se pudo pedir la corrección del hilo ${mention.threadTs}: ${err.message}`);
    if (err instanceof FixRefused) await slack.post(err.notice ?? mentionHelpText("fixer"), mention.threadTs);
    return { requested: 0 };
  }
}

export async function onTesterMention({ config, mention, token, client = slackClient }) {
  const slack = client({ token, channel: mention.channel });
  const thread = await threadOf(slack, mention);
  const prs = requestedPrs(thread.request, thread.messages).filter((pr) => testableApp(config, pr));
  if (!prs.length) {
    const apps = config.apps.filter((a) => a.sourceRepo && /android/i.test(a.name)).map((a) => a.name);
    await slack.post(mentionHelpText("tester", apps), mention.threadTs);
    return { requested: 0 };
  }
  let requested = 0;
  for (const pr of prs) {
    try {
      await requestTests({ config, pr, channel: mention.channel, threadTs: mention.threadTs, requester: mention.user ?? null, poster: slack });
      requested++;
    } catch (err) {
      console.error(`No se pudieron pedir las pruebas de ${pr.url}: ${err.message}`);
    }
  }
  return { requested };
}
