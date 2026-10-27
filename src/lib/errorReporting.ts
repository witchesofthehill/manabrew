import { getStackFramesFromError, InternalLoggerLevel } from "@grafana/faro-web-sdk";
import type { Faro } from "@grafana/faro-web-sdk";
import { getClientPlatform } from "@/platform/clientPlatform";
import { ClientErrorsInstrumentation } from "@/lib/errorReportingInstrumentation";
import { createClientErrorTransport } from "@/lib/errorReportingTransport";
import {
  createPrivacyFilter,
  errorSignature,
  normalizedRoute,
  safeErrorMessage,
  safeErrorName,
  safeComponentStack,
  safeFrames,
  safeEngine,
} from "@/lib/errorReportingPrivacy";
import type { ClientErrorSource } from "@/lib/errorReportingPrivacy";

export type { ClientErrorSource } from "@/lib/errorReportingPrivacy";

type ErrorContext = { componentStack?: string; operation?: string };
const DUPLICATE_WINDOW_MS = 2000;
const MAX_RECENT_ERRORS = 100;
let faro: Faro | undefined;
let instrumentation: ClientErrorsInstrumentation | undefined;
let disposeTransport: (() => void) | undefined;
let initialized = false;
let engine = "none";
const reportedErrors = new WeakSet<Error>();
const recentStrings = new Map<string, number>();

function reportingConfig(): { collectorUrl: string; environment: string } | undefined {
  const runtime = window.__MANABREW_RUNTIME__?.observability;
  const enabled =
    runtime === undefined ? import.meta.env.VITE_FARO_ENABLED === "true" : runtime.enabled === true;
  if (!enabled) return undefined;
  const collector =
    runtime === undefined ? import.meta.env.VITE_FARO_COLLECTOR_URL : runtime.collectorUrl;
  const environment =
    runtime === undefined ? import.meta.env.VITE_FARO_ENVIRONMENT : runtime.environment;
  if (!collector || !environment || !["production", "staging", "development"].includes(environment))
    return undefined;
  const url = new URL(collector);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && local && environment === "development")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/collect"
  )
    return undefined;
  return { collectorUrl: url.href, environment };
}

export function initializeErrorReporting(): void {
  if (initialized) return;
  initialized = true;
  try {
    const config = reportingConfig();
    if (!config) return;
    const delivery = createClientErrorTransport(config.collectorUrl);
    disposeTransport = delivery.dispose;
    instrumentation = new ClientErrorsInstrumentation((error) =>
      reportClientError(error, "unhandled"),
    );
    faro = delivery.initialize({
      app: {
        name: "manabrew-client",
        version: __APP_VERSION__,
        release: __APP_BUILD_ID__,
        environment: config.environment,
      },
      instrumentations: [instrumentation],
      metas: [],
      sessionTracking: { enabled: false },
      preventGlobalExposure: true,
      isolate: true,
      dedupe: false,
      internalLoggerLevel: InternalLoggerLevel.OFF,
      batching: { enabled: true, itemLimit: 10, sendTimeout: 1000 },
      transports: [delivery.transport],
      beforeSend: createPrivacyFilter(config.environment),
    });
  } catch {
    disposeErrorReporting();
  }
}

export function reportClientError(
  error: unknown,
  source: ClientErrorSource,
  context?: ErrorContext,
): void {
  if (!faro) return;
  try {
    const isError = error instanceof Error;
    if (isError && reportedErrors.has(error)) return;
    if (isError) reportedErrors.add(error);
    const type = safeErrorName(isError ? error.name : "Error");
    const value = safeErrorMessage(isError ? error.message : error);
    const frames = isError ? safeFrames(getStackFramesFromError(error)) : [];
    if (!isError) {
      const signature = errorSignature(
        type,
        typeof error === "string" ? error.slice(0, 4096) : value,
        frames,
        source,
        context?.operation,
      );
      const now = Date.now();
      const previous = recentStrings.get(signature);
      if (previous !== undefined && now - previous < DUPLICATE_WINDOW_MS) return;
      if (recentStrings.size >= MAX_RECENT_ERRORS)
        recentStrings.delete(recentStrings.keys().next().value!);
      recentStrings.set(signature, now);
    }
    faro.api.pushError(new Error(value), {
      type,
      stackFrames: frames,
      skipDedupe: true,
      context: {
        engine,
        build: __APP_BUILD_ID__,
        version: __APP_VERSION__,
        platform: getClientPlatform(),
        build_target: __APP_BUILD_TARGET__,
        source,
        route: normalizedRoute(),
        ...(context?.componentStack
          ? { component_stack: safeComponentStack(context.componentStack) }
          : {}),
        ...(context?.operation ? { operation: context.operation } : {}),
      },
    });
  } catch {
    return;
  }
}

export function setErrorReportingEngine(value: string | null): void {
  engine = safeEngine(value);
}

function disposeErrorReporting(): void {
  faro?.pause();
  instrumentation?.destroy();
  disposeTransport?.();
  disposeTransport = undefined;
  faro = undefined;
  instrumentation = undefined;
  engine = "none";
  recentStrings.clear();
}

if (import.meta.hot) import.meta.hot.dispose(disposeErrorReporting);
