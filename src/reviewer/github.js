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

/** The PR as GitHub describes it, or null when the API is out of reach; the review then relies on git alone. */
export async function fetchPr({ owner, repo, number }) {
  const token = githubToken();
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => null);
  if (!res?.ok) return null;
  const p = await res.json();
  const body = p.body ?? "";
  return {
    title: p.title,
    body: body.length > BODY_CHARS ? `${body.slice(0, BODY_CHARS - 1)}…` : body,
    author: p.user?.login ?? null,
    state: p.merged ? "merged" : p.state,
    draft: Boolean(p.draft),
    base: p.base?.ref ?? null,
    headBranch: p.head?.ref ?? null,
    headRepo: p.head?.repo?.full_name ?? null,
    mergeCommit: p.merged ? p.merge_commit_sha ?? null : null,
    mergedAt: p.merged_at ?? null,
  };
}
