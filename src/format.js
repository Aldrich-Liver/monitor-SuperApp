const TZ = "America/Mexico_City";
const MESSAGE_LIMIT = 3500;
const MAX_LISTED = 10;
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

function clock(iso, reference) {
  const time = new Date(iso).toLocaleTimeString("es-MX", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const day = (d) => new Date(d).toLocaleDateString("es-MX", { timeZone: TZ, day: "numeric", month: "short" });
  return reference && day(iso) !== day(reference) ? `el ${day(iso)} a las ${time}` : time;
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

/** `ref` is how the monitor bot finds this message in the channel when Cursor posts it. */
export function summaryText(result, failures, { esc = escape, ref } = {}) {
  const window = result.previousCheckAt
    ? `entre ${clock(result.previousCheckAt, result.checkedAt)} y ${clock(result.checkedAt)} (hora CDMX)`
    : `hasta ${clock(result.checkedAt)} (hora CDMX)`;
  const totalEvents = failures.reduce((n, f) => n + f.newEvents, 0);
  const lines = [
    `:rotating_light: *${plural(failures.length, "falla", "fallas")} en Crashlytics* · ${plural(totalEvents, "evento nuevo", "eventos nuevos")} ${window}`,
  ];
  if (result.test) lines.unshift(":test_tube: *PRUEBA del monitor*: falla real, pero este mensaje no es una alerta nueva.");
  for (const f of failures.slice(0, MAX_LISTED)) {
    lines.push(
      `• *${esc(f.app)} ${esc(f.version)}* · ${ERROR_TYPE_LABEL[f.issue.errorType] ?? f.issue.errorType} · ` +
        `\`${esc(shortTitle(f.issue.title))}\` · ${plural(f.newEvents, "evento", "eventos")} · ${sinceLabel(f)}`
    );
  }
  if (failures.length > MAX_LISTED) lines.push(`_y ${plural(failures.length - MAX_LISTED, "falla más", "fallas más")}_`);
  lines.push(`:thread: Detalle y solución propuesta en el hilo.${ref ? ` · Ref. ${ref}` : ""}`);
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function handoffText({ count, analyzed, mention }) {
  const who = mention ? mention : "*Analista Crashlytics*";
  const scope = analyzed < count ? `las ${analyzed} fallas con más eventos` : plural(count, "falla", "fallas");
  return `:mag: ${who}, revisa ${scope} contra el código del release y responde en este hilo con el detalle y una solución propuesta.`;
}

export function analystUnavailableText(reason) {
  return `:warning: No se pudo activar al Analista Crashlytics: ${escape(reason)}`;
}

export function detailText(d, analysis, index, total) {
  const ev = d.sampleEvent;
  const lines = [
    `*${index}/${total} · ${escape(d.app)} ${escape(d.version)}* · ${ERROR_TYPE_LABEL[d.issue.errorType] ?? d.issue.errorType}`,
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
  return truncate(lines.join("\n"), MESSAGE_LIMIT);
}

export function errorText(message, { esc = escape } = {}) {
  return `:x: *El monitor de Crashlytics no pudo revisar*\n\`\`\`${esc(truncate(message, 2500))}\`\`\``;
}

export function threadHeaderText(ref) {
  return `:thread: Detalle de la alerta de Crashlytics Ref. ${ref}`;
}
