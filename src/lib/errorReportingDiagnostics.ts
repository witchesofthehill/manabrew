const BOOLEAN_VALUES = ["true", "false"];
const DIAGNOSTIC_SCHEMA: Record<string, readonly string[] | RegExp> = {
  diagnostic_browser: [
    "chrome",
    "chromium",
    "edge",
    "firefox",
    "safari",
    "opera",
    "samsung-internet",
  ],
  diagnostic_browser_major: /^[1-9]\d{0,2}$/,
  diagnostic_os: ["windows", "macos", "ios", "android", "linux", "chromeos"],
  diagnostic_network: ["online", "offline"],
  diagnostic_connection: ["slow-2g", "2g", "3g", "4g"],
  diagnostic_visibility: ["visible", "hidden", "prerender"],
  diagnostic_viewport: ["under-640", "640-1023", "1024-1439", "1440-plus"],
  diagnostic_orientation: ["portrait", "landscape"],
  diagnostic_page_uptime: ["under-10s", "10s-1m", "1m-10m", "10m-1h", "1h-plus"],
  diagnostic_cross_origin_isolated: BOOLEAN_VALUES,
  diagnostic_secure_context: BOOLEAN_VALUES,
  diagnostic_service_worker_controlled: BOOLEAN_VALUES,
};
const BROWSER_PATTERNS = [
  ["edge", /(?:Edg|EdgA|EdgiOS)\/(\d+)(?=[.\s]|$)/],
  ["opera", /(?:OPR|OPiOS)\/(\d+)(?=[.\s]|$)/],
  ["samsung-internet", /SamsungBrowser\/(\d+)(?=[.\s]|$)/],
  ["firefox", /(?:Firefox|FxiOS)\/(\d+)(?=[.\s]|$)/],
  ["chromium", /Chromium\/(\d+)(?=[.\s]|$)/],
  ["chrome", /(?:Chrome|CriOS)\/(\d+)(?=[.\s]|$)/],
  ["safari", /Version\/(\d+)(?=[.\s]|$)[^\n]*Safari\//],
] as const;

function readDiagnostic<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function safeErrorDiagnostics(value: unknown): Record<string, string> {
  const diagnostics: Record<string, string> = {};
  if (
    typeof value !== "object" ||
    value === null ||
    readDiagnostic(() => Array.isArray(value)) !== false
  )
    return diagnostics;
  for (const [key, allowed] of Object.entries(DIAGNOSTIC_SCHEMA)) {
    const candidate = readDiagnostic(() =>
      Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined,
    );
    if (
      typeof candidate === "string" &&
      (allowed instanceof RegExp
        ? allowed.exec(candidate)?.[0] === candidate
        : allowed.includes(candidate))
    )
      diagnostics[key] = candidate;
  }
  return diagnostics;
}

export function collectErrorDiagnostics(): Record<string, string> {
  const diagnostics: Record<string, unknown> = {};
  const userAgent = readDiagnostic(() => navigator.userAgent);
  if (typeof userAgent === "string") {
    const ua = userAgent.slice(0, 4096);
    for (const [browser, pattern] of BROWSER_PATTERNS) {
      const match = ua.match(pattern);
      if (match) {
        diagnostics.diagnostic_browser = browser;
        diagnostics.diagnostic_browser_major = match[1];
        break;
      }
    }
    diagnostics.diagnostic_os = /Android/.test(ua)
      ? "android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "ios"
        : /CrOS/.test(ua)
          ? "chromeos"
          : /Windows/.test(ua)
            ? "windows"
            : /Macintosh|Mac OS X/.test(ua)
              ? "macos"
              : /Linux/.test(ua)
                ? "linux"
                : undefined;
  }
  const online = readDiagnostic(() => navigator.onLine);
  diagnostics.diagnostic_network =
    typeof online === "boolean" ? (online ? "online" : "offline") : undefined;
  diagnostics.diagnostic_connection = readDiagnostic(
    () =>
      (navigator as Navigator & { connection?: { effectiveType?: unknown } }).connection
        ?.effectiveType,
  );
  diagnostics.diagnostic_visibility = readDiagnostic(() => document.visibilityState);
  const width = readDiagnostic(() => window.innerWidth);
  const height = readDiagnostic(() => window.innerHeight);
  if (typeof width === "number" && Number.isFinite(width) && width > 0) {
    diagnostics.diagnostic_viewport =
      width < 640
        ? "under-640"
        : width < 1024
          ? "640-1023"
          : width < 1440
            ? "1024-1439"
            : "1440-plus";
    if (typeof height === "number" && Number.isFinite(height) && height > 0)
      diagnostics.diagnostic_orientation = width > height ? "landscape" : "portrait";
  }
  const uptime = readDiagnostic(() => performance.now());
  if (typeof uptime === "number" && Number.isFinite(uptime) && uptime >= 0)
    diagnostics.diagnostic_page_uptime =
      uptime < 10_000
        ? "under-10s"
        : uptime < 60_000
          ? "10s-1m"
          : uptime < 600_000
            ? "1m-10m"
            : uptime < 3_600_000
              ? "10m-1h"
              : "1h-plus";
  const isolated = readDiagnostic(() => window.crossOriginIsolated);
  if (typeof isolated === "boolean")
    diagnostics.diagnostic_cross_origin_isolated = String(isolated);
  const secure = readDiagnostic(() => window.isSecureContext);
  if (typeof secure === "boolean") diagnostics.diagnostic_secure_context = String(secure);
  const controller = readDiagnostic(() => navigator.serviceWorker?.controller);
  if (controller !== undefined)
    diagnostics.diagnostic_service_worker_controlled = controller === null ? "false" : "true";
  return safeErrorDiagnostics(diagnostics);
}
