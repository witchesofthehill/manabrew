import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));

import {
  beginGame,
  byPromptType,
  noteAnswerSent,
  noteEngineThinkTime,
  notePromptArrived,
  summarise,
  summariseGame,
} from "@/lib/engineTelemetry";

const meta = {
  engine: "forge-wasm",
  clientVersion: "test",
  platform: "web",
  format: "standard",
  seats: 2,
  multiplayer: false,
  endReason: "gameOver" as const,
  reportId: "11111111-2222-3333-4444-555555555555",
};

describe("engine telemetry", () => {
  it("summarises to percentiles", () => {
    expect(summarise([])).toEqual({ n: 0, p50: 0, p90: 0, max: 0 });
    const stat = summarise([10, 20, 30, 40, 1000]);
    expect(stat.n).toBe(5);
    expect(stat.p50).toBe(30);
    expect(stat.max).toBe(1000);
  });

  it("groups by prompt type, busiest first", () => {
    const grouped = byPromptType([
      { ms: 10, type: "chooseAction" },
      { ms: 30, type: "chooseAction" },
      { ms: 50, type: "payManaCost" },
    ]);
    expect(grouped[0]).toEqual({ type: "chooseAction", n: 2, p50: 30, max: 30 });
    expect(grouped[1]).toEqual({ type: "payManaCost", n: 1, p50: 50, max: 50 });
  });

  it("measures the gap from an answer to the next prompt, and nothing else", () => {
    beginGame();
    // A prompt with no answer behind it is the engine speaking first, not a
    // turnaround: the opening prompt would otherwise report the whole boot.
    notePromptArrived("mulligan");
    for (let i = 0; i < 6; i += 1) {
      noteAnswerSent();
      notePromptArrived("chooseAction");
    }
    noteEngineThinkTime(4);
    const stats = summariseGame(meta);
    expect(stats).not.toBeNull();
    expect(stats?.turnaround.n).toBe(6);
    expect(stats?.engineThink?.n).toBe(1);
    expect(stats?.byType[0]?.type).toBe("chooseAction");
    expect(stats?.clientVersion).toBe("test");
  });

  it("reports nothing for a game that barely started", () => {
    beginGame();
    noteAnswerSent();
    notePromptArrived("chooseAction");
    expect(summariseGame(meta)).toBeNull();
  });
});

describe("engine label", () => {
  it("names what actually ran, not what the room asked for", async () => {
    const { currentEngineLabel } = await import("@/lib/engineStatsReport");
    // The registry defaults to the Rust engine in a fresh module graph.
    expect(currentEngineLabel()).toBe("manabrew");
  });
});
