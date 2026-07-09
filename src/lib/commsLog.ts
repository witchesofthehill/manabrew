const MAX_ENTRIES = 500;
const MAX_PAYLOAD_CHARS = 4000;

export type CommsDirection = "send" | "recv" | "engine" | "bot-send" | "bot-recv";

interface CommsLogEntry {
  at: number;
  dir: CommsDirection;
  text: string;
}

const entries: CommsLogEntry[] = [];

export function logComms(dir: CommsDirection, payload: unknown): void {
  let text: string;
  try {
    text = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    text = String(payload);
  }
  if (text.length > MAX_PAYLOAD_CHARS) {
    text = `${text.slice(0, MAX_PAYLOAD_CHARS)}… (${text.length} chars total)`;
  }
  entries.push({ at: Date.now(), dir, text });
  if (entries.length > MAX_ENTRIES) entries.shift();
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
