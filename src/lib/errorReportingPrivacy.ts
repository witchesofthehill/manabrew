import { TransportItemType } from "@grafana/faro-web-sdk";
import type { BeforeSendHook, ExceptionStackFrame } from "@grafana/faro-web-sdk";
import { safeErrorDiagnostics } from "@/lib/errorReportingDiagnostics";
import { redactErrorText } from "@/lib/errorReportingRedaction";

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
export const MAX_STACK_FRAMES = 50;
export const MAX_ERROR_CAUSES = 5;
export const MAX_CAUSE_FRAMES = 20;
const MAX_CAUSE_CONTEXT_LENGTH = 16384;
const MAX_COMPONENT_FRAMES = 20;
export const ANONYMOUS_FUNCTION = "<anonymous>";
const STACK_LOCATIONS = {
  console: "app:///console",
  eval: "app:///eval",
  native: "app:///native",
  wasm: "app:///wasm",
  blob: "app:///blob",
  external: "app:///external",
  local: "app:///local",
} as const;

export function safeErrorName(name: unknown): string {
  return typeof name === "string" && Object.hasOwn(ERROR_NAMES, name) ? name : "Error";
}

export function safeErrorMessage(value: unknown): string {
  return typeof value === "string" ? redactErrorText(value) : "Non-Error rejection";
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

export function safeStackLocation(value: unknown): string | undefined {
  const asset = safeAssetUrl(value);
  if (asset) return asset;
  if (typeof value !== "string" || value.length > 2048) return undefined;
  if (Object.values(STACK_LOCATIONS).some((location) => location === value)) return value;
  if (/^(?:VM\d{1,9}|debugger eval code)$/.test(value) || value === ANONYMOUS_FUNCTION)
    return value;
  if (value === "eval") return STACK_LOCATIONS.eval;
  if (/^(?:native|\[native code\])$/.test(value)) return STACK_LOCATIONS.native;
  if (/^wasm:\/\//.test(value)) return STACK_LOCATIONS.wasm;
  if (/^blob:/.test(value)) return STACK_LOCATIONS.blob;
  if (/^(?:https?|tauri|asset):\/\//.test(value)) return STACK_LOCATIONS.external;
  if (/^(?:file:\/\/|\/|[A-Za-z]:\\)/.test(value)) return STACK_LOCATIONS.local;
  return undefined;
}

function safeStackFunction(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^(?:(?:async|new|bound|get|set) )?[\p{L}\p{N}_$.[\]<>-]+(?: \[as [\p{L}\p{N}_$.]+\])?$/u.test(
      value,
    )
  )
    return ANONYMOUS_FUNCTION;
  return redactErrorText(value);
}

export function safeFrames(frames: ExceptionStackFrame[] = []): ExceptionStackFrame[] {
  return frames.slice(0, MAX_STACK_FRAMES).flatMap((frame) => {
    const filename = safeStackLocation(frame.filename);
    if (!filename) return [];
    const wasmFunction =
      filename === STACK_LOCATIONS.wasm
        ? (frame.filename?.match(/wasm-function\[\d{1,9}\]/)?.[0] ??
          frame.function?.match(/^wasm-function\[\d{1,9}\]$/)?.[0])
        : undefined;
    const wasmOffset =
      filename === STACK_LOCATIONS.wasm
        ? frame.filename?.match(/:0x([0-9a-f]{1,8})$/i)?.[1]
        : undefined;
    const colno = frame.colno ?? (wasmOffset ? Number.parseInt(wasmOffset, 16) : undefined);
    return [
      {
        filename,
        function: wasmFunction ?? safeStackFunction(frame.function),
        ...(Number.isSafeInteger(frame.lineno) &&
        frame.lineno! > 0 &&
        frame.lineno! <= 1_000_000_000
          ? { lineno: frame.lineno }
          : {}),
        ...(Number.isSafeInteger(colno) && colno! > 0 && colno! <= 1_000_000_000 ? { colno } : {}),
      },
    ];
  });
}

export type ErrorCause = {
  parent: number;
  relation: "cause" | "aggregate";
  type: string;
  value: string;
  frames: ExceptionStackFrame[];
};

export function safeErrorCauses(value: unknown): ErrorCause[] {
  if (typeof value !== "string" || value.length > MAX_CAUSE_CONTEXT_LENGTH) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const causes: ErrorCause[] = [];
    let remainingFrames = MAX_CAUSE_FRAMES;
    for (const input of parsed.slice(0, MAX_ERROR_CAUSES)) {
      if (
        !input ||
        !Number.isSafeInteger(input.parent) ||
        input.parent < 0 ||
        input.parent > causes.length ||
        (input.relation !== "cause" && input.relation !== "aggregate") ||
        !Array.isArray(input.frames)
      )
        break;
      const frames = safeFrames(input.frames).slice(0, remainingFrames);
      remainingFrames -= frames.length;
      causes.push({
        parent: input.parent,
        relation: input.relation,
        type: safeErrorName(input.type),
        value: safeErrorMessage(input.value),
        frames,
      });
    }
    return causes;
  } catch {
    return [];
  }
}

export function safeComponentStack(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 8192)
    .split("\n")
    .slice(0, MAX_COMPONENT_FRAMES)
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
        ...safeErrorDiagnostics(input),
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
      const causes = safeErrorCauses(input.error_causes);
      if (causes.length) context.error_causes = JSON.stringify(causes);
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
