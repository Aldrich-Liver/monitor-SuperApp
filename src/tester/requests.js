import { testsAckText, testerUnavailableText } from "../format.js";
import { appForRepo } from "../reviewer/pr.js";
import { triggerWebhook } from "../slack.js";

export const testableApp = (config, pr) => {
  const app = appForRepo(config, pr.repo);
  return app && /android/i.test(app.name) ? app : null;
};

/** Acknowledges in the thread and starts the Pruebas de PRs automation through its webhook trigger. */
export async function requestTests({ config, pr, channel, threadTs, requester, poster }) {
  const app = testableApp(config, pr);
  if (!app) throw new Error(`${pr.repo} no se prueba en la nube`);
  const say = (text) => poster.post(text, threadTs).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
  await say(testsAckText({ pr }));
  const payload = {
    source: "pr-tests-request",
    pr: { url: pr.url, owner: pr.owner, repo: pr.repo, number: pr.number },
    app: app.name,
    channel,
    thread_ts: threadTs,
    requested_by: requester,
  };
  try {
    await triggerWebhook(payload, {
      url: process.env.TESTER_WEBHOOK_URL,
      key: process.env.TESTER_WEBHOOK_KEY,
      names: "TESTER_WEBHOOK_URL o TESTER_WEBHOOK_KEY",
    });
  } catch (err) {
    await say(testerUnavailableText(err.message));
    throw err;
  }
  return payload;
}
