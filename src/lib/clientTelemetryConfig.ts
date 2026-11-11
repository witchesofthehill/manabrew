export function clientTelemetryConfig(): { collectorUrl: string; environment: string } | undefined {
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
