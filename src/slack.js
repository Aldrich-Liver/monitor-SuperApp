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
