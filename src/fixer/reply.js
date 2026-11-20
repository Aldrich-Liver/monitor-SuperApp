import { parseArgs } from "node:util";
import { readJson } from "../files.js";
import { fixResultText } from "../format.js";
import { parsePr } from "../reviewer/pr.js";
import { fixerPoster } from "./requests.js";

const { values: args } = parseArgs({
  options: {
    context: { type: "string", default: ".fixer/context.json" },
    payload: { type: "string", default: ".fixer/payload.json" },
    result: { type: "string", default: ".fixer/result.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
if (!["in-review", "fixed", "no-change", "error"].includes(result?.status)) {
  console.error(`${args.result} debe tener "status": "in-review", "fixed", "no-change" o "error".`);
  process.exit(1);
}
const prs = (result.prs ?? []).map((url) => parsePr(url)).filter(Boolean);
if (["in-review", "fixed"].includes(result.status) && !prs.length) {
  console.error(`Con "status": "${result.status}", ${args.result} debe traer en "prs" los enlaces a los PR.`);
  process.exit(1);
}
// When fix:context failed there is no context yet; the request itself has the thread.
const context = readJson(args.context) ?? readJson(args.payload);
if (!context?.thread_ts || !context.channel) {
  console.error(`Faltan ${args.context} y ${args.payload}, o no traen el hilo de la falla.`);
  process.exit(1);
}

const text = fixResultText(result, prs, { requester: context.requested_by });
if (args["dry-run"]) {
  console.log(`--- respuesta en hilo ---\n${text}`);
  process.exit(0);
}
const slack = fixerPoster(context.channel);
if (!slack) {
  console.error("Falta SLACK_FIXER_BOT_TOKEN (o SLACK_ANALYST_BOT_TOKEN / SLACK_BOT_TOKEN).");
  process.exit(1);
}
await slack.post(text, context.thread_ts);
console.log(`Respuesta publicada en el hilo (${result.status}, ${prs.length} PR).`);
