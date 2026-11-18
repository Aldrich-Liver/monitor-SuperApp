function clean(value) {
  return value?.replace(/[\r\n]/g, "").trim() || null;
}

/**
 * Posts as a Slack app bot. Using our own bot rather than the automation's Send to Slack tool is
 * what makes threads possible: chat.postMessage returns the message `ts` that replies attach to.
 */
export function slackClient({ token, channel } = {}) {
  token = clean(token ?? process.env.SLACK_BOT_TOKEN);
  channel = clean(channel ?? process.env.SLACK_CHANNEL);
  if (!token || !channel) return null;
  async function read(method, params) {
    const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams({ channel, ...params })}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`Slack ${method}: ${body.error}`);
    return body;
  }
  return {
    channel,
    /** Top-level messages since `oldest` (Slack seconds), newest first. */
    async history(oldest, { pages = 5 } = {}) {
      const messages = [];
      let cursor;
      for (let i = 0; i < pages; i++) {
        const body = await read("conversations.history", { oldest: String(oldest), limit: "200", ...(cursor ? { cursor } : {}) });
        messages.push(...body.messages);
        cursor = body.response_metadata?.next_cursor;
        if (!body.has_more || !cursor) break;
      }
      return messages;
    },
    /** The parent and every reply of a thread, oldest first. */
    async replies(threadTs) {
      const messages = [];
      let cursor;
      do {
        const body = await read("conversations.replies", { ts: threadTs, limit: "200", ...(cursor ? { cursor } : {}) });
        messages.push(...body.messages);
        cursor = body.has_more ? body.response_metadata?.next_cursor : null;
      } while (cursor);
      return messages;
    },
    /** Needs `groups:history` (private channel) or `channels:history` (public). */
    async findMessage(needle, oldestIso) {
      const params = new URLSearchParams({ channel, limit: "50" });
      if (oldestIso) params.set("oldest", String(new Date(oldestIso).getTime() / 1000));
      const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!body.ok) throw new Error(`Slack conversations.history: ${body.error}`);
      const found = body.messages.find((m) => JSON.stringify(m).includes(needle));
      return found ? { ts: found.ts, channel } : null;
    },
    async post(text, threadTs) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          channel,
          text,
          unfurl_links: false,
          unfurl_media: false,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(`Slack chat.postMessage: ${body.error}`);
      return { ts: body.ts, channel: body.channel };
    },
  };
}

/** The bot user behind a token: `{ userId, botId }`. */
export async function botIdentity(token) {
  token = clean(token);
  if (!token) return null;
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack auth.test: ${body.error}`);
  return { userId: body.user_id, botId: body.bot_id };
}

/** `<@U…>` for the bot behind a token, so the thread can mention the analyst without copying its member ID. */
export async function botMention(token) {
  const bot = await botIdentity(token);
  return bot ? `<@${bot.userId}>` : null;
}

export async function triggerWebhook(payload, { url, key, names = "ANALYST_WEBHOOK_URL o ANALYST_WEBHOOK_KEY" } = {}) {
  url = clean(url ?? process.env.ANALYST_WEBHOOK_URL);
  key = clean(key ?? process.env.ANALYST_WEBHOOK_KEY);
  if (!url || !key) throw new Error(`faltan ${names}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  return text;
}
