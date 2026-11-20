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

const fromBot = (m, bot) => m.user === bot.userId || (bot.botId && m.bot_id === bot.botId);

/** Whether the bot already answered in the thread after the request. */
export function answered(messages, request, reviewer) {
  return messages.some((m) => Number(m.ts) > Number(request.ts) && fromBot(m, reviewer));
}

/**
 * Whether the Revisor answered after the request about every PR it links. Its answer to another
 * PR asked earlier in the same thread does not count for this one; a notice that links no PR, like
 * "Solo reviso PRs de…", answers them all.
 */
export function answeredEveryPr(messages, request, reviewer) {
  const later = messages.filter((m) => Number(m.ts) > Number(request.ts) && fromBot(m, reviewer)).map(textOf);
  if (later.some((text) => !prUrls(text).length)) return true;
  return requestedPrs(request, messages).every((pr) => later.some((text) => mentionsPr(text, pr)));
}

/**
 * Messages that mention the reviewer bot, or ask for a review, next to a PR link and have no reviewer
 * reply after them. The bot does not receive Slack events, so the monitor runs this to pick them up.
 */
export async function pendingMentions(slack, reviewer, { cursorUserId = null, ...options } = {}) {
  const pending = await pendingBotMentions(slack, reviewer, { asks: askPattern(cursorUserId, REVIEW_VERBS), isAnswered: answeredEveryPr, ...options });
  return pending.map((item) => ({ ...item, prs: requestedPrs(item.request, item.messages) })).filter((item) => item.prs.length);
}

/**
 * The PRs a request is about: the ones it links or, when it links none, every PR linked in its
 * thread, so `@Revisor de PRs revisa` in a PR's thread needs no link.
 */
export function requestedPrs(request, messages = []) {
  const own = prUrls(textOf(request));
  if (own.length) return own;
  const seen = new Set();
  return messages.flatMap((m) => prUrls(textOf(m))).filter((pr) => !seen.has(pr.url) && seen.add(pr.url));
}

/**
 * A request to @Cursor (by its Slack member ID) in the same message as one of `verbs`. Messages
 * that mention anyone else don't count, so asking a teammate to fix something never starts an agent.
 */
export function askPattern(userId, verbs) {
  return userId ? new RegExp(`<@${userId}>[\\s\\S]*\\b(${verbs})`, "i") : null;
}
export const REVIEW_VERBS = "revis";
export const FIX_VERBS = "corrige\\b|corregir\\b|corrijan?\\b|arregla\\b|arreglar\\b";

const fromPerson = (m) => Boolean(m.user) && !m.bot_id && m.subtype !== "bot_message";

/**
 * Messages that mention a bot, or that a person wrote matching `asks`, with no reply from the bot
 * after them, with their thread. `via` says which of the two it was. A reply to a message the
 * automations posted with Send to Slack goes back to that automation's run and never reaches the bot,
 * so the monitor looks for these requests. `minAgeMin` leaves time to the @Cursor agent that may
 * already be handling a request made outside those threads.
 */
export async function pendingBotMentions(slack, bot, { hours = 26, now = Date.now(), asks = null, minAgeMin = 0, isAnswered = answered } = {}) {
  const oldest = secondsAgo(hours, now);
  const newest = (now - minAgeMin * 60 * 1000) / 1000;
  const tag = `<@${bot.userId}>`;
  const pending = [];
  for (const parent of await recentThreads(slack, hours, now)) {
    const messages = await threadMessages(slack, parent);
    for (const m of messages) {
      const ts = Number(m.ts);
      if (ts < oldest || ts > newest || m.user === bot.userId) continue;
      const text = m.text ?? "";
      const via = text.includes(tag) ? "mention" : asks && fromPerson(m) && asks.test(text) ? "ask" : null;
      if (!via || isAnswered(messages, m, bot)) continue;
      pending.push({ thread_ts: parent.ts, request: m, messages, via });
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
