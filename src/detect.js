const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_REPEAT_MS = 2 * 60 * 60 * 1000;

export function emptyState() {
  return { v: 1, apps: {}, lastError: null };
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1 || typeof raw.apps !== "object") return emptyState();
  return { v: 1, apps: raw.apps ?? {}, lastError: raw.lastError ?? null };
}

/**
 * Compares what Crashlytics reports now against what was already reported.
 * An app with no prior state is baselined: its current issues are recorded without alerting,
 * so turning the monitor on does not flood the inbox with old issues.
 */
export function detectApp({ app, prevAppState, versions, issuesByVersion, now, forgetAfterDays }) {
  const today = now.toISOString().slice(0, 10);
  const findings = [];
  const baseline = !prevAppState;
  const issues = { ...(prevAppState?.issues ?? {}) };
  const regressed = new Set(prevAppState?.regressed ?? []);
  const latest = versions[0]?.displayName ?? null;

  if (baseline) {
    findings.push({
      type: "baseline",
      app: app.name,
      appId: app.appId,
      version: latest,
      issueCount: Object.values(issuesByVersion).reduce((n, list) => n + list.length, 0),
    });
  } else if (latest && prevAppState.latestVersion && latest !== prevAppState.latestVersion) {
    findings.push({
      type: "new_version",
      app: app.name,
      appId: app.appId,
      version: latest,
      previousVersion: prevAppState.latestVersion,
      metrics: versions[0].metrics,
    });
  }

  for (const [version, list] of Object.entries(issuesByVersion)) {
    for (const issue of list) {
      const known = issue.id in issues;
      const isRegressed = (issue.signals ?? []).includes("SIGNAL_REGRESSED");
      if (!baseline && !known) {
        findings.push(issueFinding("new_issue", app, version, issue));
      } else if (!baseline && known && isRegressed && !regressed.has(issue.id)) {
        findings.push(issueFinding("regressed", app, version, issue));
      }
      if (isRegressed) regressed.add(issue.id);
      issues[issue.id] = today;
    }
  }

  const cutoff = new Date(now.getTime() - forgetAfterDays * DAY_MS).toISOString().slice(0, 10);
  for (const [id, lastSeen] of Object.entries(issues)) {
    if (lastSeen < cutoff) delete issues[id];
  }
  const currentlyRegressed = new Set(
    Object.values(issuesByVersion)
      .flat()
      .filter((i) => (i.signals ?? []).includes("SIGNAL_REGRESSED"))
      .map((i) => i.id)
  );

  return {
    findings,
    appState: {
      latestVersion: latest ?? prevAppState?.latestVersion ?? null,
      issues,
      regressed: [...regressed].filter((id) => currentlyRegressed.has(id)),
    },
  };
}

function issueFinding(type, app, version, issue) {
  return {
    type,
    key: `${type}:${app.appId}:${issue.id}`,
    app: app.name,
    appId: app.appId,
    sourceRepo: app.sourceRepo ?? null,
    version,
    issue: {
      id: issue.id,
      title: issue.title,
      subtitle: issue.subtitle,
      errorType: issue.errorType,
      firstSeenVersion: issue.firstSeenVersion,
      lastSeenVersion: issue.lastSeenVersion,
      signals: issue.signals ?? [],
      state: issue.state,
      uri: issue.uri,
      eventsCount: Number(issue.metrics?.eventsCount ?? 0),
      impactedUsersCount: Number(issue.metrics?.impactedUsersCount ?? 0),
    },
  };
}

export function errorFinding(message, prevError, now) {
  const repeat =
    prevError && prevError.message === message && now.getTime() - Date.parse(prevError.at) < ERROR_REPEAT_MS;
  const lastError = repeat ? prevError : { message, at: now.toISOString() };
  return { finding: repeat ? null : { type: "error", message }, lastError };
}
