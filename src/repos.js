import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
