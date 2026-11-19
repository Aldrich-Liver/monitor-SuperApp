import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { fixAckText, fixerUnavailableText } from "../format.js";
import { threadContext } from "../reviewer/thread.js";
import { slackClient, triggerWebhook } from "../slack.js";
import { failureFromThread, fixInProgress, fixRequester, linkedFixPrs, threadTarget } from "./thread.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "45" },
    force: { type: "boolean", default: false },
    config: { type: "string", default: "config/apps.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const target = threadTarget(positionals.join(" "));
if (!target) fail("Uso: npm run fix:request -- <Ref. CR-… del hilo, enlace al hilo o ts> [--force] [--dry-run]");
const config = readJson(args.config);
const reader = slackClient();
if (!reader) fail("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL para leer el hilo de la falla.");
const poster = slackClient({ token: process.env.SLACK_ANALYST_BOT_TOKEN || process.env.SLACK_BOT_TOKEN });

let threadTs = target.ts;
if (target.ref) {
  const oldest = (Date.now() - Number(args.days) * 24 * 3600 * 1000) / 1000;
  threadTs = (await reader.findRefs([target.ref], oldest)).get(target.ref);
  if (!threadTs) fail(`No encontré en el canal el mensaje con Ref. ${target.ref} de los últimos ${args.days} días.`);
}
const messages = await reader.replies(threadTs).catch((err) => fail(`No se pudo leer el hilo ${threadTs}: ${err.message}`));
// A ts of a reply points into the thread; the bug is the thread's parent.
const parentTs = messages[0]?.thread_ts ?? messages[0]?.ts ?? threadTs;
const thread = parentTs === threadTs ? messages : await reader.replies(parentTs);

const say = async (text) => {
  if (args["dry-run"]) return console.log(`--- respuesta en hilo ---\n${text}\n`);
  await poster.post(text, parentTs).catch((err) => console.error(`No se pudo responder en el hilo: ${err.message}`));
};

const failure = failureFromThread(thread, config);
if (!failure) fail("Ese hilo no es el de una falla del monitor de Crashlytics.");
if (!failure.sourceRepo) {
  await say(`:information_source: No tengo el código de ${failure.app}: el Corrector solo trabaja en las apps con repo en el environment.`);
  fail(`${failure.app} no tiene sourceRepo en ${args.config}.`);
}
const linked = linkedFixPrs(thread, failure.sourceRepo);
if (linked.length && !args.force) {
  fail(`La falla ya tiene PR en su hilo (${linked.map((p) => p.url).join(", ")}). Usa --force para pedir otra corrección.`);
}
if (fixInProgress(thread) && !args.force) fail("El Corrector ya está trabajando en esta falla; responde en el hilo cuando termine.");

const requester = fixRequester(thread);
const payload = {
  source: "crash-fix-request",
  channel: reader.channel,
  thread_ts: parentTs,
  permalink: args["dry-run"] ? null : await reader.permalink(parentTs).catch(() => null),
  requested_by: requester,
  failure,
  thread: threadContext(thread),
};

await say(fixAckText({ requester, failure }));
if (args["dry-run"]) {
  console.log(`--- payload para el Corrector ---\n${JSON.stringify(payload, null, 2)}`);
  process.exit(0);
}
try {
  await triggerWebhook(payload, {
    url: process.env.FIXER_WEBHOOK_URL,
    key: process.env.FIXER_WEBHOOK_KEY,
    names: "FIXER_WEBHOOK_URL o FIXER_WEBHOOK_KEY",
  });
} catch (err) {
  await say(fixerUnavailableText(err.message));
  fail(`No se pudo activar al Corrector: ${err.message}`);
}
console.log(`Corrector activado para ${failure.app} ${failure.version ?? ""} (${failure.ref ?? parentTs}); responderá en el hilo.`);
