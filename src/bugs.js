import { bugFixingText, bugMergedText, bugPrClosedText, bugReleasedText, bugReopenedText, bugResolvedText } from "./format.js";

const HOUR_MS = 60 * 60 * 1000;
const PRUNE_DAYS = 30;
const TZ = "America/Mexico_City";

/**
 * One bug per Crashlytics issue, with its own Slack thread. Statuses:
 * - `new`: seen for the first time; its report still has to be posted.
 * - `open`: reported, nobody has linked a PR in its thread.
 * - `fixing`: a PR of the app's repo was linked in the thread.
 * - `resolved`: no events for `quietHours`; it reopens in the same thread if it comes back.
 */
export const ACTIVE = new Set(["open", "fixing"]);

export const prKey = (pr) => `${pr.repo}#${pr.number}`.toLowerCase();

function notice(bug, text, broadcast = false) {
  return { key: bug.key, text, broadcast };
}

function count(bug, f, now) {
  bug.events += f.newEvents;
  bug.sinceDigest += f.newEvents;
  bug.users = Math.max(bug.users ?? 0, f.impactedUsers ?? 0);
  bug.lastEventAt = now.toISOString();
  bug.lastVersion = f.version;
}

export function newBug(f, now) {
  return {
    key: f.key,
    appId: f.appId,
    app: f.app,
    sourceRepo: f.sourceRepo ?? null,
    issue: { ...f.issue },
    status: "new",
    ...(f.test ? { test: true } : {}),
    openedAt: now.toISOString(),
    openedVersion: f.version,
    lastVersion: f.version,
    lastEventAt: now.toISOString(),
    events: f.newEvents,
    sinceDigest: f.newEvents,
    users: f.impactedUsers ?? 0,
    ref: null,
    thread_ts: null,
    prs: [],
    ignoredPrs: [],
    fix: null,
    resolvedAt: null,
  };
}

/**
 * Applies the failures of this check: new issues become bugs to report, known ones only add up
 * their events, and a resolved bug, or one whose fix already shipped, reopens in its thread.
 */
export function trackFailures(bugs, failures, now) {
  const next = structuredClone(bugs);
  const outbox = [];
  const opened = [];
  const reopened = [];
  for (const f of failures) {
    const bug = next[f.key];
    if (!bug || !bug.thread_ts) {
      next[f.key] = newBug(f, now);
      opened.push(f.key);
      continue;
    }
    count(bug, f, now);
    if (bug.status === "resolved") {
      outbox.push(notice(bug, bugReopenedText(bug, f, { resolvedAt: bug.resolvedAt }), true));
      bug.ignoredPrs = [...new Set([...bug.ignoredPrs, ...bug.prs.map(prKey)])];
      Object.assign(bug, { status: "open", prs: [], fix: null, resolvedAt: null, sinceDigest: f.newEvents });
      reopened.push(f.key);
    } else if (bug.fix) {
      const pr = bug.prs.find((p) => p.number === bug.fix.pr) ?? null;
      outbox.push(notice(bug, bugReopenedText(bug, f, { pr, fixVersion: bug.fix.version, fixMethod: bug.fix.method }), true));
      bug.ignoredPrs = [...new Set([...bug.ignoredPrs, ...bug.prs.map(prKey)])];
      Object.assign(bug, { status: "open", prs: [], fix: null });
      reopened.push(f.key);
    }
  }
  return { bugs: next, outbox, opened, reopened };
}

/**
 * The PRs of the bug's app repo linked in its thread, with their GitHub state (`open`, `closed`,
 * `merged`, or null when unknown). A linked PR puts the bug in correction; if every one closes
 * without merging, it goes back to open.
 */
export function syncPrs(bug, prs, quietHours) {
  const out = [];
  const known = new Map(bug.prs.map((p) => [prKey(p), p]));
  bug.prs = prs
    .filter((p) => !bug.ignoredPrs.includes(prKey(p)))
    .map((p) => {
      const prev = known.get(prKey(p)) ?? {};
      return { ...prev, ...p, state: p.state ?? prev.state ?? null };
    });
  const active = bug.prs.filter((p) => p.state !== "closed");
  if (bug.status === "open" && active.length) {
    bug.status = "fixing";
    const pr = active.find((p) => p.state === "merged") ?? active[0];
    if (pr.state === "merged") pr.mergedNotified = true;
    out.push(notice(bug, bugFixingText(pr, quietHours)));
  } else if (bug.status === "fixing" && !active.length && bug.prs.length) {
    bug.status = "open";
    out.push(notice(bug, bugPrClosedText(bug.prs.at(-1))));
  }
  if (bug.status === "fixing") {
    for (const pr of active.filter((p) => p.state === "merged" && !p.mergedNotified)) {
      pr.mergedNotified = true;
      out.push(notice(bug, bugMergedText(pr)));
    }
  }
  return out;
}

/** The merged PR of a bug in correction, the one a release has to include. */
export function mergedPr(bug) {
  return bug.status === "fixing" && !bug.fix ? bug.prs.find((p) => p.state === "merged" && p.mergeCommit) ?? null : null;
}

/** `release` says whether the app's latest version includes the merged PR, and how that was decided. */
export function markReleased(bug, release, now, quietHours) {
  const pr = mergedPr(bug);
  if (!pr || !release?.included) return [];
  bug.fix = { version: release.version, since: now.toISOString(), pr: pr.number, method: release.method };
  const until = new Date(now.getTime() + quietHours * HOUR_MS);
  return [notice(bug, bugReleasedText(pr, release.version, until, release.method))];
}

/** After `quietHours` without events (counted from the fixed release when there is one), the bug is resolved. */
export function resolveQuiet(bug, now, quietHours) {
  if (!ACTIVE.has(bug.status) || !bug.thread_ts) return [];
  const since = Math.max(Date.parse(bug.lastEventAt), bug.fix ? Date.parse(bug.fix.since) : 0);
  if (now.getTime() - since < quietHours * HOUR_MS) return [];
  const pr = bug.fix ? bug.prs.find((p) => p.number === bug.fix.pr) : bug.prs.find((p) => p.state !== "closed");
  const version = bug.fix?.version ?? bug.lastVersion;
  Object.assign(bug, { status: "resolved", resolvedAt: now.toISOString(), resolvedVersion: version });
  return [notice(bug, bugResolvedText(bug, { pr, version, released: Boolean(bug.fix), quietHours }), true)];
}

export function pruneResolved(bugs, now) {
  const limit = now.getTime() - PRUNE_DAYS * 24 * HOUR_MS;
  return Object.fromEntries(Object.entries(bugs).filter(([, b]) => b.status !== "resolved" || Date.parse(b.resolvedAt) >= limit));
}

function localParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** The morning summary is due on the first check at or after `hour` (Mexico City) each day. */
export function digestDue(now, digestOn, hour) {
  const { day, hour: current } = localParts(now);
  return current >= hour && digestOn !== day ? day : null;
}

/** Open bugs for the morning summary: the ones nobody took first, then those in correction; most events first. */
export function digestBugs(bugs) {
  return Object.values(bugs)
    .filter((b) => ACTIVE.has(b.status) && b.thread_ts)
    .sort((a, b) => (a.status === b.status ? b.sinceDigest - a.sinceDigest || b.events - a.events : a.status === "open" ? -1 : 1));
}
