// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./constants";

async function load() {
  vi.resetModules();
  return import("./forgeWasm");
}

function storeVerdict(verdict: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEYS.FORGE_WASM_VALIDATION, JSON.stringify(verdict));
}

describe("forge wasm trial verdict", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "crossOriginIsolated", { value: true, configurable: true });
    (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer ??= ArrayBuffer;
  });

  it("retries a timed-out trial on a later day", async () => {
    const fresh = await load();
    storeVerdict({
      url: fresh.FORGE_WASM_URL,
      ok: false,
      failure: "timeout",
      at: Date.now() - fresh.TRIAL_RETRY_AFTER_MS - 1,
      attempts: 1,
    });
    const mod = await load();
    expect(mod.forgeWasmNeedsValidation()).toBe(true);
    expect(mod.forgeWasmGate()).not.toBe("trial_timeout");
  });

  it("holds a timed-out trial until the retry window passes", async () => {
    const fresh = await load();
    storeVerdict({
      url: fresh.FORGE_WASM_URL,
      ok: false,
      failure: "timeout",
      at: Date.now(),
      attempts: 1,
    });
    const mod = await load();
    expect(mod.forgeWasmNeedsValidation()).toBe(false);
    expect(mod.forgeWasmGate()).toBe("trial_timeout");
  });

  it("stops retrying a timeout after the attempt cap", async () => {
    const fresh = await load();
    storeVerdict({
      url: fresh.FORGE_WASM_URL,
      ok: false,
      failure: "timeout",
      at: 0,
      attempts: fresh.MAX_TRIAL_ATTEMPTS,
    });
    const mod = await load();
    expect(mod.forgeWasmNeedsValidation()).toBe(false);
    expect(mod.forgeWasmGate()).toBe("trial_timeout");
  });

  it("never retries a trial the engine itself failed", async () => {
    const fresh = await load();
    storeVerdict({
      url: fresh.FORGE_WASM_URL,
      ok: false,
      failure: "engine",
      at: 0,
      attempts: 1,
    });
    const mod = await load();
    expect(mod.forgeWasmNeedsValidation()).toBe(false);
    expect(mod.forgeWasmGate()).toBe("trial_failed");
  });

  it("treats a trial that never finished as a timeout, not a verdict", async () => {
    const fresh = await load();
    storeVerdict({ url: fresh.FORGE_WASM_URL, ok: null, at: 0, attempts: 0 });
    const mod = await load();
    expect(mod.forgeWasmNeedsValidation()).toBe(true);
  });

  it("counts attempts across successive timeouts", async () => {
    const mod = await load();
    mod.recordForgeWasmVerdict(false, "timeout", "engine did not start in time");
    mod.recordForgeWasmVerdict(false, "timeout", "engine did not start in time");
    const raw = localStorage.getItem(STORAGE_KEYS.FORGE_WASM_VALIDATION) ?? "{}";
    expect(JSON.parse(raw).attempts).toBe(2);
  });

  it("clears the failure once a trial succeeds", async () => {
    const mod = await load();
    mod.recordForgeWasmVerdict(false, "timeout");
    mod.recordForgeWasmVerdict(true);
    const raw = localStorage.getItem(STORAGE_KEYS.FORGE_WASM_VALIDATION) ?? "{}";
    const verdict = JSON.parse(raw);
    expect(verdict.ok).toBe(true);
    expect(verdict.failure).toBeUndefined();
  });
});
