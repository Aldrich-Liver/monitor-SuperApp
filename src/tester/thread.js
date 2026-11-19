import { TEST_STATUS } from "../format.js";
import { mentionsPr } from "../reviewer/pr.js";

/**
 * The latest result Pruebas de PRs posted in the thread for the PR at commit `sha`, as
 * `{ status, ts, text }` with the statuses of `tests:run`; null while there is none.
 */
export function testsVerdict(messages, pr, sha) {
  const short = sha ? `\`${sha.slice(0, 7)}\`` : null;
  let found = null;
  for (const m of messages) {
    const text = m.text ?? "";
    if (!mentionsPr(text, pr) || (short && !text.includes(short))) continue;
    const status = Object.entries(TEST_STATUS).find(([, head]) => text.startsWith(head))?.[0];
    if (status) found = { status, ts: m.ts, text };
  }
  return found;
}
