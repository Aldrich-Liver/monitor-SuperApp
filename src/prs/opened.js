import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { readJson, writeJson } from "../files.js";
import { prOpenedText, twinMissingText, twinOpenedText } from "../format.js";
import { fetchPr, prForBranch } from "../reviewer/github.js";
import { appForRepo, parsePr, prUrls, twinRepo } from "../reviewer/pr.js";
import { findPrThread } from "../reviewer/thread.js";
import { slackClient } from "../slack.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: ".prs/opened.json" },
    messages: { type: "string", default: ".prs/messages.json" },
    wait: { type: "string", default: "120" },
    hours: { type: "string", default: String(24 * 14) },
    config: { type: "string", default: "config/apps.json" },
    "dry-run": { type: "boolean", default: false },
  },
});

const config = readJson(args.config);
const pr = parsePr(positionals.join(" "));
if (!pr) {
  console.error("Uso: npm run pr:opened -- <URL del PR en GitHub>");
  process.exit(1);
}
const app = appForRepo(config, pr.repo);
const done = (data) => {
  writeJson(args.out, data);
  writeJson(args.messages, data.announce ? [data.announce] : []);
};
if (!app) {
  console.log(`${pr.repo} no es un repo de las apps: no se anuncia.`);
  done({ pr, skipped: "repo" });
  process.exit(0);
}

const github = await fetchPr(pr);
if (!github) console.warn("Sin acceso a la API de GitHub: el aviso no tendrá título, rama ni gemelo.");
if (github?.state === "closed" || github?.state === "merged") {
  console.log(`El PR #${pr.number} ya está ${github.state === "merged" ? "fusionado" : "cerrado"}: no se anuncia.`);
  done({ pr, skipped: "closed" });
  process.exit(0);
}
const info = { ...pr, title: github?.title ?? null, headBranch: github?.headBranch ?? null, author: github?.author ?? null };

let twin = null;
const twinName = twinRepo(config, pr.repo);
if (twinName) {
  const linked = prUrls(github?.body).find((p) => p.repo.toLowerCase() === twinName.toLowerCase());
  const byBranch = info.headBranch ? await prForBranch({ owner: pr.owner, repo: twinName, branch: info.headBranch }) : undefined;
  // `pr`: the twin PR; null when there is none; undefined when it can't be told or doesn't apply.
  let twinPr = linked ?? null;
  if (!twinPr) {
    if (byBranch === undefined) twinPr = undefined;
    else if (byBranch && byBranch.state !== "closed") twinPr = { ...pr, repo: twinName, number: byBranch.number, url: byBranch.url };
  }
  // A description that names the other repo explains why there is no twin.
  if (twinPr === null && (github?.body ?? "").toLowerCase().includes(twinName.toLowerCase())) twinPr = undefined;
  twin = { repo: twinName, branch: info.headBranch, pr: twinPr };
}

/**
 * The thread where this PR, or its twin, is already being discussed: a bug thread where the
 * Corrector posted it, a request for review, or the announcement of the twin PR.
 */
async function existingThread(slack) {
  const targets = [pr, ...(twin?.pr ? [twin.pr] : [])];
  let best = null;
  for (const target of targets) {
    const found = await findPrThread(slack, target, { hours: Number(args.hours) });
    if (found && (!best || Number(found.request.ts) > Number(best.request.ts))) best = { ...found, viaTwin: target !== pr };
  }
  return best;
}

const slack = args["dry-run"] ? null : slackClient();
let thread = null;
if (slack) {
  const deadline = Date.now() + Number(args.wait) * 1000;
  for (;;) {
    thread = await existingThread(slack).catch((err) => {
      console.error(`No se pudo buscar en el canal: ${err.message}`);
      return null;
    });
    if (thread || Date.now() >= deadline) break;
    await sleep(15000);
  }
} else if (!args["dry-run"]) console.error("Sin SLACK_BOT_TOKEN o SLACK_CHANNEL: no se busca un hilo existente.");

const data = { pr: info, app: app.name, twin, thread_ts: thread?.thread_ts ?? null, announce: null };
if (thread) {
  console.log(`Ya hay un hilo con este PR o su gemelo (${thread.thread_ts}): no hace falta un mensaje nuevo.`);
  // Leaves this PR's link in the twin's thread, so the review and the tests find it there too.
  const notice = thread.viaTwin ? twinOpenedText({ pr: info, app: app.name }) : twin?.pr === null ? twinMissingText(twin) : null;
  if (notice && slack) await slack.post(notice, thread.thread_ts).catch((err) => console.error(`No se pudo publicar en el hilo: ${err.message}`));
} else {
  data.announce = prOpenedText({ pr: info, app: app.name, twin });
  console.log(`Mensaje para el canal en ${args.messages}.`);
  if (args["dry-run"]) console.log(`--- mensaje en el canal ---\n${data.announce}`);
}
const twinSummary = !twin ? "sin gemelo" : twin.pr ? `gemelo ${twin.pr.url}` : twin.pr === null ? "gemelo pendiente" : "gemelo no aplica o no se pudo comprobar";
console.log(`PR #${pr.number} de ${pr.repo} · ${twinSummary}.`);
done(data);
