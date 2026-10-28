import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CLIENT_ERROR_SOURCES,
  OPERATIONS,
  ROUTES,
  errorSignature,
  safeAssetUrl,
  safeComponentStack,
  safeEngine,
  safeErrorMessage,
  safeErrorName,
  safeFrames,
} from "../../../src/lib/errorReportingPrivacy.ts";
import { SourceMaps } from "./sourcemaps.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const DAILY_BYTES = Number(process.env.FARO_DAILY_BYTES ?? 10 * 1024 * 1024);
const MAX_INFLIGHT = 4;
const origins = new Set((process.env.FARO_ORIGINS ?? "").split(",").filter(Boolean));
const loki = process.env.LOKI_URL ?? "http://loki:3100";
const stateDirectory = process.env.FARO_STATE_DIR ?? "/var/lib/faro/state";
const stateFile = path.join(stateDirectory, "budget.json");
const maps = new SourceMaps(process.env.FARO_MAPS_DIR ?? "/var/lib/faro/sourcemaps");
const releasePattern =
  /^([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)-[a-f0-9]{40}-([a-z][a-z0-9-]{0,63})$/;
const counters = {
  accepted: 0,
  rejected: 0,
  export_errors: 0,
  mapped_frames: 0,
  unmapped_frames: 0,
};
let inflight = 0;
let tokens = 40;
let lastRefill = performance.now();
let lokiReady = false;
let lastTimestamp = 0n;
if (!origins.size || !Number.isSafeInteger(DAILY_BYTES) || DAILY_BYTES <= 0)
  throw new Error("Invalid collector configuration");
mkdirSync(stateDirectory, { recursive: true });
let budget = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8"))
  : { day: "", bytes: 0 };
if (typeof budget.day !== "string" || !Number.isSafeInteger(budget.bytes) || budget.bytes < 0)
  throw new Error("Invalid collector budget state");

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

function reject(status) {
  throw Object.assign(new Error("Collector request rejected"), { status });
}

function sanitize(body) {
  const app = body?.meta?.app;
  const release =
    typeof app?.release === "string" &&
    app.release.length <= 200 &&
    app.release.match(releasePattern);
  if (
    app?.name !== "manabrew-client" ||
    !release ||
    app.version !== release[1] ||
    !["production", "staging", "development"].includes(app.environment) ||
    !Array.isArray(body.exceptions) ||
    body.exceptions.length < 1 ||
    body.exceptions.length > 10
  )
    reject(400);
  return body.exceptions.map((exception) => {
    const input = exception?.context;
    if (!CLIENT_ERROR_SOURCES.includes(input?.source)) reject(400);
    const incoming = exception.stacktrace?.frames ?? [];
    if (
      !Array.isArray(incoming) ||
      incoming.length > 20 ||
      incoming.some(
        (frame) =>
          !frame ||
          frame.filename !== safeAssetUrl(frame.filename) ||
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
      record: {
        kind: "exception",
        type,
        value,
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

async function collect(request) {
  const now = performance.now();
  tokens = Math.min(40, tokens + ((now - lastRefill) * 20) / 1000);
  lastRefill = now;
  if (tokens < 1 || inflight >= MAX_INFLIGHT || currentBudget().bytes >= DAILY_BYTES) reject(429);
  tokens--;
  inflight++;
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
    const entries = sanitize(body);
    const requestMaps = {
      frames: new Map(),
      failed: new Set(),
      work: { loads: 0, readBytes: 0, decodedBytes: 0 },
    };
    const streams = new Map();
    let storedBytes = 0;
    for (const { frames, record } of entries) {
      const resolved = frames.map((frame) => {
        const mapped = maps.frame(record.app_release, frame, requestMaps);
        counters[mapped === frame ? "unmapped_frames" : "mapped_frames"]++;
        return mapped;
      });
      record.stacktrace = resolved
        .map(
          (frame) =>
            `at ${frame.function} (${frame.filename}${frame.lineno ? `:${frame.lineno}:${frame.colno ?? 1}` : ""})`,
        )
        .join("\n");
      const line = JSON.stringify(record);
      storedBytes += Buffer.byteLength(line);
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
    if (!reserve(storedBytes)) reject(429);
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
    counters.accepted += entries.length;
  } finally {
    inflight--;
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
        `faro_collector_loki_ready ${Number(lokiReady)}`,
        `faro_collector_cache_entries ${maps.entries.size}`,
        `faro_collector_cache_bytes ${maps.bytes}`,
        `faro_collector_cache_hits_total ${maps.hits}`,
        `faro_collector_cache_misses_total ${maps.misses}`,
        `faro_collector_cache_evictions_total ${maps.evictions}`,
        `faro_collector_daily_bytes ${currentBudget().bytes}`,
        `faro_collector_daily_limit_bytes ${DAILY_BYTES}`,
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
      counters.rejected++;
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
