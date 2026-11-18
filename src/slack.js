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
  return {
    channel,
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

/** `<@U…>` for the bot behind a token, so the thread can mention the analyst without copying its member ID. */
export async function botMention(token) {
  token = clean(token);
  if (!token) return null;
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack auth.test: ${body.error}`);
  return `<@${body.user_id}>`;
}

export async function triggerWebhook(payload) {
  const url = clean(process.env.ANALYST_WEBHOOK_URL);
  const key = clean(process.env.ANALYST_WEBHOOK_KEY);
  if (!url || !key) throw new Error("faltan ANALYST_WEBHOOK_URL o ANALYST_WEBHOOK_KEY");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook ${res.status}: ${text.slice(0, 200)}`);
  return text;
}
