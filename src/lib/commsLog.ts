const MAX_ENTRIES = 500;
const MAX_PAYLOAD_CHARS = 4000;

export type CommsDirection = "send" | "recv" | "engine" | "bot-send" | "bot-recv";

interface CommsLogEntry {
  at: number;
  dir: CommsDirection;
  text: string;
}

const entries: CommsLogEntry[] = [];

/**
 * Records a message for the bug report. A string is kept as is, up to the cap;
 * an object is described, not serialised: a game state is hundreds of
 * kilobytes and arrives on every prompt, and stringifying it on the UI thread
 * to keep its first four kilobytes was a measurable slice of every frame's
 * handling. Callers that already hold the wire text pass that instead.
 */
export function logComms(dir: CommsDirection, payload: unknown): void {
  push(dir, typeof payload === "string" ? payload : describe(payload));
}

function push(dir: CommsDirection, text: string): void {
  if (text.length > MAX_PAYLOAD_CHARS) {
    text = `${text.slice(0, MAX_PAYLOAD_CHARS)}… (${text.length} chars total)`;
  }
  entries.push({ at: Date.now(), dir, text });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** One line from the fields that identify a message, read without walking it. */
function describe(payload: unknown): string {
  if (payload === null || typeof payload !== "object") return String(payload);
  const msg = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["type", "kind", "event", "reason", "from_player", "room_id"]) {
    const value = msg[key];
    if (typeof value === "string" || typeof value === "number") parts.push(`${key}=${value}`);
  }
  const state = (msg.state ?? msg) as Record<string, unknown>;
  if (state && typeof state === "object" && state !== msg) {
    const kind = state.kind;
    if (typeof kind === "string") parts.push(`state.kind=${kind}`);
  }
  const view = state?.gameView as Record<string, unknown> | undefined;
  if (view && typeof view === "object") {
    for (const key of ["turn", "phase", "activePlayerId", "priorityPlayerId"]) {
      const value = view[key];
      if (typeof value === "string" || typeof value === "number") parts.push(`${key}=${value}`);
    }
  }
  const prompt = (state?.prompt ?? msg.prompt) as Record<string, unknown> | undefined;
  if (prompt && typeof prompt === "object") {
    const input = prompt.input as Record<string, unknown> | undefined;
    parts.push(`prompt=${prompt.promptId ?? "?"}:${input?.type ?? "?"}`);
  }
  if (msg.error !== undefined) parts.push(`error=${safeJson(msg.error)}`);
  return parts.length ? `{${parts.join(" ")}}` : safeJson(payload);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const DIR_MARKERS: Record<CommsDirection, string> = {
  send: "→",
  recv: "←",
  engine: "⚙",
  "bot-send": "B→",
  "bot-recv": "B←",
};

export function formatCommsLog(): string {
  if (!entries.length) return "(no messages recorded)";
  return entries
    .map((entry) => `${new Date(entry.at).toISOString()} ${DIR_MARKERS[entry.dir]} ${entry.text}`)
    .join("\n");
}

if (typeof window !== "undefined") {
  (window as unknown as { __mbComms?: () => string }).__mbComms = formatCommsLog;
}
