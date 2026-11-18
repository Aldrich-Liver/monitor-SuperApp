import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildMessages, neutralize, toText } from "./format.js";
import { slackTransport } from "./slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".monitor/result.json" },
    analysis: { type: "string", default: ".monitor/analysis.json" },
    render: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const result = JSON.parse(readFileSync(args.result, "utf8"));
const analysis = existsSync(args.analysis) ? JSON.parse(readFileSync(args.analysis, "utf8")) : {};

if (args.render) {
  const texts = buildMessages(result, analysis, { esc: neutralize }).map(toText);
  writeFileSync(args.render, JSON.stringify(texts, null, 2) + "\n");
  console.log(`${texts.length} mensaje(s) escritos en ${args.render}.`);
  process.exit(0);
}

const messages = buildMessages(result, analysis);
if (!messages.length) {
  console.log("Nada que notificar.");
  process.exit(0);
}

const transport = args["dry-run"] ? null : slackTransport();
if (!transport) {
  if (!args["dry-run"]) {
    console.error(
      "Faltan credenciales de Slack: define SLACK_BOT_TOKEN y SLACK_TARGET, o SLACK_WEBHOOK_URL. " +
        "Usa --dry-run para ver los mensajes o --render <archivo> para generarlos como texto."
    );
    process.exit(1);
  }
  for (const m of messages) console.log(JSON.stringify(m, null, 2));
  console.log(`(dry-run) ${messages.length} mensaje(s) generados, no se envió nada.`);
  process.exit(0);
}

for (const [i, m] of messages.entries()) {
  await transport.send(m);
  console.log(`Enviado ${i + 1}/${messages.length}: ${m.text}`);
}
console.log(`Listo: ${messages.length} mensaje(s) enviados por ${transport.kind}.`);
