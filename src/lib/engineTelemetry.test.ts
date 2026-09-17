import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));

import {
  beginGame,
  byPromptType,
  noteAnswerSent,
  noteEngineThinkTime,
  notePromptArrived,
  noteReplyFrameArrived,
  noteReplyFrameHandled,
  summarise,
  summariseGame,
} from "@/lib/engineTelemetry";

const meta = {
  clientVersion: "test",
  platform: "web",
  format: "standard",
  seats: 2,
  multiplayer: false,
  endReason: "gameOver" as const,
  reportId: "11111111-2222-3333-4444-555555555555",
  gameId: "66666666-7777-8888-9999-aaaaaaaaaaaa",
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
    beginGame("forge-wasm");
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
    expect(stats?.engine).toBe("forge-wasm");
    // Without this the timings cannot be joined to what was played.
    expect(stats?.gameId).toBe("66666666-7777-8888-9999-aaaaaaaaaaaa");
  });

  it("counts only the frames' own handling as client work", () => {
    const now = vi.spyOn(performance, "now");
    beginGame("forge-hosted");
    // A frame before any answer is not a reply to anything.
    noteReplyFrameArrived(5);
    now.mockReturnValue(20);
    noteReplyFrameHandled();
    for (let i = 0; i < 6; i += 1) {
      const t = 1000 * i;
      now.mockReturnValue(t);
      noteAnswerSent();
      // The echo of our own action lands and takes 50ms to apply.
      noteReplyFrameArrived(t + 100);
      now.mockReturnValue(t + 150);
      noteReplyFrameHandled();
      // The opponents play for most of a second: not this machine's time.
      noteReplyFrameArrived(t + 900);
      now.mockReturnValue(t + 1000 + 40);
      noteReplyFrameHandled();
      // The prompt frame arrives and is handled up to the prompt itself.
      noteReplyFrameArrived(t + 1100);
      now.mockReturnValue(t + 1110);
      notePromptArrived("chooseAction");
      // The trailing handled stamp for the prompt frame is outside any window.
      now.mockReturnValue(t + 1200);
      noteReplyFrameHandled();
    }
    const stats = summariseGame(meta);
    now.mockRestore();
    expect(stats?.turnaround).toMatchObject({ n: 6, p50: 1110, max: 1110 });
    expect(stats?.clientWork).toMatchObject({ n: 6, p50: 200, max: 200 });
    expect(stats?.replyWait).toMatchObject({ n: 6, p50: 910, max: 910 });
  });

  it("puts a single frame's handling on the client side and the rest on the wire", () => {
    const now = vi.spyOn(performance, "now");
    beginGame("forge-wasm");
    for (let i = 0; i < 6; i += 1) {
      const t = 1000 * i;
      now.mockReturnValue(t);
      noteAnswerSent();
      noteReplyFrameArrived(t + 300);
      now.mockReturnValue(t + 320);
      notePromptArrived("chooseAction");
    }
    const stats = summariseGame(meta);
    now.mockRestore();
    expect(stats?.replyWait).toMatchObject({ n: 6, p50: 300, max: 300 });
    expect(stats?.clientWork).toMatchObject({ n: 6, p50: 20, max: 20 });
  });

  it("reports no split for an engine that stamps no frames", () => {
    beginGame("manabrew");
    for (let i = 0; i < 6; i += 1) {
      noteAnswerSent();
      notePromptArrived("chooseAction");
    }
    const stats = summariseGame(meta);
    expect(stats?.turnaround.n).toBe(6);
    expect(stats?.replyWait).toBeNull();
    expect(stats?.clientWork).toBeNull();
  });

  it("reports nothing for a game that barely started", () => {
    beginGame("manabrew");
    noteAnswerSent();
    notePromptArrived("chooseAction");
    expect(summariseGame(meta)).toBeNull();
  });
});

describe("engine label", () => {
  it("names what actually ran, not what the room asked for", async () => {
    const { localEngineLabel, roomEngineLabel, forgeHostLabel } =
      await import("@/lib/engineStatsReport");
    // The registry defaults to the Rust engine in a fresh module graph.
    expect(localEngineLabel()).toBe("manabrew");
    expect(roomEngineLabel("Forge", false, "web", false)).toBe("forge-remote");
    expect(roomEngineLabel("Forge", false, "web", true)).toBe("forge-hosted");
    expect(roomEngineLabel("Forge", false, "tauri", true)).toBe("forge-hosted");
    expect(roomEngineLabel("Forge", true, "web", false)).toBe("forge-wasm");
    expect(roomEngineLabel("Forge", true, "tauri", false)).toBe("forge-desktop");
    expect(roomEngineLabel("Ironsmith", false, "web", false)).toBe("ironsmith");
    expect(roomEngineLabel("Manabrew", false, "web", false)).toBe("manabrew");
    expect(forgeHostLabel(false)).toBe("forge-hosted");
  });
});
