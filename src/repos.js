import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** An app repo cloned next to the monitor in the Super App environment, or null. */
export function findRepoDir(name, reposDir = "..") {
  for (const dir of [resolve(reposDir, name), join("/agent/repos", name), join("/workspace", name)]) {
    if (existsSync(join(dir, ".git"))) return dir;
  }
  return null;
}

export function git(dir, args, opts = {}) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

export function gitOk(dir, args) {
  try {
    git(dir, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * The app repos are copies synced from the org's repos, so a build commit and a merge commit can
 * be on separate histories with the same code. The PR is in the build if its diff reverts cleanly
 * on the build's tree.
 */
export function containsChanges(dir, revision, commit) {
  const index = join(tmpdir(), `monitor-index-${process.pid}-${commit.slice(0, 12)}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const diff = git(dir, ["diff", "--binary", "--full-index", `${commit}^1`, commit]);
    if (!diff) return false;
    git(dir, ["read-tree", revision], { env });
    git(dir, ["apply", "--cached", "--check", "-R", "-"], { env, input: `${diff}\n`, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(index, { force: true });
  }
}
