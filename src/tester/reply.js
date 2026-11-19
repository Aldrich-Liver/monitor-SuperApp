import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readJson, writeJson } from "../files.js";
import { testsComment, testsText } from "../format.js";
import { fetchPr } from "../reviewer/github.js";
import { findPrThread } from "../reviewer/thread.js";
import { slackClient } from "../slack.js";

const { values: args } = parseArgs({
  options: {
    result: { type: "string", default: ".tester/result.json" },
    comment: { type: "string", default: ".tester/comment.md" },
    hours: { type: "string", default: String(24 * 14) },
    "dry-run": { type: "boolean", default: false },
  },
});

const result = readJson(args.result);
if (!result?.pr?.url || !result.status) {
  console.error(`${args.result} no tiene un resultado de tests:run.`);
  process.exit(1);
}
if (result.status === "skipped") {
  console.log(`Sin pruebas que publicar: ${result.reason}.`);
  process.exit(0);
}

// A push while the tests ran starts another run; only the run of the PR's latest commit is published.
const current = await fetchPr(result.pr);
if (current?.headSha && result.pr.headSha && current.headSha !== result.pr.headSha) {
  writeJson(args.result, { ...result, outdated: true });
  console.log(`Corrida obsoleta: el PR ya va en ${current.headSha.slice(0, 7)}. No se publica; la corrida de ese commit lo hará.`);
  process.exit(0);
}

writeFileSync(args.comment, testsComment(result) + "\n");
console.log(`Comentario para el PR de GitHub: ${args.comment}`);

if (args["dry-run"]) {
  console.log(`--- respuesta en hilo ---\n${testsText(result)}`);
  process.exit(0);
}
const slack = slackClient();
if (!slack) {
  console.log("Sin SLACK_BOT_TOKEN o SLACK_CHANNEL: el resultado va solo al PR.");
  process.exit(0);
}
const poster = slackClient({ token: process.env.SLACK_TESTER_BOT_TOKEN || process.env.SLACK_BOT_TOKEN });
const thread = await findPrThread(slack, result.pr, { hours: Number(args.hours) }).catch((err) => {
  console.error(`No se pudo buscar el hilo del PR: ${err.message}`);
  return null;
});
if (!thread) {
  console.log(`No hay un hilo en el canal con ${result.pr.url}: el resultado va solo al PR.`);
  process.exit(0);
}
await poster.post(testsText(result), thread.thread_ts);
console.log(`Resultado publicado en el hilo ${thread.thread_ts} (${result.status}).`);
