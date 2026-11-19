import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { normalizeState } from "./detect.js";
import { readJson, writeJson } from "./files.js";
import { analystUnavailableText, digestLinksText, handoffText } from "./format.js";
import { botMention, slackClient, triggerWebhook } from "./slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    state: { type: "string", default: ".monitor/state.next.json" },
    config: { type: "string", default: "config/apps.json" },
    wait: { type: "string", default: "90" },
    "dry-run": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
const config = readJson(args.config);
const state = normalizeState(readJson(args.state, null));
const failures = new Map(result.findings.filter((f) => f.type === "failure").map((f) => [f.key, f]));
const now = new Date();

const dryRun = args["dry-run"];
const slack = dryRun ? null : slackClient();
if (!slack && !dryRun) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL. Usa --dry-run para ver los mensajes sin enviarlos.");
  process.exit(1);
}
const save = () => !dryRun && writeJson(args.state, state, false);

let dryTs = 0;
async function post(text, threadTs, { broadcast = false } = {}) {
  if (dryRun) {
    const where = threadTs ? `respuesta en el hilo ${threadTs}${broadcast ? " (también al canal)" : ""}` : "mensaje en el canal";
    console.log(`--- ${where} ---\n${text}\n`);
    return { ts: `DRY_RUN_${++dryTs}`, channel: "DRY_RUN_CHANNEL" };
  }
  return slack.post(text, threadTs, { broadcast });
}

/**
 * The messages Cursor posted, found by their Ref.; Slack may take a few seconds to list them. Bots
 * never post a message of their own in the channel: what isn't found is sent again by the next
 * check's render, with the same Ref.
 */
async function findPosted(items) {
  const found = new Map();
  if (!items.length) return found;
  if (dryRun) {
    for (const item of items) found.set(item.ref, `DRY_RUN_${++dryTs}`);
    return found;
  }
  const oldest = (Math.min(...items.map((i) => Date.parse(i.renderedAt ?? now))) - 5 * 60 * 1000) / 1000;
  const refs = items.map((i) => i.ref);
  const deadline = Date.now() + Number(args.wait) * 1000;
  for (;;) {
    try {
      for (const [ref, ts] of await slack.findRefs(refs.filter((r) => !found.has(r)), oldest)) found.set(ref, ts);
    } catch (err) {
      console.error(`No se pudo buscar los mensajes de Cursor: ${err.message}`);
      return found;
    }
    if (found.size === refs.length || Date.now() >= deadline) return found;
    await sleep(5000);
  }
}

// 1. Each new bug gets its thread on the report Cursor posted, and the morning summary its links.
const fresh = Object.values(state.bugs).filter((b) => b.status === "new" && b.ref);
const digest = state.digest && !state.digest.ts ? state.digest : null;
const posted = await findPosted([...fresh.filter((b) => !b.reportTs), ...(digest ? [digest] : [])]);
let opened = 0;
for (const bug of fresh) {
  const ts = bug.reportTs ?? posted.get(bug.ref);
  if (!ts) {
    console.error(`No se encontró el mensaje de Cursor con Ref. ${bug.ref}; la siguiente revisión lo vuelve a enviar.`);
    continue;
  }
  Object.assign(bug, { status: "open", thread_ts: ts, threadOpenedAt: now.toISOString() });
  delete bug.reportTs;
  opened++;
}
if (digest && posted.has(digest.ref)) digest.ts = posted.get(digest.ref);
save();

// 2. Lifecycle notices; one that fails stays in the outbox for the next check.
const pending = [];
let sent = 0;
for (const item of state.outbox) {
  const bug = state.bugs[item.key];
  if (!bug) continue;
  if (!bug.thread_ts) {
    pending.push(item);
    continue;
  }
  try {
    await post(item.text, bug.thread_ts, { broadcast: item.broadcast });
    sent++;
  } catch (err) {
    console.error(`No se pudo publicar un aviso en el hilo de ${item.key}: ${err.message}`);
    pending.push(item);
  }
}
state.outbox = pending;
save();

// 3. The Analista answers in the thread of each bug that is new or came back.
async function analystMention() {
  const explicit = process.env.SLACK_ANALYST_MENTION?.trim();
  if (explicit) return explicit;
  if (dryRun) return null;
  return botMention(process.env.SLACK_ANALYST_BOT_TOKEN).catch((err) => {
    console.error(`No se pudo obtener la mención del Analista: ${err.message}`);
    return null;
  });
}

// Bugs beyond the per-run limit keep their flag and go to the Analista on the next check.
const toAnalyze = Object.values(state.bugs)
  .filter((b) => b.needsAnalysis && b.thread_ts && failures.has(b.key))
  .sort((a, b) => failures.get(b.key).newEvents - failures.get(a.key).newEvents)
  .slice(0, config.maxAnalyzedFailures);
for (const bug of Object.values(state.bugs)) if (bug.needsAnalysis && bug.thread_ts && !failures.has(bug.key)) delete bug.needsAnalysis;

if (toAnalyze.length) {
  const mention = await analystMention();
  for (const bug of toAnalyze) {
    await post(handoffText({ mention, reopened: Boolean(bug.reopenedAt) }), bug.thread_ts).catch((err) =>
      console.error(`No se pudo publicar la mención en el hilo de ${bug.key}: ${err.message}`)
    );
  }
  const payload = {
    source: "crashlytics-monitor",
    channel: slack?.channel ?? "DRY_RUN_CHANNEL",
    checkedAt: result.checkedAt,
    ...(result.test ? { test: true } : {}),
    failures: toAnalyze.map((bug) => {
      const { type, ...f } = failures.get(bug.key);
      return { ...f, thread_ts: bug.thread_ts, ref: bug.ref };
    }),
  };
  if (dryRun) console.log(`--- payload para el Analista ---\n${JSON.stringify(payload, null, 2)}`);
  else {
    try {
      await triggerWebhook(payload);
      console.log(`Analista activado para ${toAnalyze.length} falla(s).`);
    } catch (err) {
      console.error(`No se pudo activar al Analista: ${err.message}`);
      for (const bug of toAnalyze) await post(analystUnavailableText(err.message), bug.thread_ts).catch(() => {});
    }
  }
  for (const bug of toAnalyze) delete bug.needsAnalysis;
  save();
}

// 4. Once Cursor posted the morning summary, the bot answers under it with the link to each thread.
let digestSent = false;
if (state.digest?.ts) {
  const listed = (state.digest.keys ?? []).map((key) => state.bugs[key]).filter((b) => b?.thread_ts);
  const permalinks = {};
  for (const bug of listed.slice(0, 15)) {
    permalinks[bug.key] = dryRun ? `https://slack.example/${bug.thread_ts}` : await slack.permalink(bug.thread_ts).catch(() => null);
  }
  const links = digestLinksText(listed, permalinks);
  if (links) {
    await post(links, state.digest.ts).catch((err) => console.error(`No se pudo responder con los enlaces del resumen: ${err.message}`));
  }
  state.digestOn = state.digest.day;
  state.digest = null;
  for (const bug of Object.values(state.bugs)) bug.sinceDigest = 0;
  digestSent = true;
  save();
}

console.log(
  `Hilos nuevos: ${opened}/${fresh.length} · al Analista: ${toAnalyze.length} · ` +
    `avisos: ${sent} enviados, ${pending.length} pendientes · resumen: ${digestSent ? "publicado por Cursor" : state.digest ? "no encontrado, se reenvía" : "no"}.`
);
