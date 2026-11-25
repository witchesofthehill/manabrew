import { describe, expect, it } from "vitest";
import { sendBufferDrained, socketIsStale } from "./keepalive";

describe("sendBufferDrained", () => {
  it("is true only when the buffer shrank", () => {
    expect(sendBufferDrained(5_000_000, 3_000_000)).toBe(true);
    expect(sendBufferDrained(5_000_000, 0)).toBe(true);
    expect(sendBufferDrained(0, 0)).toBe(false);
    expect(sendBufferDrained(3_000_000, 3_000_000)).toBe(false);
    expect(sendBufferDrained(0, 40)).toBe(false);
  });
});

describe("socketIsStale", () => {
  const base = { now: 100_000, silenceMs: 10_000 };

  it("is stale after silence with nothing draining", () => {
    expect(socketIsStale({ ...base, lastInboundAt: 80_000, lastDrainAt: 70_000 })).toBe(true);
  });

  it("is alive while inbound frames keep arriving", () => {
    expect(socketIsStale({ ...base, lastInboundAt: 95_000, lastDrainAt: 0 })).toBe(false);
  });

  it("is alive while a large upload is still draining", () => {
    expect(socketIsStale({ ...base, lastInboundAt: 60_000, lastDrainAt: 96_000 })).toBe(false);
  });

  it("goes stale once the upload stops draining too", () => {
    expect(socketIsStale({ ...base, lastInboundAt: 60_000, lastDrainAt: 85_000 })).toBe(true);
  });
});
