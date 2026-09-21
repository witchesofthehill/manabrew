import { describe, expect, it } from "vitest";
import { formatCommsLog, logComms } from "./commsLog";

describe("commsLog", () => {
  it("describes an object message instead of serialising it", () => {
    const view = { turn: 7, phase: "MAIN1", activePlayerId: "player-0", zones: [] as unknown[] };
    for (let i = 0; i < 2000; i += 1) view.zones.push({ zone: "battlefield", cards: [{ id: i }] });
    const state = { kind: "state", gameView: view };
    logComms("recv", { type: "StateUpdate", from_player: "host", state });
    const line = formatCommsLog().split("\n").at(-1) ?? "";
    expect(line).toContain("type=StateUpdate");
    expect(line).toContain("turn=7");
    expect(line).toContain("phase=MAIN1");
    // The board itself is not in the log; only the fields that name the message.
    expect(line).not.toContain("battlefield");
    expect(line.length).toBeLessThan(300);
  });

  it("keeps the head of a wire string and says how long it was", () => {
    logComms("send", `{"type":"GameState","state":"${"x".repeat(10000)}"}`);
    const line = formatCommsLog().split("\n").at(-1) ?? "";
    expect(line).toContain("chars total");
    expect(line.length).toBeLessThan(4200);
  });

  it("names a prompt by id and type", () => {
    logComms("engine", {
      kind: "prompt",
      prompt: { promptId: 42, input: { type: "chooseAction" } },
    });
    expect(formatCommsLog().split("\n").at(-1)).toContain("prompt=42:chooseAction");
  });
});
