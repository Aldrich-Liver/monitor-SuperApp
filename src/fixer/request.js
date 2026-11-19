import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { slackClient } from "../slack.js";
import { FixRefused, fixerPoster, requestFix } from "./requests.js";
import { threadTarget } from "./thread.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "45" },
    force: { type: "boolean", default: false },
    via: { type: "string", default: "slack-cursor" },
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

let threadTs = target.ts;
if (target.ref) {
  const oldest = (Date.now() - Number(args.days) * 24 * 3600 * 1000) / 1000;
  threadTs = (await reader.findRefs([target.ref], oldest)).get(target.ref);
  if (!threadTs) fail(`No encontré en el canal el mensaje con Ref. ${target.ref} de los últimos ${args.days} días.`);
}
const messages = await reader.replies(threadTs).catch((err) => fail(`No se pudo leer el hilo ${threadTs}: ${err.message}`));
// A ts of a reply points into the thread; the bug is the thread's parent.
const parentTs = messages[0]?.thread_ts ?? messages[0]?.ts ?? threadTs;
const thread = parentTs === messages[0]?.ts ? messages : await reader.replies(parentTs);

const poster = fixerPoster();
try {
  const payload = await requestFix({ config, reader, poster, thread, force: args.force, via: args.via, dryRun: args["dry-run"] });
  const f = payload.failure;
  console.log(`${args["dry-run"] ? "(dry-run) " : ""}Corrector activado para ${f.app} ${f.version ?? ""} (${f.ref ?? parentTs}); responderá en el hilo.`);
} catch (err) {
  fail(err instanceof FixRefused ? err.message : `No se pudo activar al Corrector: ${err.message}`);
}
