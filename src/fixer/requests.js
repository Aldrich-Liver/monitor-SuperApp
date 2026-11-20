import { fixAckText, fixerUnavailableText, prFixAckText } from "../format.js";
import { appForRepo } from "../reviewer/pr.js";
import { requestedPrs, reviewVerdict, threadContext } from "../reviewer/thread.js";
import { slackClient, triggerWebhook } from "../slack.js";
import { failureFromThread, fixInProgress, fixRequester, linkedFixPrs, prFixInProgress } from "./thread.js";

const REQUEST_CHARS = 1200;
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

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
      notice: `:information_source: El Corrector no tiene el código de ${failure.app}.`,
    });
  }
  const linked = linkedFixPrs(thread, failure.sourceRepo);
  if (linked.length && !force) {
    throw new FixRefused(`La falla ya tiene PR en su hilo (${linked.map((p) => p.url).join(", ")}). Usa --force para pedir otra corrección.`, {
      notice: ":information_source: Ya tiene PR en este hilo. Para otra corrección: `@Corrector de fallas corrige esta falla, es una corrección nueva`.",
    });
  }
  if (fixInProgress(thread) && !force) throw new FixRefused("El Corrector ya está trabajando en esta falla; responde en el hilo cuando termine.", {
      notice: ":information_source: El Corrector ya está en esta falla.",
    });

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

  await say(fixAckText());
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

/**
 * Acknowledges in the PR's thread and starts the Corrector on the Revisor's notes. It commits on the
 * PR's own branch, whoever asks. `request` is the message that asked; `review` is the Revisor's latest
 * answer to each PR in the thread, so the agent knows which notes are still open.
 */
export async function requestPrFix({ config, reader, poster, thread, prs, request, failure = null, via, dryRun = false }) {
  const parentTs = thread[0]?.ts;
  const say = async (text) => {
    if (dryRun) return console.log(`--- respuesta en hilo ---\n${text}\n`);
    await poster.post(text, parentTs).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
  };
  if (prFixInProgress(thread, prs)) {
    throw new FixRefused("El Corrector ya está atendiendo las notas de ese PR; responde en el hilo cuando termine.", {
      notice: ":information_source: El Corrector ya está atendiendo las notas de este PR.",
    });
  }
  const requester = request?.user && !request.bot_id ? request.user : null;
  const payload = {
    source: "pr-fix-request",
    via,
    channel: reader.channel,
    thread_ts: parentTs,
    permalink: dryRun ? null : await reader.permalink(parentTs).catch(() => null),
    requested_by: requester,
    request: request?.text ? truncate(request.text, REQUEST_CHARS) : null,
    prs: prs.map((pr) => ({
      url: pr.url,
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      app: appForRepo(config, pr.repo)?.name ?? null,
      review: reviewVerdict(thread, pr),
    })),
    failure,
    thread: threadContext(thread),
  };

  await say(prFixAckText({ prs }));
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

/** "corrige las notas del revisor": in a failure's thread, the PRs' notes instead of a new fix. */
export const PR_NOTES = /\bnotas?\b|comentarios?|observaci[oó]n|observaciones|revisi[oó]n|revisor|cambios necesarios|\bpuntos?\b/i;

/**
 * What a request to the Corrector in `thread` is about: the notes of the thread's PRs when the thread is
 * a PR's, or when it is a failure's and the request asks for the notes; otherwise, fixing the failure.
 */
export async function requestFixFromThread({ config, reader, poster, thread, request, force = false, via, dryRun = false }) {
  const failure = failureFromThread(thread, config);
  const prs = requestedPrs(request ?? {}, thread).filter((pr) => appForRepo(config, pr.repo));
  if (prs.length && (!failure || PR_NOTES.test(request?.text ?? ""))) {
    return requestPrFix({ config, reader, poster, thread, prs, request, failure, via, dryRun });
  }
  return requestFix({ config, reader, poster, thread, requester: request?.user ?? null, force, via, dryRun });
}
