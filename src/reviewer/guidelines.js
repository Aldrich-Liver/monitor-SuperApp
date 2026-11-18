import { posix } from "node:path";

const GUIDE_FILE = /(^|\/)(AGENTS|CLAUDE|BUGBOT)\.md$/i;
const RULE_FILE = /(^|\/)\.cursor\/rules\/.+\.mdc?$/i;

export function isGuideline(path) {
  return GUIDE_FILE.test(path) || RULE_FILE.test(path);
}

/** Cursor rule frontmatter: `description`, `globs` (comma separated or a YAML list) and `alwaysApply`. */
export function ruleMeta(text = "") {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { alwaysApply: false, globs: [], description: null };
  const meta = { alwaysApply: false, globs: [], description: null };
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const [, key, raw = ""] = lines[i].match(/^(\w+):\s*(.*)$/) ?? [];
    if (!key) continue;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (key === "alwaysApply") meta.alwaysApply = value === "true";
    if (key === "description") meta.description = value || null;
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
 * Which guideline files bear on a change: `AGENTS.md`-style files in the folder of a changed file or
 * any folder above it, and rules that always apply or whose globs match a changed file. Rules that
 * only have a description are listed too, for the reviewer to judge.
 */
export function applicableGuidelines(guidelines, changedPaths) {
  const result = [];
  for (const g of guidelines) {
    if (GUIDE_FILE.test(g.path)) {
      const dir = posix.dirname(g.path);
      const files = dir === "." ? changedPaths : changedPaths.filter((p) => p.startsWith(`${dir}/`));
      if (files.length) result.push({ path: g.path, kind: "agents", appliesTo: dir === "." ? "todo el repo" : files });
      continue;
    }
    const meta = g.meta ?? { alwaysApply: false, globs: [] };
    if (meta.alwaysApply) {
      result.push({ path: g.path, kind: "rule", appliesTo: "todo el repo", description: meta.description });
      continue;
    }
    const patterns = meta.globs.map(globToRegExp);
    const files = changedPaths.filter((p) => patterns.some((re) => re.test(p)));
    if (files.length) result.push({ path: g.path, kind: "rule", appliesTo: files, description: meta.description });
    else if (!meta.globs.length && meta.description) result.push({ path: g.path, kind: "rule", appliesTo: "si aplica", description: meta.description });
  }
  return result;
}
