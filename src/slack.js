export function slackTransport() {
  const token = process.env.SLACK_BOT_TOKEN;
  const target = process.env.SLACK_TARGET;
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (token && target) return { kind: "bot", send: (msg) => postWithBot(token, target, msg) };
  if (webhook) return { kind: "webhook", send: (msg) => postWithWebhook(webhook, msg) };
  return null;
}

async function postWithBot(token, channel, message) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, unfurl_links: false, ...message }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack chat.postMessage: ${body.error}`);
}

async function postWithWebhook(url, message) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text()}`);
}
