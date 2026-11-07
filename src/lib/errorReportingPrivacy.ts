import { TransportItemType } from "@grafana/faro-web-sdk";
import type { BeforeSendHook, ExceptionStackFrame } from "@grafana/faro-web-sdk";

export const CLIENT_ERROR_SOURCES = [
  "startup",
  "react",
  "unhandled",
  "engine-worker",
  "render-worker",
  "bot-worker",
  "remote-engine",
  "engine-operation",
] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

const ERROR_NAMES: Record<string, true> = {
  Error: true,
  TypeError: true,
  RangeError: true,
  ReferenceError: true,
  SyntaxError: true,
  URIError: true,
  EvalError: true,
  AggregateError: true,
  RuntimeError: true,
  CompileError: true,
  LinkError: true,
  AbortError: true,
  NetworkError: true,
  SecurityError: true,
  InvalidStateError: true,
};
const ENGINES: Record<string, true> = {
  "forge-wasm": true,
  "forge-desktop": true,
  "forge-hosted": true,
  "forge-remote": true,
  manabrew: true,
  ironsmith: true,
  "manual-tabletop": true,
  none: true,
};
export const OPERATIONS: Record<string, true> = {
  initialize: true,
  "query-worker": true,
  rewind: true,
  "start-game": true,
  "seat-reader": true,
  "engine-crash": true,
};
export const ROUTES: Record<string, true> = {
  play: true,
  lobby: true,
  search: true,
  "deck-editor": true,
  mycollection: true,
  hub: true,
  game: true,
  draft: true,
  limited: true,
  companion: true,
  sealed: true,
  winston: true,
  gauntlet: true,
  auth: true,
  settings: true,
  about: true,
  "card-mock": true,
  "design-system": true,
};
const SAFE_MESSAGES: Record<string, true> = {
  "Non-Error rejection": true,
  "Cannot access properties of null or undefined": true,
  "Network request failed": true,
  "Module loading failed": true,
  "Maximum call stack size exceeded": true,
  "WebAssembly runtime failure": true,
  "Client operation failed": true,
};
const MAX_FRAMES = 20;

export function safeErrorName(name: unknown): string {
  return typeof name === "string" && Object.hasOwn(ERROR_NAMES, name) ? name : "Error";
}

export function safeErrorMessage(value: unknown): string {
  if (typeof value !== "string") return "Non-Error rejection";
  const message = value.slice(0, 2048);
  if (Object.hasOwn(SAFE_MESSAGES, message)) return message;
  if (/^(?:Cannot read|Cannot set) properties of (?:undefined|null)/.test(message)) {
    return "Cannot access properties of null or undefined";
  }
  if (
    /^(?:Failed to fetch$|NetworkError when attempting to fetch resource|Load failed\b)/.test(
      message,
    )
  ) {
    return "Network request failed";
  }
  if (
    /^(?:Failed to fetch dynamically imported module|Importing a module script failed)/.test(
      message,
    )
  ) {
    return "Module loading failed";
  }
  if (/^(?:Maximum call stack size exceeded|too much recursion)$/.test(message)) {
    return "Maximum call stack size exceeded";
  }
  if (/^(?:unreachable|memory access out of bounds|out of bounds memory access)$/.test(message)) {
    return "WebAssembly runtime failure";
  }
  return "Client operation failed";
}

export function safeAssetUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const path = new URL(value, "https://invalid.local").pathname;
    if (path.length > 200 || path.includes("..")) return undefined;
    const match = path.match(
      /^\/assets\/((?:[\w.-]+-[\w-]{8,64}\.m?js|card-glint-[\w-]{8,64}\/index\.js))$/,
    );
    return match ? `app:///assets/${match[1]}` : undefined;
  } catch {
    return undefined;
  }
}

export function safeFrames(frames: ExceptionStackFrame[] = []): ExceptionStackFrame[] {
  return frames.slice(0, MAX_FRAMES).flatMap((frame) => {
    const filename = safeAssetUrl(frame.filename);
    if (!filename) return [];
    return [
      {
        filename,
        function: "?",
        ...(Number.isSafeInteger(frame.lineno) && frame.lineno! > 0
          ? { lineno: frame.lineno }
          : {}),
        ...(Number.isSafeInteger(frame.colno) && frame.colno! > 0 ? { colno: frame.colno } : {}),
      },
    ];
  });
}

export function safeComponentStack(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 8192)
    .split("\n")
    .slice(0, MAX_FRAMES)
    .flatMap((line) => {
      const location = line.match(
        /((?:https?:\/\/|tauri:\/\/|asset:\/\/|app:\/\/\/)[^\s)]+):(\d{1,9}):(\d{1,9})(?:\)|$)/,
      );
      const filename = location && safeAssetUrl(location[1]);
      return filename ? [`at component (${filename}:${location![2]}:${location![3]})`] : [];
    })
    .join("\n");
}

export function normalizedRoute(): string {
  const segment = window.location.pathname.split("/")[1];
  if (!segment) return "/";
  return Object.hasOwn(ROUTES, segment) ? `/${segment}/*` : "/other";
}

export function safeEngine(value: unknown): string {
  return typeof value === "string" && Object.hasOwn(ENGINES, value) ? value : "none";
}

export function errorSignature(
  type: string,
  message: string,
  frames: ExceptionStackFrame[],
  source: ClientErrorSource,
  operation = "",
): string {
  const stable = `${source}|${operation}|${type}|${message}|${frames.map((frame) => `${frame.filename}:${frame.lineno}:${frame.colno}`).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index++) {
    hash = Math.imul(hash ^ stable.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createPrivacyFilter(environment: string): BeforeSendHook {
  return (item) => {
    try {
      if (item.type !== TransportItemType.EXCEPTION) return null;
      const payload = item.payload as {
        type?: unknown;
        value?: unknown;
        context?: Record<string, unknown>;
        stacktrace?: { frames?: ExceptionStackFrame[] };
      };
      const input = payload.context ?? {};
      const source = CLIENT_ERROR_SOURCES.find((candidate) => candidate === input.source);
      if (!source) return null;
      const operation =
        typeof input.operation === "string" && Object.hasOwn(OPERATIONS, input.operation)
          ? input.operation
          : "";
      const frames = safeFrames(payload.stacktrace?.frames);
      const type = safeErrorName(payload.type);
      const value = safeErrorMessage(payload.value);
      const context: Record<string, string> = {
        engine: safeEngine(input.engine),
        build: __APP_BUILD_ID__,
        version: __APP_VERSION__,
        platform:
          typeof input.platform === "string" &&
          ["web", "pwa", "desktop", "mobile"].includes(input.platform)
            ? input.platform
            : "web",
        build_target: __APP_BUILD_TARGET__,
        source,
        route:
          typeof input.route === "string" &&
          (input.route === "/" ||
            input.route === "/other" ||
            (input.route.endsWith("/*") && Object.hasOwn(ROUTES, input.route.slice(1, -2))))
            ? input.route
            : "/other",
        signature: errorSignature(type, value, frames, source, operation),
      };
      const componentStack = safeComponentStack(input.component_stack);
      if (componentStack) context.component_stack = componentStack;
      if (operation) context.operation = operation;
      return {
        type: TransportItemType.EXCEPTION,
        payload: {
          type,
          value,
          timestamp: new Date().toISOString(),
          stacktrace: { frames },
          context,
        },
        meta: {
          app: {
            name: "manabrew-client",
            version: __APP_VERSION__,
            release: __APP_BUILD_ID__,
            environment,
          },
        },
      };
    } catch {
      return null;
    }
  };
}
