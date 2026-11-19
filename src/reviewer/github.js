import { execFileSync } from "node:child_process";

const BODY_CHARS = 8000;

/**
 * `GITHUB_TOKEN`, or the token the cloud environment already gives git for github.com. Only used to
 * read the PR (title, description, branches); never printed.
 */
export function githubToken() {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  try {
    const config = execFileSync("git", ["config", "--get-regexp", "^url\\..*github\\.com/\\.insteadof$"], { encoding: "utf8" });
    return config.match(/^url\.https:\/\/[^:\s]+:([^@\s]+)@github\.com\//m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The parsed body of a GitHub API GET, or null when the API is out of reach or answers with an error. */
async function api(path) {
  const token = githubToken();
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.json();
}

function describe(p) {
  const body = p.body ?? "";
  return {
    number: p.number,
    url: p.html_url,
    title: p.title,
    body: body.length > BODY_CHARS ? `${body.slice(0, BODY_CHARS - 1)}…` : body,
    author: p.user?.login ?? null,
    state: p.merged || p.merged_at ? "merged" : p.state,
    draft: Boolean(p.draft),
    base: p.base?.ref ?? null,
    headBranch: p.head?.ref ?? null,
    headSha: p.head?.sha ?? null,
    headRepo: p.head?.repo?.full_name ?? null,
    mergeCommit: p.merged || p.merged_at ? p.merge_commit_sha ?? null : null,
    mergedAt: p.merged_at ?? null,
  };
}

/** The PR as GitHub describes it, or null when the API is out of reach; the review then relies on git alone. */
export async function fetchPr({ owner, repo, number }) {
  const p = await api(`/repos/${owner}/${repo}/pulls/${number}`);
  return p ? describe(p) : null;
}

/**
 * The most recent PR of `repo` opened from `branch` in the same owner, open ones first. `undefined`
 * when GitHub can't be read, so a missing twin is not confused with an unknown one.
 */
export async function prForBranch({ owner, repo, branch }) {
  const list = await api(`/repos/${owner}/${repo}/pulls?${new URLSearchParams({ head: `${owner}:${branch}`, state: "all", per_page: "10" })}`);
  if (!Array.isArray(list)) return undefined;
  const prs = list.map(describe).sort((a, b) => (a.state === "open") - (b.state === "open") || a.number - b.number);
  return prs.at(-1) ?? null;
}
