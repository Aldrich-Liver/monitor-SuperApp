const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;

/** Every GitHub PR linked in a text, once each, in order. Slack wraps links as `<url|label>`, which still matches. */
export function prUrls(text = "") {
  const seen = new Set();
  const found = [];
  for (const m of String(text).matchAll(PR_URL)) {
    const pr = { owner: m[1], repo: m[2], number: Number(m[3]) };
    const id = prId(pr);
    if (seen.has(id)) continue;
    seen.add(id);
    found.push({ ...pr, url: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}` });
  }
  return found;
}

export function parsePr(url) {
  return prUrls(url)[0] ?? null;
}

export function prId(pr) {
  return `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
}

export function mentionsPr(text, pr) {
  return prUrls(text).some((p) => prId(p) === prId(pr));
}

function reviewedRepos(config) {
  return [...new Set(config.apps.map((a) => a.sourceRepo).filter(Boolean))];
}

/** The app a PR belongs to, or null when the repo is not one the monitor watches. */
export function appForRepo(config, repo) {
  return config.apps.find((a) => a.sourceRepo?.toLowerCase() === repo.toLowerCase()) ?? null;
}

/** The other platform's repo: the app guidelines require the same change, with the same branch name, in both. */
export function twinRepo(config, repo) {
  const repos = reviewedRepos(config);
  if (repos.length !== 2) return null;
  return repos.find((r) => r.toLowerCase() !== repo.toLowerCase()) ?? null;
}

export function reviewableRepos(config) {
  return reviewedRepos(config);
}
