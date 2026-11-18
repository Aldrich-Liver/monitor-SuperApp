const TZ = "America/Mexico_City";
const SECTION_LIMIT = 2900;

const TYPE_LABEL = {
  new_issue: "Issue nuevo",
  regressed: "Issue regresó",
};

const ERROR_TYPE_LABEL = {
  FATAL: "Crash (fatal)",
  NON_FATAL: "No fatal",
  ANR: "ANR",
};

/** Slack API escaping, for messages sent as Block Kit. */
export function escape(text = "") {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * For text handed to another tool that may or may not escape it: angle brackets are swapped
 * for look-alikes so `<init>` survives either way.
 */
export function neutralize(text = "") {
  return String(text).replace(/</g, "‹").replace(/>/g, "›");
}

function truncate(text, max = SECTION_LIMIT) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function localTime(iso) {
  if (!iso) return "-";
  return `${new Date(iso).toLocaleString("es-MX", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })} (hora CDMX)`;
}

function section(text) {
  return { type: "section", text: { type: "mrkdwn", text: truncate(text) } };
}

function issueMessage(f, analysis, esc) {
  const i = f.issue;
  const ev = f.sampleEvent;
  const label = TYPE_LABEL[f.type];
  const icon = i.errorType === "FATAL" ? ":rotating_light:" : f.type === "regressed" ? ":repeat:" : ":warning:";

  const blocks = [
    { type: "header", text: { type: "plain_text", text: truncate(`${label}: ${f.app} ${f.version}`, 150), emoji: true } },
    section(`${icon} *${esc(i.title)}*\n${esc(i.subtitle ?? "")}`),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Tipo*\n${ERROR_TYPE_LABEL[i.errorType] ?? i.errorType}` },
        { type: "mrkdwn", text: `*Usuarios / eventos*\n${i.impactedUsersCount} / ${i.eventsCount} (7 días, esta versión)` },
        { type: "mrkdwn", text: `*Visto por primera vez*\n${esc(i.firstSeenVersion ?? "-")}` },
        { type: "mrkdwn", text: `*Estado*\n${esc(i.state ?? "-")}` },
      ],
    },
  ];

  if (ev) {
    const trace = [ev.exception ? `${ev.exception.title}: ${ev.exception.message ?? ""}` : "", ...ev.frames]
      .filter(Boolean)
      .join("\n");
    if (trace) blocks.push(section(`*Stack trace (muestra)*\n\`\`\`${esc(truncate(trace, 2700))}\`\`\``));
    const context = [ev.device, ev.operatingSystem, ev.processState, localTime(ev.eventTime)];
    if (ev.buildRevision) context.push(`commit ${ev.buildRevision.slice(0, 10)}`);
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: esc(context.filter(Boolean).join(" · ")) }] });
  }

  if (analysis) blocks.push(section(`:mag: *Análisis*\n${esc(analysis)}`));

  if (i.uri) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Abrir en Crashlytics" }, url: i.uri }],
    });
  }

  return { text: `${label} en ${f.app} ${f.version}: ${i.title}`, blocks };
}

function newVersionMessage(f, analysis, esc) {
  const m = f.metrics ?? {};
  const crashFree = m.crashFreeUsersPercentage != null ? `${Number(m.crashFreeUsersPercentage).toFixed(1)}%` : "-";
  const lines = [
    `:package: *Nueva versión detectada en ${esc(f.app)}*: ${esc(f.version)} (antes ${esc(f.previousVersion)})`,
    `Usuarios: ${m.totalUsersCount ?? 0} · Eventos: ${m.eventsCount ?? 0} · Usuarios sin fallas: ${crashFree}`,
    "A partir de ahora se vigila esta versión.",
  ];
  if (analysis) lines.push(`\n${esc(analysis)}`);
  return { text: `Nueva versión ${f.version} en ${f.app}`, blocks: [section(lines.join("\n"))] };
}

function baselineMessage(baselines, apps, esc) {
  const lines = [":white_check_mark: *Monitor de Crashlytics activo*"];
  for (const b of baselines) {
    const status = apps.find((a) => a.app === b.app);
    lines.push(
      b.version
        ? `• *${esc(b.app)}* ${esc(b.version)}: ${b.issueCount} issues existentes registrados como conocidos`
        : `• *${esc(b.app)}*: ${esc(status?.status ?? "sin datos")}`
    );
  }
  lines.push("Desde ahora aviso de cada issue nuevo o que regrese en la última versión, sin importar su gravedad.");
  return { text: "Monitor de Crashlytics activo", blocks: [section(lines.join("\n"))] };
}

function errorMessage(f, esc) {
  return {
    text: "El monitor de Crashlytics no pudo revisar",
    blocks: [section(`:x: *El monitor de Crashlytics no pudo revisar*\n\`\`\`${esc(f.message)}\`\`\``)],
  };
}

export function buildMessages(result, analysis = {}, { esc = escape } = {}) {
  const messages = [];
  const baselines = result.findings.filter((f) => f.type === "baseline");
  if (baselines.length) messages.push(baselineMessage(baselines, result.apps, esc));
  for (const f of result.findings) {
    if (f.type === "new_issue" || f.type === "regressed") messages.push(issueMessage(f, analysis[f.key], esc));
    else if (f.type === "new_version") messages.push(newVersionMessage(f, analysis[`new_version:${f.appId}`], esc));
    else if (f.type === "error") messages.push(errorMessage(f, esc));
  }
  return messages;
}

/** Flattens a Block Kit message into a single Slack mrkdwn string. */
export function toText(message) {
  const parts = [];
  for (const b of message.blocks) {
    if (b.type === "header") parts.push(`*${b.text.text}*`);
    else if (b.type === "section" && b.text) parts.push(b.text.text);
    else if (b.type === "section" && b.fields) parts.push(b.fields.map((f) => f.text.replace("\n", ": ")).join("\n"));
    else if (b.type === "context") parts.push(b.elements.map((e) => `_${e.text}_`).join(" "));
    else if (b.type === "actions") parts.push(b.elements.map((e) => `${e.text.text}: ${e.url}`).join("\n"));
  }
  return parts.join("\n\n");
}
