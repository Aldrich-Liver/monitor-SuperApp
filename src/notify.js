import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { readJson } from "./files.js";
import { analystUnavailableText, handoffText, summaryText, threadHeaderText } from "./format.js";
import { botMention, slackClient, triggerWebhook } from "./slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    thread: { type: "string", default: ".monitor/thread.json" },
    config: { type: "string", default: "config/apps.json" },
    wait: { type: "string", default: "90" },
    "post-parent": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
const config = readJson(args.config);
const failures = result.findings.filter((f) => f.type === "failure");
if (!failures.length) {
  console.log("Sin fallas: no hay hilo que abrir.");
  process.exit(0);
}

const dryRun = args["dry-run"];
const thread = readJson(args.thread, null);
const ref = thread?.ref ?? null;
const slack = dryRun ? null : slackClient();
if (!slack && !dryRun) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL. Usa --dry-run para ver los mensajes sin enviarlos.");
  process.exit(1);
}
if (result.test && !dryRun && !(process.env.ANALYST_WEBHOOK_URL?.trim() && process.env.ANALYST_WEBHOOK_KEY?.trim())) {
  console.error("Prueba cancelada antes de publicar: faltan ANALYST_WEBHOOK_URL o ANALYST_WEBHOOK_KEY.");
  process.exit(1);
}

async function post(text, threadTs) {
  if (dryRun) {
    console.log(`--- ${threadTs ? "respuesta en hilo" : "mensaje del bot"} ---\n${text}\n`);
    return { ts: "DRY_RUN_TS", channel: "DRY_RUN_CHANNEL" };
  }
  return slack.post(text, threadTs);
}

/** The summary Cursor posted, found by its Ref.; Slack may take a few seconds to list it. */
async function findSummary() {
  if (!ref) return null;
  const oldest = new Date(new Date(thread.renderedAt).getTime() - 5 * 60 * 1000).toISOString();
  const deadline = Date.now() + Number(args.wait) * 1000;
  for (;;) {
    const found = await slack.findMessage(`Ref. ${ref}`, oldest);
    if (found || Date.now() >= deadline) return found;
    await sleep(5000);
  }
}

async function parentMessage() {
  if (args["post-parent"]) return post(summaryText(result, failures, { ref: ref ?? undefined }));
  if (dryRun) return post(threadHeaderText(ref ?? "CR-DRYRUN"));
  try {
    const found = await findSummary();
    if (found) {
      console.log(`Reporte de Cursor encontrado (Ref. ${ref}).`);
      return found;
    }
    console.error(`No se encontró el reporte de Cursor${ref ? ` con Ref. ${ref}` : ""}.`);
  } catch (err) {
    console.error(`No se pudo buscar el reporte de Cursor: ${err.message}`);
  }
  return post(threadHeaderText(ref ?? "sin referencia"));
}

async function analystMention() {
  const explicit = process.env.SLACK_ANALYST_MENTION?.trim();
  if (explicit) return explicit;
  if (dryRun) return null;
  return botMention(process.env.SLACK_ANALYST_BOT_TOKEN).catch((err) => {
    console.error(`No se pudo obtener la mención del Analista: ${err.message}`);
    return null;
  });
}

const analyzed = failures.slice(0, config.maxAnalyzedFailures);
const parent = await parentMessage();
const mention = await analystMention();
await post(handoffText({ count: failures.length, analyzed: analyzed.length, mention }), parent.ts).catch((err) =>
  console.error(`No se pudo publicar la mención en el hilo: ${err.message}`)
);

const payload = {
  source: "crashlytics-monitor",
  channel: parent.channel,
  thread_ts: parent.ts,
  checkedAt: result.checkedAt,
  ...(result.test ? { test: true } : {}),
  failures: analyzed.map(({ type, ...f }) => f),
};
if (dryRun) {
  console.log(`--- payload para el Analista ---\n${JSON.stringify(payload, null, 2)}`);
} else {
  try {
    await triggerWebhook(payload);
    console.log("Analista activado.");
  } catch (err) {
    console.error(`No se pudo activar al Analista: ${err.message}`);
    await post(analystUnavailableText(err.message), parent.ts).catch(() => {});
  }
}
console.log(`Hilo listo: ${failures.length} falla(s).`);
