const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_REPEAT_MS = 6 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 85;

export function emptyState() {
  return { v: 2, apps: {}, lastError: null, lastCheckedAt: null, bugs: {}, outbox: [], digestOn: null };
}

/** `bugs`, `outbox` and `digestOn` came after v2 started; a v2 state without them is still valid. */
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 2 || typeof raw.apps !== "object") return emptyState();
  return {
    v: 2,
    apps: raw.apps ?? {},
    lastError: raw.lastError ?? null,
    lastCheckedAt: raw.lastCheckedAt ?? null,
    bugs: raw.bugs && typeof raw.bugs === "object" ? raw.bugs : {},
    outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
    digestOn: raw.digestOn ?? null,
  };
}

/**
 * Where the cumulative event counts for a version start. Counting from a fixed instant keeps the
 * counts monotonic, so events that Crashlytics ingests late still show up as an increase.
 */
export function countingSince(prevAppState, latestVersion, now, initialLookbackDays) {
  const sameVersion = prevAppState?.version === latestVersion;
  const since = sameVersion ? prevAppState.since : null;
  if (since && now.getTime() - Date.parse(since) < MAX_WINDOW_DAYS * DAY_MS) return { since, reset: false };
  return {
    since: new Date(now.getTime() - initialLookbackDays * DAY_MS).toISOString(),
    reset: sameVersion,
  };
}

/**
 * Reports every issue of the latest version whose event count grew since the previous check,
 * known or not. The first check of an app only records counts, so enabling the monitor does not
 * report the whole history as if it had just happened.
 */
export function detectApp({ app, prevAppState, version, since, reset, issues, now = new Date() }) {
  const firstCheck = !prevAppState;
  const sameVersion = prevAppState?.version === version;
  const prevCounts = sameVersion ? prevAppState.counts ?? {} : {};
  const counts = {};
  const findings = [];

  for (const issue of issues) {
    const total = Number(issue.metrics?.eventsCount ?? 0);
    counts[issue.id] = total;
    const newEvents = total - (prevCounts[issue.id] ?? 0);
    if (firstCheck || reset || newEvents <= 0) continue;
    findings.push({
      type: "failure",
      key: `${app.appId}:${issue.id}`,
      app: app.name,
      appId: app.appId,
      sourceRepo: app.sourceRepo ?? null,
      version,
      newEvents,
      totalEvents: total,
      impactedUsers: Number(issue.metrics?.impactedUsersCount ?? 0),
      issue: {
        id: issue.id,
        title: issue.title,
        subtitle: issue.subtitle,
        errorType: issue.errorType,
        firstSeenVersion: issue.firstSeenVersion,
        uri: issue.uri,
      },
    });
  }

  findings.sort((a, b) => b.newEvents - a.newEvents);
  // When the monitor first saw this version; null for versions it found already out when it started.
  const seenAt = sameVersion ? prevAppState.seenAt ?? null : firstCheck ? null : now.toISOString();
  const build = sameVersion ? prevAppState.build ?? null : null;
  return { findings, appState: { version, since, counts, seenAt, ...(build ? { build } : {}) } };
}

/** How an app's latest version moved since the previous check: "first" (no previous data), "new" or null. */
export function versionChange(prevAppState, version) {
  if (!prevAppState) return "first";
  return prevAppState.version === version ? null : "new";
}

/** One "monitor active" message whenever any app shows a version it didn't have before. */
export function versionFinding(appStatus) {
  if (!appStatus.some((s) => s.change)) return null;
  return { type: "new_version", apps: appStatus };
}

export function errorFinding(message, prevError, now) {
  const repeat =
    prevError && prevError.message === message && now.getTime() - Date.parse(prevError.at) < ERROR_REPEAT_MS;
  const lastError = repeat ? prevError : { message, at: now.toISOString() };
  return { finding: repeat ? null : { type: "error", message }, lastError };
}

/** Normalizes what the analyst wrote for one failure into `{ cause, fix }`. */
export function normalizeAnalysis(value) {
  if (!value) return null;
  if (typeof value === "string") return { cause: value.trim(), fix: "" };
  const cause = String(value.cause ?? value.causa ?? "").trim();
  const fix = String(value.fix ?? value.solucion ?? value["solución"] ?? "").trim();
  return cause || fix ? { cause, fix } : null;
}
