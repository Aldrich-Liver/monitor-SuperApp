import { parseArgs } from "node:util";
import { readJson } from "./files.js";
import { analystUnavailableText, errorText, handoffText, summaryText } from "./format.js";
import { slackClient, triggerWebhook } from "./slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    config: { type: "string", default: "config/apps.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
const config = readJson(args.config);
const failures = result.findings.filter((f) => f.type === "failure");
const errors = result.findings.filter((f) => f.type === "error");

if (!failures.length && !errors.length) {
  console.log("Sin fallas: no se publica nada.");
  process.exit(0);
}

const dryRun = args["dry-run"];
const slack = dryRun ? null : slackClient();
if (!slack && !dryRun) {
  console.error("Faltan SLACK_BOT_TOKEN o SLACK_CHANNEL. Usa --dry-run para ver los mensajes sin enviarlos.");
  process.exit(1);
}

async function post(text, threadTs) {
  if (dryRun) {
    console.log(`--- ${threadTs ? "respuesta en hilo" : "mensaje"} ---\n${text}\n`);
    return { ts: "DRY_RUN_TS", channel: "DRY_RUN_CHANNEL" };
  }
  return slack.post(text, threadTs);
}

for (const e of errors) await post(errorText(e.message));

if (failures.length) {
  const analyzed = failures.slice(0, config.maxAnalyzedFailures);
  const parent = await post(summaryText(result, failures));
  const mention = process.env.SLACK_ANALYST_MENTION?.trim() || null;
  // From here on the summary is already in the channel: failing would make the next run repeat it.
  await post(handoffText({ count: failures.length, analyzed: analyzed.length, mention }), parent.ts).catch((err) =>
    console.error(`No se pudo publicar la mención en el hilo: ${err.message}`)
  );

  const payload = {
    source: "crashlytics-monitor",
    channel: parent.channel,
    thread_ts: parent.ts,
    checkedAt: result.checkedAt,
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
}

console.log(`Publicado: ${failures.length} falla(s), ${errors.length} error(es) del monitor.`);
