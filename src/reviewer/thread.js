import { mentionsPr, prUrls } from "./pr.js";

const CONTEXT_CHARS = 8000;
const MESSAGE_CHARS = 1200;
const MAX_THREADS = 60;

const secondsAgo = (hours, now = Date.now()) => (now - hours * 3600 * 1000) / 1000;

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textOf(m) {
  const parts = [m.text ?? ""];
  for (const a of m.attachments ?? []) parts.push(a.text ?? "", a.fallback ?? "", a.from_url ?? "");
  return parts.join("\n");
}

function author(m) {
  if (m.bot_id || m.subtype === "bot_message") return m.bot_profile?.name ?? m.username ?? "bot";
  return m.user ? `<@${m.user}>` : "desconocido";
}

/**
 * What the reviewer reads from the thread: the report that opened it and the latest replies, such as
 * the analyst's cause and fix. Oldest first, capped so the webhook payload stays small.
 */
export function threadContext(messages) {
  const items = messages.map((m) => ({ ts: m.ts, author: author(m), text: truncate(m.text ?? "", MESSAGE_CHARS) }));
  if (!items.length) return [];
  const [parent, ...rest] = items;
  const kept = [];
  let size = parent.text.length;
  for (const item of rest.reverse()) {
    if (size + item.text.length > CONTEXT_CHARS) break;
    size += item.text.length;
    kept.unshift(item);
  }
  return [parent, ...kept];
}

/** Threads with recent activity, newest activity first; a PR link posted now makes its thread recent. */
async function recentThreads(slack, hours, now) {
  const oldest = secondsAgo(hours, now);
  const top = await slack.history(secondsAgo(24 * 45, now));
  return top
    .filter((m) => Number(m.latest_reply ?? 0) >= oldest || Number(m.ts) >= oldest)
    .sort((a, b) => Number(b.latest_reply ?? b.ts) - Number(a.latest_reply ?? a.ts))
    .slice(0, MAX_THREADS);
}

async function threadMessages(slack, parent) {
  return parent.reply_count ? slack.replies(parent.ts) : [parent];
}

/**
 * The most recent message in the channel that links the PR, with its thread. Used when the request
 * comes from @Cursor, which knows the PR link but not the Slack thread it was asked in.
 */
export async function findPrThread(slack, pr, { hours = 48, now = Date.now() } = {}) {
  let best = null;
  for (const parent of await recentThreads(slack, hours, now)) {
    const messages = await threadMessages(slack, parent);
    for (const m of messages) {
      if (!mentionsPr(textOf(m), pr)) continue;
      if (!best || Number(m.ts) > Number(best.request.ts)) best = { thread_ts: parent.ts, request: m, messages };
    }
  }
  return best;
}

/** Whether the reviewer bot already answered in the thread after the request. */
export function answered(messages, request, reviewer) {
  return messages.some(
    (m) => Number(m.ts) > Number(request.ts) && (m.user === reviewer.userId || (reviewer.botId && m.bot_id === reviewer.botId))
  );
}

/**
 * Messages that mention the reviewer bot next to a PR link and have no reviewer reply after them.
 * The bot does not receive Slack events, so the hourly monitor runs this to pick those mentions up.
 */
export async function pendingMentions(slack, reviewer, { hours = 26, now = Date.now() } = {}) {
  const pending = await pendingBotMentions(slack, reviewer, { hours, now });
  return pending.map((item) => ({ ...item, prs: prUrls(textOf(item.request)) })).filter((item) => item.prs.length);
}

/**
 * Messages that mention a bot and have no reply from it after them, with their thread. The bots
 * don't receive Slack events, so the hourly monitor looks for their mentions.
 */
export async function pendingBotMentions(slack, bot, { hours = 26, now = Date.now() } = {}) {
  const oldest = secondsAgo(hours, now);
  const tag = `<@${bot.userId}>`;
  const pending = [];
  for (const parent of await recentThreads(slack, hours, now)) {
    const messages = await threadMessages(slack, parent);
    for (const m of messages) {
      if (Number(m.ts) < oldest || m.user === bot.userId || !(m.text ?? "").includes(tag)) continue;
      if (answered(messages, m, bot)) continue;
      pending.push({ thread_ts: parent.ts, request: m, messages });
    }
  }
  return pending;
}

const REVIEW_ACK = /^:eyes: /;
const REVIEWER_DOWN = /^:warning: No se pudo activar al Revisor/;
const VERDICTS = [
  [/^:white_check_mark: \*Visto bueno\*/, "approve"],
  [/^:warning: \*Cambios necesarios\*/, "changes"],
  [/^:x: \*No pude revisar el\*/, "error"],
];

/**
 * The Revisor's answer to the latest review requested for a PR in the thread: `pending` while it
 * works, then `approve`, `changes` or `error`, with the text it posted. Null when it was never asked.
 */
export function reviewVerdict(messages, pr) {
  let result = null;
  for (const m of messages) {
    const text = m.text ?? "";
    if (mentionsPr(text, pr) && REVIEW_ACK.test(text)) {
      result = { status: "pending", ts: m.ts, text: null };
      continue;
    }
    if (result?.status !== "pending") continue;
    if (REVIEWER_DOWN.test(text)) result = { status: "error", ts: m.ts, text };
    else if (mentionsPr(text, pr)) {
      const found = VERDICTS.find(([re]) => re.test(text));
      if (found) result = { status: found[1], ts: m.ts, text };
    }
  }
  return result;
}
