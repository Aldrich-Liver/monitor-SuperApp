import { posix } from "node:path";

const AGENT_FILE = /(^|\/)(AGENTS|CLAUDE|BUGBOT|CONTRIBUTING)\.md$/i;
const README_FILE = /(^|\/)README\.md$/i;
const RULE_FILE = /(^|\/)\.cursor\/rules\/.+\.mdc?$/i;
const SKILL_FILE = /^(?:\.claude\/|\.cursor\/|\.agents\/)?skills\/[^/]+\/SKILL\.md$/i;
const PR_TEMPLATE = /^(\.github\/|docs\/)?pull_request_template\.md$|^\.github\/PULL_REQUEST_TEMPLATE\/[^/]+\.md$/i;
const MAX_LISTED_FILES = 10;
const IGNORED_DIR = /(^|\/)(_retirado|node_modules|Pods|build|\.build|DerivedData|\.git)\//i;

export function guidelineKind(path) {
  if (IGNORED_DIR.test(path) || !/\.mdc?$/i.test(path)) return null;
  if (SKILL_FILE.test(path)) return "skill";
  if (RULE_FILE.test(path)) return "rule";
  if (AGENT_FILE.test(path) || PR_TEMPLATE.test(path)) return "agents";
  if (README_FILE.test(path)) return "readme";
  if (/^\.[^/]+\//.test(path)) return null;
  return "doc";
}

/** Whether the frontmatter has to be read: rules and skills say there when they apply. */
export function needsMeta(path) {
  const kind = guidelineKind(path);
  return kind === "rule" || kind === "skill";
}

/** Frontmatter of Cursor rules and skills: `name`, `description`, `globs` (comma separated or a YAML list) and `alwaysApply`. */
export function ruleMeta(text = "") {
  const meta = { alwaysApply: false, globs: [], description: null, name: null };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return meta;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const [, key, raw = ""] = lines[i].match(/^(\w+):\s*(.*)$/) ?? [];
    if (!key) continue;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (key === "alwaysApply") meta.alwaysApply = value === "true";
    if (key === "description") meta.description = value || null;
    if (key === "name") meta.name = value || null;
    if (key === "globs") {
      const list = value ? value.replace(/^\[|\]$/g, "").split(",") : [];
      while (!value && lines[i + 1]?.match(/^\s*-\s+/)) list.push(lines[++i].replace(/^\s*-\s+/, ""));
      meta.globs = list.map((g) => g.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }
  return meta;
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${glob.includes("/") ? "" : "(?:.*/)?"}${re}$`);
}

/**
 * The team's written guidance that bears on a change:
 * - agent guidelines (`AGENTS.md`, `CLAUDE.md`…) and READMEs at the root, or in the folder of a changed file or above it;
 * - other documents in those folders, such as a module's pending list; at the root they are listed for the reviewer to judge;
 * - Cursor rules that always apply or whose globs match a changed file;
 * - skills, which describe how the team does a kind of work (fix a crash, release a version, test), for the reviewer to match to the PR.
 */
export function applicableGuidelines(files, changedPaths) {
  const result = [];
  for (const g of files) {
    const kind = guidelineKind(g.path);
    if (!kind) continue;
    const meta = g.meta ?? ruleMeta();
    const add = (appliesTo, extra = {}) => {
      const entry = { path: g.path, kind, ...(g.ref ? { ref: g.ref } : {}), ...extra };
      if (Array.isArray(appliesTo)) {
        entry.appliesTo = appliesTo.slice(0, MAX_LISTED_FILES);
        if (appliesTo.length > MAX_LISTED_FILES) entry.matchedFiles = appliesTo.length;
      } else entry.appliesTo = appliesTo;
      result.push(entry);
    };
    if (kind === "skill") {
      add("si aplica", { name: meta.name ?? posix.basename(posix.dirname(g.path)), description: meta.description });
      continue;
    }
    if (kind === "rule") {
      if (meta.alwaysApply) {
        add("todo el repo", { description: meta.description });
        continue;
      }
      const patterns = meta.globs.map(globToRegExp);
      const matched = changedPaths.filter((p) => patterns.some((re) => re.test(p)));
      if (matched.length) add(matched, { description: meta.description });
      else if (!meta.globs.length && meta.description) add("si aplica", { description: meta.description });
      continue;
    }
    const dir = PR_TEMPLATE.test(g.path) ? "." : posix.dirname(g.path);
    if (dir === ".") {
      add(kind === "doc" ? "si aplica" : "todo el repo");
      continue;
    }
    const matched = changedPaths.filter((p) => p.startsWith(`${dir}/`));
    if (matched.length) add(matched);
  }
  const order = { agents: 0, readme: 1, rule: 2, doc: 3, skill: 4 };
  return result.sort((a, b) => order[a.kind] - order[b.kind]);
}
