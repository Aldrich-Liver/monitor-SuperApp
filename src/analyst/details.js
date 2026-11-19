import { parseArgs } from "node:util";
import { sampleEvent } from "../crashlytics.js";
import { summarizeEvent } from "../event.js";
import { readJson, writeJson } from "../files.js";
import { cacheKey } from "./cache.js";

const { values: args } = parseArgs({
  options: {
    payload: { type: "string", default: ".analyst/payload.json" },
    cache: { type: "string", default: ".analyst/cache.json" },
    out: { type: "string", default: ".analyst/details.json" },
  },
});

const payload = readJson(args.payload);
// Each failure carries the thread of its bug; `payload.thread_ts` is the shared thread of older payloads.
const threadOf = (f) => f.thread_ts ?? payload.thread_ts;
if (payload?.source !== "crashlytics-monitor" || !Array.isArray(payload.failures) || !payload.failures.every(threadOf)) {
  console.error(`${args.payload} no es un payload válido del monitor.`);
  process.exit(1);
}
const cache = readJson(args.cache, {});

const failures = [];
for (const f of payload.failures) {
  const event = await sampleEvent(f.appId, f.issue.id, f.version).catch((err) => {
    console.warn(`Sin evento de muestra para ${f.key}: ${err.message}`);
    return null;
  });
  const cached = cache[cacheKey(f)] ?? null;
  failures.push({ ...f, thread_ts: threadOf(f), sampleEvent: event ? summarizeEvent(event) : null, analysis: cached, needsAnalysis: !cached });
}

writeJson(args.out, { channel: payload.channel, failures });
console.log(`${failures.length} falla(s); requieren análisis: ${failures.filter((f) => f.needsAnalysis).length}.`);
for (const f of failures.filter((x) => x.needsAnalysis)) {
  console.log(`- ${f.key} · ${f.app} ${f.version} · ${f.sourceRepo ?? "sin repo"} · commit ${f.sampleEvent?.buildRevision ?? "?"}`);
}
console.log(`Detalle: ${args.out}`);
