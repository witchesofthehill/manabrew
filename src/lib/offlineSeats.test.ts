import { beforeEach, describe, expect, it, vi } from "vitest";

const relayUsername = vi.fn<() => string>();
vi.mock("@/lib/relayUsername", () => ({ relayUsername: () => relayUsername() }));

import { offlineSeats } from "@/lib/offlineSeats";
import type { ClientGameView } from "@/stores/gameStore.types";

const view = {
  players: [
    { id: "player-0", name: "You", isHuman: true, status: "active" },
    { id: "player-1", name: "Forge AI", isHuman: false, status: "conceded" },
  ],
} as unknown as ClientGameView;

describe("offlineSeats", () => {
  beforeEach(() => relayUsername.mockReset());

  it("names the human seat the way the relay knows the player", () => {
    relayUsername.mockReturnValue("Guest-4821@1234");
    expect(offlineSeats(view)).toEqual([
      { seatId: "player-0", username: "Guest-4821@1234", isBot: false, conceded: false },
      { seatId: "player-1", username: "Forge AI", isBot: true, conceded: true },
    ]);
  });

  it("keeps the engine's label only when there is no relay name at all", () => {
    relayUsername.mockReturnValue("");
    expect(offlineSeats(view)[0].username).toBe("You");
  });

  it("is empty before the first state arrives", () => {
    relayUsername.mockReturnValue("x");
    expect(offlineSeats(null)).toEqual([]);
  });
});
