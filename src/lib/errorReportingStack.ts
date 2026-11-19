import { getStackFramesFromError } from "@grafana/faro-web-sdk";
import type { ExceptionStackFrame } from "@grafana/faro-web-sdk";
import {
  MAX_CAUSE_FRAMES,
  MAX_ERROR_CAUSES,
  MAX_STACK_FRAMES,
  safeErrorMessage,
  safeErrorName,
  safeFrames,
} from "@/lib/errorReportingPrivacy";
import type { ErrorCause } from "@/lib/errorReportingPrivacy";

export function errorStackFrames(error: Error): ExceptionStackFrame[] {
  try {
    let frames = getStackFramesFromError(error);
    if (typeof error.stack === "string" && error.stack.includes("@debugger eval code:")) {
      frames = [];
      for (const line of error.stack.split("\n").slice(0, MAX_STACK_FRAMES + 1)) {
        const location = line.match(/@debugger eval code:(\d{1,9})(?::(\d{1,9}))?$/);
        if (location)
          frames.push({
            filename: "debugger eval code",
            function: "?",
            lineno: Number(location[1]),
            ...(location[2] ? { colno: Number(location[2]) } : {}),
          });
        else frames.push(...getStackFramesFromError({ message: "", stack: line } as Error));
      }
    }
    return safeFrames(frames);
  } catch {
    return [];
  }
}

export function errorCauses(error: unknown): string | undefined {
  const causes: ErrorCause[] = [];
  const pending: { error: unknown; parent: number; relation: ErrorCause["relation"] }[] = [];
  const seen = new Set<unknown>([error]);
  let remainingFrames = MAX_CAUSE_FRAMES;
  const append = (error: unknown, parent: number) => {
    if (!(error instanceof Error)) return;
    try {
      if (error.cause !== undefined)
        pending.push({ error: error.cause, parent, relation: "cause" });
      if (error instanceof AggregateError) {
        for (const child of error.errors.slice(0, MAX_ERROR_CAUSES))
          pending.push({ error: child, parent, relation: "aggregate" });
      }
    } catch {
      return;
    }
  };
  append(error, 0);
  for (let index = 0; index < pending.length && causes.length < MAX_ERROR_CAUSES; index++) {
    const item = pending[index];
    if (seen.has(item.error)) continue;
    seen.add(item.error);
    const cause = item.error;
    const isError = cause instanceof Error;
    try {
      const frames = isError ? errorStackFrames(cause).slice(0, remainingFrames) : [];
      remainingFrames -= frames.length;
      causes.push({
        parent: item.parent,
        relation: item.relation,
        type: safeErrorName(isError ? cause.name : undefined),
        value: safeErrorMessage(isError ? cause.message : cause),
        frames,
      });
      append(cause, causes.length);
    } catch {
      continue;
    }
  }
  return causes.length ? JSON.stringify(causes) : undefined;
}
