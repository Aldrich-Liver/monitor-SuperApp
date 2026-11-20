import { mentionsPr, prUrls } from "../reviewer/pr.js";

const CRASHLYTICS_LINK = /https:\/\/console\.firebase\.google\.com\/[^\s|>]*?\/crashlytics\/app\/([\w:.-]+)\/issues\/([0-9a-f]+)[^\s|>]*/i;
const VERSION = String.raw`(\d[\w.-]* \(\d+\))`;
// Send to Slack may turn the report's bold into italics and its line breaks into spaces.
const REPORT = new RegExp(String.raw`Falla nueva en (.+?) ${VERSION}[*_][^\n]*?· \x60([^\x60]+)\x60`);
const DETAIL = new RegExp(String.raw`^\*(?:\d+\/\d+ · )?(.+?) ${VERSION}\* · `, "m");

function unescape(text = "") {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/‹/g, "<").replace(/›/g, ">");
}

const line = (text, label) => text.match(new RegExp(String.raw`^\*${label}:\* (.+)$`, "m"))?.[1]?.trim() ?? null;

/** `CR-4B7DFB`, a Slack thread link, or a message ts: where the request says the bug's thread is. */
export function threadTarget(input = "") {
  const ref = input.match(/\bCR-[0-9A-F]{6}\b/i)?.[0]?.toUpperCase();
  if (ref) return { ref };
  const param = input.match(/thread_ts=(\d{10}\.\d{6})/)?.[1];
  if (param) return { ts: param };
  const permalink = input.match(/\/archives\/[A-Z0-9]+\/p(\d{10})(\d{6})/);
  if (permalink) return { ts: `${permalink[1]}.${permalink[2]}` };
  const ts = input.match(/\b\d{10}\.\d{6}\b/)?.[0];
  return ts ? { ts } : null;
}

/** The Crashlytics issue a console link points to; the app goes as its Firebase app ID or as `android:<package>`. */
export function crashlyticsLink(text = "") {
  const m = text.match(CRASHLYTICS_LINK);
  return m ? { app: m[1], issueId: m[2], url: unescape(m[0]) } : null;
}

function appOfLink(config, link) {
  const [platform, bundle] = link.app.split(":");
  return config.apps.find((a) => a.appId === link.app || (a.bundle === bundle && a.appId.includes(`:${platform}:`))) ?? null;
}

/**
 * What the thread says about its bug: the report Cursor posted opens it, and the Analista's detail
 * (the latest one, after a reopening) brings the version, the cause, the fix and the Crashlytics link.
 * Null when the thread is not a bug's.
 */
export function failureFromThread(messages, config) {
  const [parent, ...replies] = messages;
  const report = unescape(parent?.text ?? "").match(REPORT);
  let app = report ? config.apps.find((a) => a.name === report[1]) ?? null : null;
  let version = report?.[2] ?? null;
  const title = report?.[3] ?? null;
  let link = null;
  let analysis = null;
  for (const m of replies) {
    const text = unescape(m.text ?? "");
    const detail = text.match(DETAIL);
    if (!detail) continue;
    version = detail[2];
    app = config.apps.find((a) => a.name === detail[1]) ?? app;
    link = crashlyticsLink(m.text) ?? link;
    const cause = line(text, "Qué está pasando");
    const fix = line(text, "Solución propuesta");
    analysis = cause || fix ? { cause, fix } : analysis;
  }
  if (link) app = appOfLink(config, link) ?? app;
  if (!app) return null;
  return {
    app: app.name,
    appId: app.appId,
    sourceRepo: app.sourceRepo ?? null,
    version,
    title,
    issueId: link?.issueId ?? null,
    crashlyticsUrl: link?.url ?? null,
    ref: unescape(parent.text ?? "").match(/Ref\. (CR-[0-9A-F]{6})/)?.[1] ?? null,
    analysis,
  };
}

/** PRs of the app's repo already linked in the thread: the bug is in correction. */
export function linkedFixPrs(messages, repo) {
  const seen = new Map();
  for (const m of messages) {
    for (const pr of prUrls(m.text ?? "")) if (pr.repo.toLowerCase() === repo.toLowerCase()) seen.set(pr.url, pr);
  }
  return [...seen.values()];
}

const FIX_ACK = /El \*Corrector\* toma esta falla/;
const FIX_DONE = /\*(Corrección propuesta|Sin cambios de código|No pude corregir esta falla)\*/;
const IN_PROGRESS_MS = 3 * 60 * 60 * 1000;

/** Whether the Corrector took the bug in the last three hours and hasn't given its final answer yet. */
export function fixInProgress(messages, now = Date.now()) {
  let since = null;
  for (const m of messages) {
    if (FIX_ACK.test(m.text ?? "")) since = Number(m.ts) * 1000;
    else if (FIX_DONE.test(m.text ?? "")) since = null;
  }
  return since !== null && now - since < IN_PROGRESS_MS;
}

const PR_FIX_ACK = /El \*Corrector\* atiende las notas/;
const PR_FIX_DONE = /\*(Notas atendidas|Sin cambios en el PR|No pude atender las notas)\*/;

/** Whether the Corrector took the notes of one of `prs` in the last three hours and hasn't given its final answer yet. */
export function prFixInProgress(messages, prs, now = Date.now()) {
  let since = null;
  for (const m of messages) {
    const text = m.text ?? "";
    if (PR_FIX_ACK.test(text) && prs.some((pr) => mentionsPr(text, pr))) since = Number(m.ts) * 1000;
    else if (PR_FIX_DONE.test(text) && !/en verificación/.test(text)) since = null;
  }
  return since !== null && now - since < IN_PROGRESS_MS;
}

/** Who asked: the latest person in the thread asking for a fix. */
export function fixRequester(messages) {
  return [...messages].reverse().find((m) => m.user && !m.bot_id && /corrig|arregl/i.test(m.text ?? ""))?.user ?? null;
}

const NO_CHANGE = /^:information_source: \*Sin cambios de código\*/;

/**
 * The Corrector's latest conclusion in the thread when it is that the bug needs no code change, as
 * `{ ts, at, summary }`; null when its latest result is a fix, an error, or there is none.
 */
export function noChangeVerdict(messages) {
  let found = null;
  for (const m of messages) {
    const text = m.text ?? "";
    if (!m.bot_id || !FIX_DONE.test(text)) continue;
    found = NO_CHANGE.test(text)
      ? { ts: m.ts, at: new Date(Number(m.ts) * 1000).toISOString(), summary: text.split("\n")[1] ?? "" }
      : null;
  }
  return found;
}
