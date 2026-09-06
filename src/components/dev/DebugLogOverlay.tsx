/**
 * A small in-app log view, so testing an installer does not mean opening the
 * webview console. Staging only: this file lives on `khaliostr/staging-lan-iroh`
 * and nowhere else, so it never reaches a release build.
 *
 * It patches `console.*` once at module load to tee every line into a ring
 * buffer, then renders the last of them in a collapsible panel. The transport
 * lines (`[direct]`, `[webrtc]`, `[forge-host]`) are what this exists for, so
 * they are the default filter, but the toggle shows everything.
 */
import { useEffect, useRef, useState } from "react";

interface LogLine {
  seq: number;
  at: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
}

const RING = 400;
const TRANSPORT = /\[(direct|webrtc|forge-host|transport)/i;

const buffer: LogLine[] = [];
const listeners = new Set<() => void>();
let seq = 0;
let patched = false;

function push(level: LogLine["level"], args: unknown[]): void {
  const text = args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  buffer.push({ seq: (seq += 1), at: Date.now(), level, text });
  if (buffer.length > RING) buffer.splice(0, buffer.length - RING);
  listeners.forEach((fn) => fn());
}

function patchConsole(): void {
  if (patched) return;
  patched = true;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      original(...args);
    };
  });
}

const COLOR: Record<LogLine["level"], string> = {
  log: "var(--dbg-fg)",
  info: "#5eb0ef",
  warn: "#e0a03a",
  error: "#e0603a",
};

export function DebugLogOverlay() {
  patchConsole();
  const [open, setOpen] = useState(false);
  const [transportOnly, setTransportOnly] = useState(true);
  const [filter, setFilter] = useState("");
  const [tick, force] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  // Recomputed every render, which the `tick` state above forces on each new
  // log line. Cheap: the ring is bounded and this only mounts on staging.
  void tick;
  const needle = filter.trim().toLowerCase();
  const lines = buffer.filter((l) => {
    if (transportOnly && !TRANSPORT.test(l.text)) return false;
    if (needle && !l.text.toLowerCase().includes(needle)) return false;
    return true;
  });

  useEffect(() => {
    const el = scroller.current;
    if (open && el) el.scrollTop = el.scrollHeight;
  }, [open, lines.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Show logs"
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 2147483000,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(128,128,128,0.4)",
          background: "rgba(20,20,24,0.85)",
          color: "#ddd",
          font: "12px ui-monospace, monospace",
          cursor: "pointer",
        }}
      >
        logs {buffer.length ? `· ${buffer.length}` : ""}
      </button>
    );
  }

  return (
    <div
      style={
        {
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 2147483000,
          width: "min(560px, calc(100vw - 24px))",
          height: "min(360px, 55vh)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 10,
          border: "1px solid rgba(128,128,128,0.4)",
          background: "rgba(16,16,20,0.94)",
          color: "#ddd",
          "--dbg-fg": "#ddd",
          font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
          boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
        } as React.CSSProperties
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid rgba(128,128,128,0.25)",
        }}
      >
        <strong style={{ fontWeight: 600 }}>logs</strong>
        <button
          onClick={() => setTransportOnly((v) => !v)}
          style={chip(transportOnly)}
          title="Only transport lines"
        >
          transport
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          style={{
            flex: 1,
            minWidth: 0,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(128,128,128,0.3)",
            borderRadius: 6,
            color: "#ddd",
            padding: "3px 6px",
            font: "inherit",
          }}
        />
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(lines.map((l) => `${stamp(l.at)} ${l.text}`).join("\n"))
              .catch(() => {});
          }}
          style={chip(false)}
          title="Copy shown lines"
        >
          copy
        </button>
        <button
          onClick={() => {
            buffer.length = 0;
            force((n) => n + 1);
          }}
          style={chip(false)}
          title="Clear"
        >
          clear
        </button>
        <button onClick={() => setOpen(false)} style={chip(false)} title="Hide">
          ✕
        </button>
      </div>
      <div ref={scroller} style={{ flex: 1, overflow: "auto", padding: "6px 8px" }}>
        {lines.length === 0 ? (
          <div style={{ opacity: 0.5 }}>no lines yet</div>
        ) : (
          lines.map((l) => (
            <div key={l.seq} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ opacity: 0.45 }}>{stamp(l.at)} </span>
              <span style={{ color: COLOR[l.level] }}>{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "3px 7px",
    borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.3)",
    background: active ? "rgba(94,176,239,0.25)" : "rgba(0,0,0,0.25)",
    color: "#ddd",
    font: "inherit",
    cursor: "pointer",
  };
}

function stamp(at: number): string {
  const d = new Date(at);
  return (
    d.toLocaleTimeString(undefined, { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}
