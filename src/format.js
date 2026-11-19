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
  if (test && testLabel) lines.push(":test_tube: *PRUEBA del monitor*: falla real, pero este mensaje no es una alerta nueva.");
  lines.push(`:rotating_light: *Falla nueva en ${esc(f.app)} ${esc(f.version)}* · ${errorLabel(f.issue)} · \`${esc(shortTitle(f.issue.title))}\``);
  if (f.issue.subtitle) lines.push(`> ${esc(truncate(f.issue.subtitle.replace(/\s+/g, " "), 200))}`);
  lines.push(`${plural(f.newEvents, "evento", "eventos")} · ${plural(f.impactedUsers ?? 0, "usuario", "usuarios")} · ${sinceLabel(f)}`);
  lines.push(`:thread: Detalle, solución propuesta y seguimiento en el hilo.${ref ? ` · Ref. ${ref}` : ""}`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function handoffText({ mention, reopened = false }) {
  const who = mention ? mention : "*Analista Crashlytics*";
  return `:mag: ${who}, revisa ${reopened ? "otra vez " : ""}esta falla contra el código del release y responde en este hilo con el detalle y una solución propuesta.`;
}

const prRef = (pr) => (pr?.url ? `<${pr.url}|PR #${pr.number}>` : "el PR");

function day(iso) {
  return new Date(iso).toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "short" });
}

function dayTime(date) {
  return `${day(date)}, ${new Date(date).toLocaleTimeString("es-MX", { timeZone: TZ, hour: "numeric", minute: "2-digit" })}`;
}

export function bugFixingText(pr, quietHours) {
  const merged = pr.state === "merged" ? " Ya está fusionado." : "";
  return `:hammer_and_wrench: *En corrección* con el ${prRef(pr)}.${merged} Aviso aquí cuando salga en una versión; tras ${quietHours} h sin eventos la doy por resuelta.`;
}

export function bugMergedText(pr) {
  return `:twisted_rightwards_arrows: El ${prRef(pr)} ya está fusionado. Aviso aquí cuando salga en una versión.`;
}

export function bugPrClosedText(pr) {
  return `:leftwards_arrow_with_hook: El ${prRef(pr)} se cerró sin fusionarse: la falla vuelve a quedar abierta.`;
}

export function bugReleasedText(pr, version, until, method) {
  const how = method === "date" ? " (por fecha: salió después de la fusión, pero no pude confirmarlo con su código)" : "";
  return `:package: *${escape(version)}* ya incluye el ${prRef(pr)}${how}. Si no hay eventos de esta falla hasta el ${dayTime(until)} (hora CDMX), la doy por resuelta.`;
}

export function bugResolvedText(bug, { pr, version, released, quietHours }) {
  const head = `:white_check_mark: *Resuelto* · ${escape(bug.app)} · \`${escape(shortTitle(bug.issue.title))}\``;
  if (released) return `${head}\n${quietHours} h sin eventos en ${escape(version)}, que incluye el ${prRef(pr)}.`;
  const note = pr ? ` El ${prRef(pr)} todavía no sale en una versión.` : " Nadie ligó un PR: dejó de ocurrir sola.";
  return `${head}\n${quietHours} h sin eventos en ${escape(version)}.${note}`;
}

export function bugReopenedText(bug, f, { resolvedAt, pr, fixVersion, fixMethod } = {}) {
  const head = `:warning: *Volvió a aparecer* · ${escape(f.app)} ${escape(f.version)} · \`${escape(shortTitle(f.issue.title))}\` · ${plural(f.newEvents, "evento", "eventos")}`;
  if (fixVersion && fixMethod === "date") {
    return `${head}\nSe esperaba el ${prRef(pr)} en ${escape(fixVersion)}, pero puede que esa versión no lo traiga o que no la haya resuelto: vuelve a quedar abierta.`;
  }
  if (fixVersion) return `${head}\nYa salió el ${prRef(pr)} en ${escape(fixVersion)} y no la resolvió: vuelve a quedar abierta.`;
  return `${head}\nSe había dado por resuelta el ${day(resolvedAt)}: vuelve a quedar abierta.`;
}

const DIGEST_MAX = 15;

function digestStatus(b, esc) {
  if (b.status === "open") return "sin PR";
  const pr = b.fix ? b.prs.find((p) => p.number === b.fix.pr) : b.prs.find((p) => p.state !== "closed");
  const name = pr ? `PR #${pr.number}` : "el PR";
  if (b.fix) return `${name} en ${esc(b.fix.version)}, en observación`;
  return `en corrección con el ${name} (${pr?.state === "merged" ? "fusionado, espera versión" : "en revisión"})`;
}

/**
 * The morning reminder of open bugs, posted by Cursor, so it carries no links: each bug is named
 * by the Ref. of its report, and the monitor bot answers in its thread with the thread links.
 */
export function digestText(bugs, { now, quietHours, ref, esc = escape }) {
  const open = bugs.filter((b) => b.status === "open").length;
  const lines = [
    `:clipboard: *Fallas abiertas de Crashlytics* · ${bugs.length} al ${day(now)} · ${open} sin PR, ${bugs.length - open} en corrección`,
  ];
  for (const b of bugs.slice(0, DIGEST_MAX)) {
    lines.push(
      `• *${esc(b.app)} ${esc(b.lastVersion)}* · ${errorLabel(b.issue)} · \`${esc(shortTitle(b.issue.title))}\` · ` +
        `${plural(b.sinceDigest, "evento", "eventos")} en 24 h · desde el ${day(b.openedAt)} · ${digestStatus(b, esc)}${b.ref ? ` · ${b.ref}` : ""}`
    );
  }
  if (bugs.length > DIGEST_MAX) lines.push(`_y ${plural(bugs.length - DIGEST_MAX, "falla más", "fallas más")}_`);
  lines.push(
    `_Para tomar una, pega el PR en su hilo, o escribe ahí \`@Cursor corrige esta falla\` para que el Corrector abra los PR. Se dan por resueltas tras ${quietHours} h sin eventos._`
  );
  lines.push(`:thread: Enlaces a cada hilo en este hilo.${ref ? ` · Ref. ${ref}` : ""}`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

/** The monitor bot's reply under the summary. `permalinks` maps a bug key to the link of its thread. */
export function digestLinksText(bugs, permalinks) {
  const lines = bugs
    .slice(0, DIGEST_MAX)
    .filter((b) => permalinks[b.key])
    .map((b) => `• <${permalinks[b.key]}|${escape(b.ref ?? shortTitle(b.issue.title))}> · ${escape(b.app)} · \`${escape(shortTitle(b.issue.title))}\``);
  return lines.length ? truncate([":link: *Hilos de las fallas abiertas*", ...lines].join("\n"), MESSAGE_LIMIT) : null;
}

export function analystUnavailableText(reason) {
  return `:warning: No se pudo activar al Analista Crashlytics: ${escape(reason)}`;
}

export function detailText(d, analysis, index = 1, total = 1) {
  const position = total > 1 ? `${index}/${total} · ` : "";
  const lines = [
    `*${position}${escape(d.app)} ${escape(d.version)}* · ${ERROR_TYPE_LABEL[d.issue.errorType] ?? d.issue.errorType}`,
    `*Error:* \`${escape(shortTitle(d.issue.title))}\``,
  ];
  if (d.issue.subtitle) lines.push(`> ${escape(truncate(d.issue.subtitle, 300))}`);
  const where = whereFrame(d);
  if (where) lines.push(`*Dónde:* \`${escape(truncate(shortFrame(where), 200))}\``);
  lines.push(
    `*Eventos:* ${d.newEvents} nuevos · ${d.totalEvents} en esta versión · ${plural(d.impactedUsers, "usuario", "usuarios")} · ${sinceLabel(d)}`
  );
  if (analysis?.cause) lines.push(`*Qué está pasando:* ${escape(analysis.cause)}`);
  if (analysis?.fix) lines.push(`*Solución propuesta:* ${escape(analysis.fix)}`);
  if (!analysis) lines.push("_Sin análisis disponible para esta falla._");
  if (d.issue.uri) lines.push(`<${d.issue.uri}|Ver en Crashlytics>`);
  if (d.sourceRepo) lines.push("_Para que el Corrector abra los PR con la solución, escribe en este hilo `@Cursor corrige esta falla`._");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function versionText(finding, { esc = escape } = {}) {
  const fresh = finding.apps.filter((s) => s.change === "new");
  const header = fresh.length
    ? `:white_check_mark: *Monitor de Crashlytics activo* · ${fresh.length === 1 ? "versión nueva" : "versiones nuevas"}: ${fresh
        .map((s) => `${esc(s.app)} ${esc(s.latestVersion)}`)
        .join(", ")}`
    : ":white_check_mark: *Monitor de Crashlytics activo*";
  const lines = [header];
  for (const s of finding.apps) {
    if (s.error) lines.push(`${esc(s.app)}: no se pudo revisar`);
    else if (!s.latestVersion) lines.push(`${esc(s.app)}: sin datos en Crashlytics`);
    else if (s.change === "new") {
      lines.push(
        `*${esc(s.app)} ${esc(s.latestVersion)}*: versión nueva (antes ${esc(s.previousVersion)}), ${plural(s.issues, "issue", "issues")} con eventos hasta ahora`
      );
    } else if (s.change === "first") {
      lines.push(`${esc(s.app)} ${esc(s.latestVersion)}: ${plural(s.issues, "issue existente registrado", "issues existentes registrados")}`);
    } else {
      lines.push(`${esc(s.app)} ${esc(s.latestVersion)}: ${plural(s.issues, "issue", "issues")} con eventos en esta versión`);
    }
  }
  lines.push("Cada falla nueva de la última versión tiene su propio hilo, sin importar su gravedad; las abiertas van en el resumen de cada mañana.");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function errorText(message, { esc = escape } = {}) {
  return `:x: *El monitor de Crashlytics no pudo revisar*\n\`\`\`${esc(truncate(message, 2500))}\`\`\``;
}

const MAX_REVIEW_ITEMS = 6;

const prLink = (pr) => `<${pr.url}|PR #${pr.number}>`;
const userMention = (id) => (id && /^[UW][A-Z0-9]+$/.test(id) ? `<@${id}> ` : "");

export function reviewAckText({ pr, app, requester }) {
  return `:eyes: ${userMention(requester)}Reviso el ${prLink(pr)} de ${escape(app)} con los lineamientos, skills y documentos del equipo. Respondo en este hilo en unos minutos.`;
}

export function reviewerUnavailableText(reason) {
  return `:warning: No se pudo activar al Revisor de PRs: ${escape(reason)}`;
}

function reviewItem(item, n) {
  const where = item.file ? `\`${escape(item.file)}${item.line ? `:${item.line}` : ""}\` · ` : "";
  const lines = [`${n}. ${where}${escape(item.problem ?? "")}`];
  if (item.suggestion) lines.push(`   _Sugerencia:_ ${escape(item.suggestion)}`);
  if (item.guideline) lines.push(`   _Lineamiento:_ ${escape(item.guideline)}`);
  return lines.join("\n");
}

/** The verdict in the thread. `review` is what the Revisor wrote in `.reviewer/review.json`. */
export function reviewText(context, review) {
  const pr = context.pr;
  const head = [prLink(pr), escape(context.app), pr.title ? `_${escape(truncate(pr.title, 120))}_` : null, pr.headBranch ? `\`${escape(pr.headBranch)}\`` : null]
    .filter(Boolean)
    .join(" · ");
  const who = userMention(context.requested_by);
  if (review.verdict === "error") {
    return `:x: *No pude revisar el* ${prLink(pr)}: ${escape(review.summary ?? "sin detalle")}`;
  }
  const approved = review.verdict === "approve";
  const lines = [`${approved ? ":white_check_mark: *Visto bueno*" : ":warning: *Cambios necesarios*"} · ${head}`];
  if (review.summary) lines.push(`${who}${escape(review.summary)}`);
  if (review.previous) lines.push(`*Revisión anterior:* ${escape(review.previous)}`);
  if (review.fixesFailure) lines.push(`*¿Corrige la falla del hilo?* ${escape(review.fixesFailure)}`);
  else if (review.meetsGoal) lines.push(`*¿Cumple su objetivo?* ${escape(review.meetsGoal)}`);
  const items = review.items ?? [];
  if (!approved && items.length) {
    lines.push(...items.slice(0, MAX_REVIEW_ITEMS).map((item, i) => reviewItem(item, i + 1)));
    if (items.length > MAX_REVIEW_ITEMS) lines.push(`_y ${items.length - MAX_REVIEW_ITEMS} más en el PR._`);
  }
  if (review.githubPosted) lines.push("_La revisión también quedó en el PR de GitHub._");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

const MAX_TEST_ITEMS = 5;

function minutes(seconds = 0) {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function testsHeadline(result) {
  const t = result.tests;
  const lint = result.lint;
  const counts = t ? `${plural(t.total, "prueba", "pruebas")}${t.failed ? `, ${t.failed} fallida${t.failed === 1 ? "" : "s"}` : ""}` : null;
  const lintPart = lint
    ? lint.errors
      ? `lint: ${plural(lint.errors, "error nuevo", "errores nuevos")}`
      : `lint sin errores nuevos${lint.previousErrors ? ` (${lint.previousErrors} previos en archivos que el PR no toca)` : ""}`
    : null;
  return [counts, lintPart, minutes(result.durationS)].filter(Boolean).join(" · ");
}

const TEST_STATUS = {
  passed: ":white_check_mark: *Pruebas OK*",
  failed: ":x: *Pruebas fallidas*",
  "build-failed": ":x: *No compila*",
  timeout: ":hourglass: *Pruebas detenidas*",
  error: ":warning: *No se pudieron correr las pruebas*",
};

/** Details of what went wrong, as plain items shared by the Slack reply and the GitHub comment. */
function testProblems(result) {
  const items = [];
  for (const f of result.tests?.failures ?? []) items.push({ where: f.test, text: f.message });
  for (const i of result.lint?.issues ?? []) items.push({ where: `${i.file}${i.line ? `:${i.line}` : ""}`, text: `lint ${i.id}: ${i.message}` });
  for (const e of result.compileErrors ?? []) items.push({ where: e.file ? `${e.file}${e.line ? `:${e.line}` : ""}` : null, text: e.message });
  if (result.status === "timeout") items.push({ where: null, text: "Gradle pasó del límite de tiempo sin terminar; revisa si una prueba se queda colgada." });
  return items;
}

/** The test run in the PR's Slack thread, posted by the monitor bot. */
export function testsText(result) {
  const pr = result.pr;
  const sha = pr.headSha ? ` · \`${pr.headSha.slice(0, 7)}\`` : "";
  const lines = [`${TEST_STATUS[result.status] ?? result.status} · ${prLink(pr)} de ${escape(result.app)}${sha} · ${testsHeadline(result)}`];
  const items = testProblems(result);
  for (const item of items.slice(0, MAX_TEST_ITEMS)) {
    lines.push(`• ${item.where ? `\`${escape(item.where)}\` · ` : ""}${escape(item.text)}`);
  }
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
 * tests. Plain URLs, because Send to Slack may escape angle brackets.
 */
export function prOpenedText({ pr, app, twin, esc = neutralize }) {
  const lines = [`:arrow_heading_up: *PR nuevo en ${esc(app)}* · #${pr.number}${pr.title ? ` · ${esc(truncate(pr.title, 120))}` : ""}`];
  lines.push(`${pr.url}${pr.headBranch ? ` · \`${esc(pr.headBranch)}\`` : ""}${pr.author ? ` · de ${esc(pr.author)}` : ""}`);
  if (twin?.pr) lines.push(`:link: Gemelo en ${twinLabel(twin.repo)}: ${twin.pr.url}`);
  else if (twin && twin.pr === null) lines.push(`:warning: ${twinMissing(twin, esc)}`);
  lines.push(":thread: Revisión y pruebas en el hilo.");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

function twinMissing(twin, esc) {
  return `Todavía no hay PR gemelo en ${esc(twin.repo)} con la rama \`${esc(twin.branch ?? "?")}\`. Si el cambio es de una sola plataforma, dilo en la descripción.`;
}

export function twinOpenedText({ pr, app }) {
  return `:link: Se abrió el gemelo en ${escape(app)}: ${prLink(pr)}${pr.title ? ` · _${escape(truncate(pr.title, 120))}_` : ""}. Su revisión y sus pruebas también van en este hilo.`;
}

export function twinMissingText(twin) {
  return `:warning: ${twinMissing(twin, escape)}`;
}

export function fixAckText({ requester, failure }) {
  return `:wrench: ${userMention(requester)}El *Corrector* toma esta falla de ${escape(failure.app)}: busca la causa en el código, la corrige en Android y en iOS y responde aquí con los PR.`;
}

export function fixerUnavailableText(reason) {
  return `:warning: No se pudo activar al Corrector: ${escape(reason)}`;
}

/** The Corrector's answer in the bug's thread. Linking the PRs here is what puts the bug in correction. */
export function fixResultText(result, prs) {
  const head = {
    "in-review": ":arrows_counterclockwise: *PR abiertos, en verificación*",
    fixed: ":hammer_and_wrench: *Corrección propuesta*",
    "no-change": ":information_source: *Sin cambios de código*",
    error: ":x: *No pude corregir esta falla*",
  }[result.status] ?? `*${escape(result.status)}*`;
  const lines = [head];
  if (result.summary) lines.push(escape(result.summary));
  for (const pr of prs) lines.push(`• ${prLink(pr)} · ${escape(pr.repo)}`);
  if (result.status === "in-review") {
    lines.push("_Corro las pruebas, pido la revisión y atiendo lo que pida; respondo aquí cuando termine._");
    return truncate(lines.join("\n"), MESSAGE_LIMIT);
  }
  if (result.checks) lines.push(`*Pruebas:* ${escape(result.checks)}`);
  if (result.review) lines.push(`*Revisión:* ${escape(result.review)}`);
  if (result.tested) lines.push(`*Qué se probó:* ${escape(result.tested)}`);
  if (result.notTested) lines.push(`*Qué no se probó:* ${escape(result.notTested)}`);
  if (result.pending) lines.push(`*Pendiente para una persona:* ${escape(result.pending)}`);
  if (prs.length) lines.push("_El merge lo hace una persona._");
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}
