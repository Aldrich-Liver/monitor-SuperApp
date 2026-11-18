const MAX_FRAMES = 12;

function formatFrame(f) {
  const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : "";
  const lib = f.library ? ` [${f.library}]` : "";
  return `${f.blamed ? "> " : "  "}${f.symbol ?? "?"}${where}${lib}`;
}

function pickTrace(event) {
  const exceptions = event.exceptions ?? [];
  const exception = exceptions.find((e) => e.blamed) ?? exceptions.at(-1);
  if (exception?.frames?.length) {
    return { title: exception.title, message: exception.exceptionMessage ?? exception.subtitle, frames: exception.frames };
  }
  const error = (event.errors ?? []).find((e) => e.blamed) ?? event.errors?.[0];
  if (error?.frames?.length) return { title: error.title, message: error.subtitle, frames: error.frames };
  const thread = (event.threads ?? []).find((t) => t.crashed || t.blamed);
  if (thread?.frames?.length) return { title: thread.title, message: thread.subtitle, frames: thread.frames };
  return null;
}

function buildRevision(buildStamp) {
  return buildStamp?.match(/revision:\s*"([0-9a-f]{7,40})"/)?.[1] ?? null;
}

/** Keeps the diagnostic parts of an event and drops user identifiers. */
export function summarizeEvent(event) {
  const trace = pickTrace(event);
  return {
    eventTime: event.eventTime,
    version: event.version?.displayName,
    buildRevision: buildRevision(event.buildStamp),
    device: event.device?.displayName,
    operatingSystem: event.operatingSystem?.displayName,
    processState: event.processState,
    blameFrame: event.blameFrame ? formatFrame({ ...event.blameFrame, blamed: false }).trim() : null,
    exception: trace ? { title: trace.title, message: trace.message } : null,
    frames: trace ? trace.frames.slice(0, MAX_FRAMES).map(formatFrame) : [],
    totalFrames: trace?.frames.length ?? 0,
    breadcrumbs: (event.breadcrumbs ?? []).slice(-5).map((b) => b.title),
  };
}
