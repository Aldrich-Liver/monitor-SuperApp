import { fixAckText, fixerUnavailableText } from "../format.js";
import { threadContext } from "../reviewer/thread.js";
import { slackClient, triggerWebhook } from "../slack.js";
import { failureFromThread, fixInProgress, fixRequester, linkedFixPrs } from "./thread.js";

/** The Corrector answers with its own bot, or with the Analista's or the monitor's when it has none. */
export function fixerToken() {
  return process.env.SLACK_FIXER_BOT_TOKEN || process.env.SLACK_ANALYST_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
}

export function fixerPoster(channel) {
  return slackClient({ token: fixerToken(), ...(channel ? { channel } : {}) });
}

/** A request the Corrector turns down, with the reason to give in the thread or the console. */
export class FixRefused extends Error {
  constructor(message, { notice = null } = {}) {
    super(message);
    this.notice = notice;
  }
}

/**
 * Checks the bug's thread, acknowledges there and starts the Corrector automation. `thread` is the
 * parent and every reply. The acknowledgment is also what tells `fix:scan` that a mention was picked up.
 */
export async function requestFix({ config, reader, poster, thread, requester, force = false, via, dryRun = false }) {
  const parentTs = thread[0]?.ts;
  const say = async (text) => {
    if (dryRun) return console.log(`--- respuesta en hilo ---\n${text}\n`);
    await poster.post(text, parentTs).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
  };

  const failure = failureFromThread(thread, config);
  if (!failure) throw new FixRefused("Ese hilo no es el de una falla del monitor de Crashlytics.");
  if (!failure.sourceRepo) {
    throw new FixRefused(`${failure.app} no tiene sourceRepo en config/apps.json.`, {
      notice: `:information_source: No tengo el código de ${failure.app}: el Corrector solo trabaja en las apps con repo en el environment.`,
    });
  }
  const linked = linkedFixPrs(thread, failure.sourceRepo);
  if (linked.length && !force) {
    throw new FixRefused(`La falla ya tiene PR en su hilo (${linked.map((p) => p.url).join(", ")}). Usa --force para pedir otra corrección.`, {
      notice: ":information_source: Esta falla ya tiene PR en su hilo. Si hace falta otra corrección, pídela a @Cursor diciendo que es una corrección nueva.",
    });
  }
  if (fixInProgress(thread) && !force) throw new FixRefused("El Corrector ya está trabajando en esta falla; responde en el hilo cuando termine.");

  requester ??= fixRequester(thread);
  const payload = {
    source: "crash-fix-request",
    via,
    channel: reader.channel,
    thread_ts: parentTs,
    permalink: dryRun ? null : await reader.permalink(parentTs).catch(() => null),
    requested_by: requester,
    failure,
    thread: threadContext(thread),
  };

  await say(fixAckText({ requester, failure }));
  if (dryRun) {
    console.log(`--- payload para el Corrector ---\n${JSON.stringify(payload, null, 2)}`);
    return payload;
  }
  try {
    await triggerWebhook(payload, {
      url: process.env.FIXER_WEBHOOK_URL,
      key: process.env.FIXER_WEBHOOK_KEY,
      names: "FIXER_WEBHOOK_URL o FIXER_WEBHOOK_KEY",
    });
  } catch (err) {
    await say(fixerUnavailableText(err.message));
    throw err;
  }
  return payload;
}
