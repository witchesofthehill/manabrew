import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CombatSummarySection } from "./CombatSummarySection";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import type { CardDto } from "@/protocol/game";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

afterAll(() => vi.unstubAllGlobals());

describe("combat summary", () => {
  it("counts both damage steps for an unblocked double-strike attacker", () => {
    const attacker: CardDto = {
      ...GAME_CARD_DEFAULTS,
      id: "attacker",
      identity: {
        name: "Attacker",
        setCode: "tst",
        cardNumber: "1",
        isToken: false,
      },
      power: "4",
      toughness: "4",
      keywords: ["Double strike"],
    };
    const markup = renderToStaticMarkup(
      createElement(CombatSummarySection, {
        promptType: "chooseBlockers",
        attackerIds: [attacker.id],
        pendingAttackers: [],
        blockAssignments: [],
        resolveCardName: () => attacker.identity.name,
        resolveCard: () => attacker,
      }),
    );

    expect(markup).toContain("Through 8");
  });
});
