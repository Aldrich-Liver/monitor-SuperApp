const TZ = "America/Mexico_City";
const MESSAGE_LIMIT = 3500;
const ERROR_TYPE_LABEL = {
  FATAL: "Crash",
  NON_FATAL: "No fatal",
  ANR: "ANR (app congelada)",
};

export function escape(text = "") {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * For text handed to Cursor's Send to Slack tool, which may or may not escape it: angle brackets
 * become look-alikes so `<init>` survives either way.
 */
export function neutralize(text = "") {
  return String(text).replace(/</g, "‹").replace(/>/g, "›");
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** `mx.liverpool.app.Clase$Interna.<init>` -> `Clase$Interna.<init>`, readable in a one-line summary. */
export function shortTitle(title = "") {
  const afterDash = title.includes(" - ") ? title.split(" - ").pop() : title;
  const parts = afterDash.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : afterDash;
}

/** `> mx.app.Clase.metodo (Clase.kt:55) [com.app]` -> `Clase.metodo (Clase.kt:55)`. */
export function shortFrame(frame = "") {
  const clean = frame.replace(/^>?\s*/, "").replace(/\s*\[[^\]]*\]\s*$/, "");
  const m = clean.match(/^(\S+)(\s+\(.*\))?$/);
  return m ? `${shortTitle(m[1])}${m[2] ?? ""}` : clean;
}

const frameSymbol = (frame) => frame.replace(/^>?\s*/, "").split(" ")[0];

/** When Crashlytics blames the constructor of the error itself, the useful frame is the code that raised it. */
function whereFrame(d) {
  const ev = d.sampleEvent;
  if (!ev?.blameFrame) return null;
  if (frameSymbol(ev.blameFrame) !== d.issue.title) return ev.blameFrame;
  return ev.frames?.find((f) => frameSymbol(f) !== d.issue.title) ?? ev.blameFrame;
}

function sinceLabel(f) {
  const base = f.version.split(" ")[0];
  if (!f.issue.firstSeenVersion || f.issue.firstSeenVersion === base) return "nuevo en esta versión";
  return `desde ${f.issue.firstSeenVersion}`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

const errorLabel = (issue) => ERROR_TYPE_LABEL[issue.errorType] ?? issue.errorType;

/**
 * The message that opens a bug's thread; everything about the bug afterwards goes in that thread.
 * `ref` is how the monitor bot finds this message in the channel when Cursor posts it.
 */
export function bugReportText(f, { esc = escape, ref, test = false, testLabel = true } = {}) {
  const lines = [];
  if (test && testLabel) lines.push(":test_tube: *PRUEBA del monitor* · falla real, no es una alerta nueva");
  lines.push(`:rotating_light: *Falla nueva en ${esc(f.app)} ${esc(f.version)}* · ${errorLabel(f.issue)} · \`${esc(shortTitle(f.issue.title))}\``);
  lines.push(`${plural(f.newEvents, "evento", "eventos")} · ${plural(f.impactedUsers ?? 0, "usuario", "usuarios")} · ${sinceLabel(f)}${ref ? ` · Ref. ${ref}` : ""}`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function handoffText({ mention, reopened = false }) {
  const who = mention ? mention : "*Analista Crashlytics*";
  return `:mag: ${who}, analiza ${reopened ? "otra vez " : ""}esta falla.`;
}

const prRef = (pr) => (pr?.url ? `<${pr.url}|PR #${pr.number}>` : "el PR");

function day(iso) {
  return new Date(iso).toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "short" });
}

function dayTime(date) {
  return `${day(date)}, ${new Date(date).toLocaleTimeString("es-MX", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}`;
}

export function bugFixingText(pr) {
  return `:hammer_and_wrench: *En corrección* · ${prRef(pr)}${pr.state === "merged" ? " (fusionado)" : ""}`;
}

export function bugWatchingText(bug, quietHours) {
  return `:eye: *En revisión* · sin cambio de código por ahora · se resuelve tras ${quietHours} h sin eventos; reabre si aparece en otra versión`;
}

export function bugMergedText(pr) {
  return `:twisted_rightwards_arrows: *${prRef(pr)} fusionado* · espera versión`;
}

export function bugPrClosedText(pr) {
  return `:leftwards_arrow_with_hook: *${prRef(pr)} cerrado sin fusionar* · la falla vuelve a abierta`;
}

export function bugReleasedText(pr, version, until, method) {
  const includes = method === "date" ? `probablemente incluye el ${prRef(pr)} (por fecha)` : `incluye el ${prRef(pr)}`;
  return `:package: *En observación* · ${escape(version)} ${includes} · se resuelve el ${dayTime(until)} (CDMX) si no hay eventos`;
}

export function bugResolvedText(bug, { pr, version, released, quietHours }) {
  const head = `:white_check_mark: *Resuelta* · ${escape(bug.app)} · \`${escape(shortTitle(bug.issue.title))}\` · ${quietHours} h sin eventos`;
  if (released) return `${head} en ${escape(version)} con el ${prRef(pr)}`;
  return `${head} en ${escape(version)} · ${pr ? `el ${prRef(pr)} aún no sale en una versión` : "sin PR"}`;
}

export function bugReopenedText(bug, f, { resolvedAt, pr, fixVersion, fixMethod, reviewedVersion } = {}) {
  const head = `:warning: *Volvió a aparecer* · ${escape(f.app)} ${escape(f.version)} · \`${escape(shortTitle(f.issue.title))}\` · ${plural(f.newEvents, "evento", "eventos")}`;
  if (fixVersion && fixMethod === "date") return `${head} · se esperaba el ${prRef(pr)} en ${escape(fixVersion)}; quizá esa versión no lo trae`;
  if (reviewedVersion) return `${head} · el Corrector la había revisado en ${escape(reviewedVersion)} sin cambio de código`;
  if (fixVersion) return `${head} · el ${prRef(pr)} no la resolvió`;
  return `${head} · estaba resuelta desde el ${day(resolvedAt)}`;
}

const DIGEST_MAX = 15;

function digestStatus(b, esc) {
  if (b.status === "open") return "*sin PR*";
  if (b.status === "watching") return "en revisión";
  const pr = b.fix ? b.prs.find((p) => p.number === b.fix.pr) : b.prs.find((p) => p.state !== "closed");
  const name = pr ? `PR #${pr.number}` : "PR";
  if (b.fix) return `${name} en ${esc(b.fix.version.split(" ")[0])}, en observación`;
  return `${name} ${pr?.state === "merged" ? "fusionado" : "abierto"}`;
}

const DIGEST_TYPE = { FATAL: "Crash", NON_FATAL: "No fatal", ANR: "ANR" };
const shortApp = (app = "") => app.replace(/^Super App /, "");

/**
 * The morning reminder of open bugs, posted by Cursor, so it carries no links: each bug is named
 * by the Ref. of its report, and the monitor bot answers in its thread with the thread links.
 */
export function digestText(bugs, { now, quietHours, ref, esc = escape }) {
  const count = (status) => bugs.filter((b) => b.status === status).length;
  const watching = count("watching");
  const lines = [
    `:clipboard: *Crashlytics · ${day(now)}* · ${bugs.length} ${bugs.length === 1 ? "activa" : "activas"}: ${count("open")} sin PR · ${count("fixing")} en corrección` +
      (watching ? ` · ${watching} en revisión` : ""),
  ];
  for (const b of bugs.slice(0, DIGEST_MAX)) {
    lines.push(
      `• ${b.ref ? `${b.ref} · ` : ""}${esc(shortApp(b.app))} ${esc(b.lastVersion.split(" ")[0])} · ${DIGEST_TYPE[b.issue.errorType] ?? errorLabel(b.issue)} · ` +
        `\`${esc(shortTitle(b.issue.title))}\` · ${plural(b.sinceDigest, "evento", "eventos")}/24 h · ${digestStatus(b, esc)}`
    );
  }
  if (bugs.length > DIGEST_MAX) lines.push(`_y ${plural(bugs.length - DIGEST_MAX, "falla más", "fallas más")}_`);
  lines.push(`Enlaces en el hilo${ref ? ` · Ref. ${ref}` : ""}`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

/** The monitor bot's reply under the summary. `permalinks` maps a bug key to the link of its thread. */
export function digestLinksText(bugs, permalinks) {
  const links = bugs
    .slice(0, DIGEST_MAX)
    .filter((b) => permalinks[b.key])
    .map((b) => `<${permalinks[b.key]}|${escape(b.ref ?? shortTitle(b.issue.title))}>`);
  return links.length ? truncate(`:link: ${links.join(" · ")}`, MESSAGE_LIMIT) : null;
}

/**
 * `reason` is technical (an env var, an HTTP status); the thread gets what it means for the team.
 * Starts with "No se pudo activar al", which is how the Corrector spots a Revisor that failed.
 */
function unavailableText(who, reason = "") {
  const what = /WEBHOOK_(URL|KEY)/.test(reason)
    ? "falta configurar su webhook"
    : /HTTP 40[13]/.test(reason)
      ? "su webhook rechazó la llamada"
      : /HTTP 5\d\d|fetch failed|timeout|ETIMEDOUT|ECONNRESET/i.test(reason)
        ? "su webhook no respondió"
        : escape(truncate(reason, 200));
  return `:warning: No se pudo activar al ${who} · ${what}. Avísale a quien administra las automatizaciones.`;
}

export function analystUnavailableText(reason) {
  return unavailableText("Analista Crashlytics", reason);
}

/** `(Clase.kt:55)` -> `Clase.kt:55`: in the thread the file and line say where; the method is in Crashlytics. */
function whereLabel(frame) {
  const short = shortFrame(frame);
  return short.match(/\(([^()]+:\d+)\)$/)?.[1] ?? short;
}

export function detailText(d, analysis, index = 1, total = 1) {
  const position = total > 1 ? `${index}/${total} · ` : "";
  const where = whereFrame(d);
  const head = [
    `*${position}${escape(d.app)} ${escape(d.version)}*`,
    ERROR_TYPE_LABEL[d.issue.errorType] ?? d.issue.errorType,
    where ? `\`${escape(truncate(whereLabel(where), 120))}\`` : null,
    d.issue.uri ? `<${d.issue.uri}|Ver en Crashlytics>` : null,
  ];
  const lines = [head.filter(Boolean).join(" · ")];
  if (d.issue.subtitle) lines.push(`> ${escape(truncate(d.issue.subtitle.replace(/\s+/g, " "), 300))}`);
  if (analysis?.cause) lines.push(`*Qué está pasando:* ${escape(analysis.cause)}`);
  if (analysis?.fix) lines.push(`*Solución propuesta:* ${escape(analysis.fix)}`);
  if (!analysis) lines.push("_Sin análisis disponible._");
  if (d.sourceRepo) lines.push("_¿La corregimos? `@Cursor corrige esta falla`_");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function versionText(finding, { esc = escape } = {}) {
  const fresh = finding.apps.filter((s) => s.change === "new");
  const failed = finding.apps.filter((s) => s.error).map((s) => `${esc(s.app)}: no se pudo revisar`);
  if (!fresh.length) {
    const apps = finding.apps.filter((s) => !s.error).map((s) => (s.latestVersion ? `${esc(s.app)} ${esc(s.latestVersion)}` : `${esc(s.app)}: sin datos`));
    return truncate([":white_check_mark: *Monitor de Crashlytics activo*", ...apps, ...failed].join(" · "), MESSAGE_LIMIT);
  }
  const parts = fresh.map(
    (s) => `${esc(s.app)} ${esc(s.latestVersion)}${s.previousVersion ? `, antes ${esc(s.previousVersion)}` : ""} · ${plural(s.issues, "issue", "issues")} con eventos`
  );
  const firsts = finding.apps.filter((s) => s.change === "first").map((s) => `${esc(s.app)} ${esc(s.latestVersion)}: en seguimiento desde ahora`);
  const head = `:package: *${fresh.length === 1 ? "Versión nueva" : "Versiones nuevas"} en Crashlytics*`;
  const text = fresh.length === 1 ? `${head} · ${parts[0]}` : [head, ...parts.map((p) => `• ${p}`)].join("\n");
  return truncate([text, ...firsts, ...failed].join(" · "), MESSAGE_LIMIT);
}

/** What the team can do about the monitor's error; the technical text stays in the run's log. */
function errorHint(message) {
  if (/\b40[13]\b|invalid_grant|unauthenticated|permission|credencial|credential|token/i.test(message)) {
    return "la credencial de Firebase venció o no tiene permiso: renueva `FIREBASE_TOKEN` o `CRASHLYTICS_SA_KEY` en los secretos de Cursor";
  }
  if (/\b5\d\d\b|fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|timeout/i.test(message)) return "Firebase no respondió; reintenta en la siguiente revisión";
  return null;
}

export function errorText(message, { esc = escape } = {}) {
  const hint = errorHint(message);
  return `:x: *Monitor sin datos de Crashlytics* · ${hint ?? `\`${esc(truncate(message.replace(/\s+/g, " "), 300))}\``}`;
}

const MAX_REVIEW_ITEMS = 6;

const prLink = (pr) => `<${pr.url}|PR #${pr.number}>`;
const userMention = (id) => (id && /^[UW][A-Z0-9]+$/.test(id) ? `<@${id}> ` : "");

export function reviewAckText({ pr }) {
  return `:eyes: Revisando el ${prLink(pr)}…`;
}

export function reviewerUnavailableText(reason) {
  return unavailableText("Revisor de PRs", reason);
}

const baseName = (path = "") => path.split("/").pop();
const sentence = (text = "") => text.trim().replace(/[.;\s]+$/, "");
const lowerFirst = (text = "") => text.replace(/^\p{Lu}(?!\p{Lu})/u, (c) => c.toLowerCase());

function reviewItem(item, n) {
  const where = item.file ? `\`${escape(baseName(item.file))}${item.line ? `:${item.line}` : ""}\` ` : "";
  const problem = item.problem ?? "";
  if (!item.suggestion) return `${n}. ${where}${escape(problem)}`;
  return `${n}. ${where}${escape(sentence(problem))}: ${escape(lowerFirst(item.suggestion))}`;
}

/** The verdict in the thread. `review` is what the Revisor wrote in `.reviewer/review.json`. */
export function reviewText(context, review) {
  const pr = context.pr;
  if (review.verdict === "error") {
    return `:x: *No pude revisar el* ${prLink(pr)} · ${escape(review.summary ?? "sin detalle")}`;
  }
  const approved = review.verdict === "approve";
  const items = approved ? [] : review.items ?? [];
  const head = [
    approved ? ":white_check_mark: *Visto bueno*" : ":warning: *Cambios necesarios*",
    prLink(pr),
    items.length ? plural(items.length, "punto", "puntos") : null,
    userMention(context.requested_by).trim() || null,
  ];
  const lines = [head.filter(Boolean).join(" · ")];
  if (review.previous) lines.push(`_Ronda anterior:_ ${escape(review.previous)}`);
  if (items.length) {
    lines.push(...items.slice(0, MAX_REVIEW_ITEMS).map((item, i) => reviewItem(item, i + 1)));
    if (items.length > MAX_REVIEW_ITEMS) lines.push(`_y ${items.length - MAX_REVIEW_ITEMS} más en el PR._`);
  } else if (review.summary) lines.push(escape(review.summary));
  const goal = review.fixesFailure ? `*¿Corrige la falla?* ${escape(review.fixesFailure)}` : review.meetsGoal ? `*¿Cumple su objetivo?* ${escape(review.meetsGoal)}` : null;
  if (goal) lines.push(goal);
  if (review.githubPosted && items.length) lines.push("_Sugerencias y lineamientos en el PR._");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

const MAX_TEST_ITEMS = 3;

function minutes(seconds = 0) {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function testsHeadline(result) {
  const t = result.tests;
  const lint = result.lint;
  const counts = t ? (t.failed ? `${t.failed} de ${plural(t.total, "prueba", "pruebas")} ${t.failed === 1 ? "falló" : "fallaron"}` : plural(t.total, "prueba", "pruebas")) : null;
  const lintPart = lint ? (lint.errors ? plural(lint.errors, "error nuevo de lint", "errores nuevos de lint") : "lint sin errores nuevos") : null;
  return [counts, lintPart, minutes(result.durationS)].filter(Boolean).join(" · ");
}

export const TEST_STATUS = {
  passed: ":white_check_mark: *Pruebas OK*",
  failed: ":x: *Pruebas fallidas*",
  "build-failed": ":x: *No compila*",
  timeout: ":hourglass: *Pruebas detenidas*",
  error: ":warning: *No se pudieron correr las pruebas*",
};

/**
 * Details of what went wrong, as plain items shared by the Slack reply and the GitHub comment.
 * `brief` is the Slack line: the file without its path and no assertion text, which stays in the PR.
 */
function testProblems(result) {
  const at = (file, line) => `${file}${line ? `:${line}` : ""}`;
  const items = [];
  for (const f of result.tests?.failures ?? []) items.push({ where: f.test, text: f.message, brief: `\`${f.test}\`` });
  for (const i of result.lint?.issues ?? []) {
    items.push({ where: at(i.file, i.line), text: `lint ${i.id}: ${i.message}`, brief: `\`${at(baseName(i.file), i.line)}\` ${i.id}` });
  }
  for (const e of result.compileErrors ?? []) {
    const where = e.file ? at(e.file, e.line) : null;
    items.push({ where, text: e.message, brief: `${e.file ? `\`${at(baseName(e.file), e.line)}\` ` : ""}${truncate(e.message, 160)}` });
  }
  if (result.status === "timeout") {
    items.push({ where: null, text: "Gradle pasó del límite de tiempo sin terminar; revisa si una prueba se queda colgada.", brief: "Posible prueba colgada." });
  }
  return items;
}

/** The test run in the PR's Slack thread, posted by the monitor bot. */
export function testsText(result) {
  const pr = result.pr;
  const sha = pr.headSha ? ` · \`${pr.headSha.slice(0, 7)}\`` : "";
  const items = testProblems(result);
  const head = `${TEST_STATUS[result.status] ?? result.status} · ${prLink(pr)}${sha} · ${testsHeadline(result)}`;
  if (items.length === 1) return truncate(`${head} · ${escape(items[0].brief)}`, MESSAGE_LIMIT);
  const lines = [head, ...items.slice(0, MAX_TEST_ITEMS).map((item) => `• ${escape(item.brief)}`)];
  if (items.length > MAX_TEST_ITEMS) lines.push(`_y ${items.length - MAX_TEST_ITEMS} más en el PR._`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

/** The same run as a Markdown comment for the PR on GitHub. */
export function testsComment(result) {
  const pr = result.pr;
  const label = { passed: "✅ Pruebas OK", failed: "❌ Pruebas fallidas", "build-failed": "❌ No compila", timeout: "⌛ Pruebas detenidas", error: "⚠️ No se pudieron correr las pruebas" };
  const lines = [
    `**${label[result.status] ?? result.status}** · \`${(pr.headSha ?? "").slice(0, 7)}\` · ${testsHeadline(result)}`,
    "",
    `\`./gradlew ${(result.tasks ?? []).join(" ")}\``,
  ];
  const items = testProblems(result);
  if (items.length) {
    lines.push("");
    for (const item of items.slice(0, 15)) lines.push(`- ${item.where ? `\`${item.where}\`: ` : ""}${item.text}`);
  }
  lines.push("", "_Corrida automática de Pruebas de PRs. iOS no se compila en la nube._");
  return lines.join("\n");
}

const twinLabel = (repo) => (/ios/i.test(repo) ? "iOS" : /android/i.test(repo) ? "Android" : repo);

/**
 * The message Cursor posts in the channel when a PR is opened; its thread gets the review and the
 * tests. Plain URLs, because Send to Slack may escape angle brackets, and the twin's URL is how
 * its review and tests find this thread.
 */
export function prOpenedText({ pr, app, twin, esc = neutralize }) {
  const title = pr.title ? ` · ${esc(truncate(pr.title, 120))}` : "";
  const lines = [`:arrow_heading_up: *PR nuevo* · ${esc(app)} #${pr.number}${title}${pr.author ? ` · de ${esc(pr.author)}` : ""}`];
  const twinNote = twin?.pr ? ` · gemelo ${twinLabel(twin.repo)}: ${twin.pr.url}` : twin && twin.pr === null ? ` · :warning: falta el gemelo en ${twinLabel(twin.repo)}` : "";
  lines.push(`${pr.url}${twinNote}`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function twinOpenedText({ pr, app }) {
  return `:link: Gemelo en ${escape(app)}: ${prLink(pr)}`;
}

export function twinMissingText(twin) {
  return `:warning: Falta el gemelo en ${twinLabel(twin.repo)} (rama \`${escape(twin.branch ?? "?")}\`). Si solo aplica a una plataforma, dilo en el PR.`;
}

/** Starts with "El *Corrector* toma esta falla", which marks the bug as taken so a second request waits. */
export function testsAckText({ pr }) {
  return `:test_tube: Corriendo pruebas y lint del ${prLink(pr)}… Respondo aquí en unos 5 a 10 min.`;
}

export function testerUnavailableText(reason) {
  return unavailableText("Pruebas de PRs", reason);
}

/** What a bot answers when a mention brings nothing it can act on. */
export function mentionHelpText(kind, apps = []) {
  if (kind === "reviewer") {
    return ":information_source: Pega el enlace del PR en tu mensaje, o escríbeme en el hilo del PR: `@Revisor de PRs revisa este PR <enlace>`.";
  }
  if (kind === "tester") {
    return `:information_source: Pega el enlace del PR en tu mensaje, o escríbeme en el hilo del PR. Solo pruebo PRs de ${apps.join(" o ")}.`;
  }
  return ":information_source: Escríbeme en el hilo de la falla: `@Corrector de fallas corrige esta falla`.";
}

export function fixAckText() {
  return ":wrench: El *Corrector* toma esta falla. Aviso aquí con los PR.";
}

export function fixerUnavailableText(reason) {
  return unavailableText("Corrector", reason);
}

const FIX_HEAD = {
  "in-review": ":arrows_counterclockwise: *PR abiertos, en verificación*",
  fixed: ":hammer_and_wrench: *Corrección propuesta*",
  "no-change": ":information_source: *Sin cambios de código*",
  error: ":x: *No pude corregir esta falla*",
};

/**
 * The Corrector's answer in the bug's thread. Linking the PRs here is what puts the bug in
 * correction; the summary goes on the second line, where the monitor reads a no-change verdict.
 */
export function fixResultText(result, prs, { requester } = {}) {
  const head = [FIX_HEAD[result.status] ?? `*${escape(result.status)}*`, ...prs.map((pr) => `<${pr.url}|${twinLabel(pr.repo)} #${pr.number}>`)];
  if (result.status === "fixed" && userMention(requester)) head.push(userMention(requester).trim());
  const lines = [head.join(" · ")];
  if (result.summary) lines.push(escape(result.summary));
  if (result.status !== "fixed") return truncate(lines.join("\n"), MESSAGE_LIMIT);
  const checks = [result.checks && `*Pruebas:* ${escape(result.checks)}`, result.review && `*Revisión:* ${escape(result.review)}`].filter(Boolean);
  if (checks.length) lines.push(checks.join(" · "));
  const left = [result.notTested, result.pending].filter(Boolean).map((t) => escape(sentence(t)));
  if (prs.length) left.push("el merge lo hace una persona");
  if (left.length) lines.push(`*Falta:* ${left.map((t, i) => (i ? lowerFirst(t) : t)).join("; ")}.`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}
