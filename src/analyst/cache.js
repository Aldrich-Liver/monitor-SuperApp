import { normalizeAnalysis } from "../detect.js";

const MAX_ENTRIES = 40;

/** Analyses are reused per issue and version: a new release may change the code involved. */
export function cacheKey(failure) {
  return `${failure.key}@${failure.version}`;
}

export function mergeCache(cache, failures, written, now = new Date()) {
  const next = { ...cache };
  const resolved = new Map();
  for (const f of failures) {
    const fresh = normalizeAnalysis(written[f.key]);
    const analysis = fresh ?? normalizeAnalysis(f.analysis);
    resolved.set(f.key, analysis);
    if (fresh) next[cacheKey(f)] = { ...fresh, at: now.toISOString().slice(0, 10) };
  }
  const entries = Object.entries(next).sort(([, a], [, b]) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return { cache: Object.fromEntries(entries.slice(0, MAX_ENTRIES)), resolved };
}
