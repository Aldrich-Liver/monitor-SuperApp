import { getAccessToken } from "./auth.js";

const ORIGIN = process.env.FIREBASE_CRASHLYTICS_URL ?? "https://firebasecrashlytics.googleapis.com";
const MAX_PAGES = 5;

function projectNumberOf(appId) {
  return appId.split(":")[1];
}

function appPath(appId) {
  return `${ORIGIN}/v1alpha/projects/${projectNumberOf(appId)}/apps/${appId}`;
}

function intervalParams(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { "filter.interval.start_time": start.toISOString(), "filter.interval.end_time": end.toISOString() };
}

async function get(url, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const item of [].concat(v)) qs.append(k, item);
  }
  const res = await fetch(`${url}?${qs}`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText;
    throw new Error(`Crashlytics ${res.status}: ${msg}`);
  }
  return body;
}

export async function releaseVersions(appId, days) {
  const body = await get(`${appPath(appId)}/reports/releaseVersions`, { page_size: 5, ...intervalParams(days) });
  return (body.groups ?? []).map((g) => ({ displayName: g.version.displayName, metrics: g.metrics?.[0] ?? {} }));
}

export async function topIssues(appId, versionDisplayName, days) {
  const groups = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await get(`${appPath(appId)}/reports/topIssues`, {
      page_size: 100,
      "filter.version.display_names": versionDisplayName,
      ...intervalParams(days),
      ...(pageToken ? { page_token: pageToken } : {}),
    });
    groups.push(...(body.groups ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return groups.map((g) => ({ ...g.issue, metrics: g.metrics?.[0] ?? {} }));
}

export async function sampleEvent(appId, issueId, versionDisplayName) {
  const body = await get(`${appPath(appId)}/events`, {
    page_size: 1,
    "filter.issue.id": issueId,
    "filter.version.display_names": versionDisplayName,
  });
  return body.events?.[0] ?? null;
}
