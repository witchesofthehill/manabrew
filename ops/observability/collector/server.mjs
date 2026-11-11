import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ANONYMOUS_FUNCTION,
  CLIENT_ERROR_SOURCES,
  MAX_STACK_FRAMES,
  OPERATIONS,
  ROUTES,
  errorSignature,
  safeStackLocation,
  safeComponentStack,
  safeEngine,
  safeErrorMessage,
  safeErrorName,
  safeErrorCauses,
  safeFrames,
} from "../../../src/lib/errorReportingPrivacy.ts";
import { safeErrorDiagnostics } from "../../../src/lib/errorReportingDiagnostics.ts";
import {
  CLIENT_ANALYTICS_DOMAIN,
  safeClientAnalyticsEvent,
} from "../../../src/lib/clientAnalyticsPrivacy.ts";
import { SourceMaps } from "./sourcemaps.mjs";
import { ClientFunnel } from "./client-funnel.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const DAILY_BYTES = Number(process.env.FARO_DAILY_BYTES ?? 10 * 1024 * 1024);
const ANALYTICS_DAILY_BYTES = Number(process.env.FARO_ANALYTICS_DAILY_BYTES ?? 10 * 1024 * 1024);
const SIGNATURE_DAILY_BYTES = Number(
  process.env.FARO_SIGNATURE_DAILY_BYTES ?? Math.floor(DAILY_BYTES / 20),
);
const MAX_INFLIGHT = 4;
const origins = new Set((process.env.FARO_ORIGINS ?? "").split(",").filter(Boolean));
const loki = process.env.LOKI_URL ?? "http://loki:3100";
const stateDirectory = process.env.FARO_STATE_DIR ?? "/var/lib/faro/state";
const stateFile = path.join(stateDirectory, "budget.json");
const analyticsStateFile = path.join(stateDirectory, "analytics-budget.json");
const maps = new SourceMaps(process.env.FARO_MAPS_DIR ?? "/var/lib/faro/sourcemaps");
const releasePattern =
  /^([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)-[a-f0-9]{40}-([a-z][a-z0-9-]{0,63})$/;
const counters = {
  accepted: 0,
  rejected: 0,
  export_errors: 0,
  mapped_frames: 0,
  unmapped_frames: 0,
  signature_capped: 0,
  rate_limited: 0,
  concurrency_limited: 0,
  budget_limited: 0,
};
let signatureBytes = { day: "", bytes: new Map() };
const analyticsCounters = {
  accepted: 0,
  rejected: 0,
  export_errors: 0,
  funnel_errors: 0,
  rate_limited: 0,
  concurrency_limited: 0,
  budget_limited: 0,
};
const errorPool = { inflight: 0, tokens: 40, lastRefill: performance.now() };
const analyticsPool = { inflight: 0, tokens: 40, lastRefill: performance.now() };
let lokiReady = false;
let lastTimestamp = 0n;
let clientFunnel;
if (
  !origins.size ||
  !Number.isSafeInteger(DAILY_BYTES) ||
  DAILY_BYTES <= 0 ||
  !Number.isSafeInteger(ANALYTICS_DAILY_BYTES) ||
  ANALYTICS_DAILY_BYTES <= 0 ||
  !Number.isSafeInteger(SIGNATURE_DAILY_BYTES) ||
  SIGNATURE_DAILY_BYTES <= 0
)
  throw new Error("Invalid collector configuration");
mkdirSync(stateDirectory, { recursive: true });
for (const file of [
  stateFile,
  analyticsStateFile,
  `${stateFile}.tmp`,
  `${analyticsStateFile}.tmp`,
]) {
  if (existsSync(file)) chmodSync(file, 0o600);
}
let budget = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8"))
  : { day: "", bytes: 0 };
if (typeof budget.day !== "string" || !Number.isSafeInteger(budget.bytes) || budget.bytes < 0)
  throw new Error("Invalid collector budget state");
let analyticsBudget = existsSync(analyticsStateFile)
  ? JSON.parse(readFileSync(analyticsStateFile, "utf8"))
  : { day: "", bytes: 0 };
if (
  typeof analyticsBudget.day !== "string" ||
  !Number.isSafeInteger(analyticsBudget.bytes) ||
  analyticsBudget.bytes < 0
)
  throw new Error("Invalid analytics budget state");
try {
  clientFunnel = new ClientFunnel(stateDirectory);
} catch {
  analyticsCounters.funnel_errors++;
}

function currentBudget() {
  const day = new Date().toISOString().slice(0, 10);
  if (budget.day !== day) budget = { day, bytes: 0 };
  return budget;
}

function reserve(bytes) {
  const current = currentBudget();
  if (current.bytes + bytes > DAILY_BYTES) return false;
  const next = { day: current.day, bytes: current.bytes + bytes };
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
  renameSync(`${stateFile}.tmp`, stateFile);
  budget = next;
  return true;
}

function currentAnalyticsBudget() {
  const day = new Date().toISOString().slice(0, 10);
  if (analyticsBudget.day !== day) analyticsBudget = { day, bytes: 0 };
  return analyticsBudget;
}

function reserveAnalytics(bytes) {
  const current = currentAnalyticsBudget();
  if (current.bytes + bytes > ANALYTICS_DAILY_BYTES) return false;
  const next = { day: current.day, bytes: current.bytes + bytes };
  writeFileSync(`${analyticsStateFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
  renameSync(`${analyticsStateFile}.tmp`, analyticsStateFile);
  analyticsBudget = next;
  return true;
}

function acquire(pool, metrics) {
  const now = performance.now();
  pool.tokens = Math.min(40, pool.tokens + ((now - pool.lastRefill) * 20) / 1000);
  pool.lastRefill = now;
  if (pool.tokens < 1) {
    metrics.rate_limited++;
    reject(429);
  }
  if (pool.inflight >= MAX_INFLIGHT) {
    metrics.concurrency_limited++;
    reject(429);
  }
  pool.tokens--;
  pool.inflight++;
}

function signatureUsage() {
  const day = currentBudget().day;
  if (signatureBytes.day !== day) signatureBytes = { day, bytes: new Map() };
  return signatureBytes.bytes;
}

function reject(status) {
  throw Object.assign(new Error("Collector request rejected"), { status });
}

function sanitizeApp(body) {
  const app = body?.meta?.app;
  const release =
    typeof app?.release === "string" &&
    app.release.length <= 200 &&
    app.release.match(releasePattern);
  if (
    app?.name !== "manabrew-client" ||
    !release ||
    app.version !== release[1] ||
    !["production", "staging", "development"].includes(app.environment)
  )
    reject(400);
  return { app, release };
}

function sanitizeEvents(body) {
  const { app, release } = sanitizeApp(body);
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 10) reject(400);
  return body.events.map((input) => {
    if (input?.domain !== CLIENT_ANALYTICS_DOMAIN) reject(400);
    const event = safeClientAnalyticsEvent(input.name, input.attributes);
    if (!event) reject(400);
    const { platform, relay_username, ...attributes } = event.attributes;
    if (!["web", "pwa", "desktop", "mobile"].includes(platform)) reject(400);
    return {
      kind: "event",
      event_name: event.name,
      ...Object.fromEntries(
        Object.entries(attributes).map(([key, value]) => [`event_${key}`, value]),
      ),
      context_platform: platform,
      ...(relay_username ? { context_user_id: relay_username } : {}),
      app_name: "manabrew-client",
      app_version: release[1],
      app_release: app.release,
      app_environment: app.environment,
    };
  });
}

function sanitize(body) {
  const { app, release } = sanitizeApp(body);
  if (!Array.isArray(body.exceptions) || body.exceptions.length < 1 || body.exceptions.length > 10)
    reject(400);
  return body.exceptions.map((exception) => {
    const input = exception?.context;
    if (!CLIENT_ERROR_SOURCES.includes(input?.source)) reject(400);
    const incoming = exception.stacktrace?.frames ?? [];
    if (
      !Array.isArray(incoming) ||
      incoming.length > MAX_STACK_FRAMES ||
      incoming.some(
        (frame) =>
          !frame ||
          frame.filename !== safeStackLocation(frame.filename) ||
          [frame.lineno, frame.colno].some(
            (value) =>
              value !== undefined &&
              (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000),
          ),
      )
    )
      reject(400);
    const frames = safeFrames(incoming);
    const type = safeErrorName(exception.type);
    const value = safeErrorMessage(exception.value);
    const operation =
      typeof input.operation === "string" && Object.hasOwn(OPERATIONS, input.operation)
        ? input.operation
        : "";
    const route =
      input.route === "/" ||
      input.route === "/other" ||
      (typeof input.route === "string" &&
        input.route.endsWith("/*") &&
        Object.hasOwn(ROUTES, input.route.slice(1, -2)))
        ? input.route
        : "/other";
    return {
      frames,
      causes: safeErrorCauses(input.error_causes),
      record: {
        kind: "exception",
        type,
        value,
        ...safeErrorDiagnostics(input),
        app_name: "manabrew-client",
        app_version: release[1],
        app_release: app.release,
        app_environment: app.environment,
        context_build: app.release,
        context_version: release[1],
        context_build_target: release[2],
        context_source: input.source,
        context_engine: safeEngine(input.engine),
        context_route: route,
        context_platform: ["web", "pwa", "desktop", "mobile"].includes(input.platform)
          ? input.platform
          : "web",
        context_signature: errorSignature(type, value, frames, input.source, operation),
        ...(operation ? { context_operation: operation } : {}),
        ...(safeComponentStack(input.component_stack)
          ? { context_component_stack: safeComponentStack(input.component_stack) }
          : {}),
      },
    };
  });
}

async function collectEvents(records) {
  const lines = records.map((record) => JSON.stringify(record));
  const storedBytes = lines.reduce((total, line) => total + Buffer.byteLength(line), 0);
  if (!reserveAnalytics(storedBytes)) {
    analyticsCounters.budget_limited++;
    reject(429);
  }
  const values = lines.map((line) => {
    const timestamp = BigInt(Date.now()) * 1_000_000n;
    lastTimestamp = timestamp > lastTimestamp ? timestamp : lastTimestamp + 1n;
    return [lastTimestamp.toString(), line];
  });
  try {
    const response = await fetch(`${loki}/loki/api/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        streams: [
          {
            stream: {
              app: "manabrew-client",
              environment: records[0].app_environment,
              source: "analytics",
            },
            values,
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Loki rejected telemetry");
    lokiReady = true;
  } catch {
    analyticsCounters.export_errors++;
    lokiReady = false;
    reject(503);
  }
  if (
    records.some((record) => record.event_name === "first_game_funnel" && record.context_user_id)
  ) {
    try {
      clientFunnel ??= new ClientFunnel(stateDirectory);
      clientFunnel.record(records);
    } catch {
      analyticsCounters.funnel_errors++;
      reject(503);
    }
  }
  analyticsCounters.accepted += records.length;
}

async function collectExceptions(entries) {
  if (currentBudget().bytes >= DAILY_BYTES) {
    counters.budget_limited++;
    reject(429);
  }
  const requestMaps = {
    frames: new Map(),
    failed: new Set(),
    work: { loads: 0, readBytes: 0, decodedBytes: 0 },
  };
  const streams = new Map();
  const usage = signatureUsage();
  const requestSignatureBytes = new Map();
  let storedBytes = 0;
  const resolveStack = (release, frames) =>
    frames
      .map((frame) => {
        const mapped = maps.frame(release, frame, requestMaps);
        counters[mapped === frame ? "unmapped_frames" : "mapped_frames"]++;
        const location = `${mapped.filename}${mapped.lineno ? `:${mapped.lineno}:${mapped.colno ?? 1}` : mapped.colno ? `:${mapped.colno}` : ""}`;
        return !mapped.function || mapped.function === "?" || mapped.function === ANONYMOUS_FUNCTION
          ? `at ${location}`
          : `at ${mapped.function} (${location})`;
      })
      .join("\n");
  for (const { frames, causes, record } of entries) {
    record.stacktrace = [
      `${record.type}: ${record.value}`,
      resolveStack(record.app_release, frames),
      ...causes.map((cause, index) =>
        [
          `${cause.relation === "cause" ? "Caused by" : "Aggregate error"} #${index + 1} of #${cause.parent}: ${cause.type}: ${cause.value}`,
          resolveStack(record.app_release, cause.frames),
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ]
      .filter(Boolean)
      .join("\n");
    const line = JSON.stringify(record);
    const lineBytes = Buffer.byteLength(line);
    const signature = record.context_signature;
    const signatureTotal =
      (usage.get(signature) ?? 0) + (requestSignatureBytes.get(signature) ?? 0) + lineBytes;
    if (signatureTotal > SIGNATURE_DAILY_BYTES) {
      counters.signature_capped++;
      continue;
    }
    requestSignatureBytes.set(signature, (requestSignatureBytes.get(signature) ?? 0) + lineBytes);
    storedBytes += lineBytes;
    const key = `${record.app_environment}/${record.context_source}`;
    if (!streams.has(key))
      streams.set(key, {
        stream: {
          app: record.app_name,
          environment: record.app_environment,
          source: record.context_source,
        },
        values: [],
      });
    const timestamp = BigInt(Date.now()) * 1_000_000n;
    lastTimestamp = timestamp > lastTimestamp ? timestamp : lastTimestamp + 1n;
    streams.get(key).values.push([lastTimestamp.toString(), line]);
  }
  if (!streams.size) return;
  if (!reserve(storedBytes)) {
    counters.budget_limited++;
    reject(429);
  }
  for (const [signature, bytes] of requestSignatureBytes)
    usage.set(signature, (usage.get(signature) ?? 0) + bytes);
  try {
    const response = await fetch(`${loki}/loki/api/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streams: [...streams.values()] }),
      signal: AbortSignal.timeout(4000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Loki rejected telemetry");
    lokiReady = true;
  } catch {
    counters.export_errors++;
    lokiReady = false;
    reject(503);
  }
  counters.accepted += [...streams.values()].reduce(
    (total, { values }) => total + values.length,
    0,
  );
}

async function collect(request) {
  let metrics = counters;
  let pool;
  try {
    if (
      request.headers["content-encoding"] ||
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")
    )
      reject(415);
    const declared = request.headers["content-length"];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) reject(413);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) reject(413);
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reject(400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) reject(400);
    const analytics =
      Object.hasOwn(body, "events") &&
      (!Array.isArray(body.events) || body.events.length > 0 || !Object.hasOwn(body, "exceptions"));
    metrics = analytics ? analyticsCounters : counters;
    const signal = analytics ? "events" : "exceptions";
    for (const key of ["events", "exceptions", "logs", "measurements", "traces"]) {
      if (
        key !== signal &&
        body[key] !== undefined &&
        (!Array.isArray(body[key]) || body[key].length > 0)
      )
        reject(400);
    }
    const entries = analytics ? sanitizeEvents(body) : sanitize(body);
    const selected = analytics ? analyticsPool : errorPool;
    acquire(selected, metrics);
    pool = selected;
    if (analytics) await collectEvents(entries);
    else await collectExceptions(entries);
  } catch (error) {
    metrics.rejected++;
    throw error;
  } finally {
    if (pool) pool.inflight--;
  }
}

const server = createServer(
  {
    maxHeaderSize: 8192,
    requestTimeout: 5000,
    headersTimeout: 5000,
    keepAliveTimeout: 2000,
    connectionsCheckingInterval: 1000,
  },
  async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/health" && request.method === "GET") {
      try {
        const ready = await fetch(`${loki}/ready`, { signal: AbortSignal.timeout(2000) });
        await ready.body?.cancel();
        lokiReady = ready.ok;
      } catch {
        lokiReady = false;
      }
      response.writeHead(lokiReady ? 200 : 503).end(lokiReady ? "ready" : "unavailable");
      return;
    }
    if (request.url === "/metrics" && request.method === "GET") {
      const metrics = Object.entries(counters).map(
        ([name, value]) => `faro_collector_${name}_total ${value}`,
      );
      metrics.push(
        ...Object.entries(analyticsCounters).map(
          ([name, value]) => `faro_collector_analytics_${name}_total ${value}`,
        ),
      );
      metrics.push(
        `faro_collector_loki_ready ${Number(lokiReady)}`,
        `faro_collector_cache_entries ${maps.entries.size}`,
        `faro_collector_cache_bytes ${maps.bytes}`,
        `faro_collector_cache_hits_total ${maps.hits}`,
        `faro_collector_cache_misses_total ${maps.misses}`,
        `faro_collector_cache_evictions_total ${maps.evictions}`,
        `faro_collector_daily_bytes ${currentBudget().bytes}`,
        `faro_collector_daily_limit_bytes ${DAILY_BYTES}`,
        `faro_collector_signature_daily_limit_bytes ${SIGNATURE_DAILY_BYTES}`,
        `faro_collector_signatures_tracked ${signatureUsage().size}`,
        `faro_collector_analytics_daily_bytes ${currentAnalyticsBudget().bytes}`,
        `faro_collector_analytics_daily_limit_bytes ${ANALYTICS_DAILY_BYTES}`,
        `faro_collector_inflight ${errorPool.inflight}`,
        `faro_collector_analytics_inflight ${analyticsPool.inflight}`,
        `faro_collector_rate_tokens ${errorPool.tokens}`,
        `faro_collector_analytics_rate_tokens ${analyticsPool.tokens}`,
        `faro_collector_resident_memory_bytes ${process.memoryUsage().rss}`,
      );
      response
        .writeHead(200, { "Content-Type": "text/plain; version=0.0.4" })
        .end(`${metrics.join("\n")}\n`);
      return;
    }
    if (request.url !== "/collect") {
      response.writeHead(404).end();
      return;
    }
    const origin = request.headers.origin;
    if (!origins.has(origin) || !["POST", "OPTIONS"].includes(request.method)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "POST");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Faro-Session-Id, Idempotency-Key",
    );
    response.setHeader("Access-Control-Expose-Headers", "Retry-After");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    try {
      await collect(request);
      response.writeHead(202).end();
    } catch (error) {
      const status = error.status ?? 503;
      if (status === 429) response.setHeader("Retry-After", "60");
      response.setHeader("Connection", "close");
      response.writeHead(status).end("Collector request rejected");
    }
  },
);
server.maxConnections = 32;
server.maxHeadersCount = 32;
server.maxRequestsPerSocket = 20;
setInterval(() => maps.prune(), 30_000).unref();
server.listen(Number(process.env.PORT ?? 12347), "0.0.0.0");
