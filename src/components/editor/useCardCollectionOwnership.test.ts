// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectionCardKey,
  collectionPrintingsByName,
  type DeckOwnershipSummary,
} from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";

import {
  CardCollectionOwnershipScope,
  useCardCollectionOwnership,
  useCardCollectionPrintings,
  useDeckCardOwnership,
} from "./useCardCollectionOwnership";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const card = {
  identity: {
    id: "card-1",
    name: "Lightning Bolt",
    setCode: "lea",
    cardNumber: "161",
    foil: false,
  },
} as DeckCard;

function Probe() {
  const printing = useCardCollectionOwnership(card);
  const printings = useCardCollectionPrintings(card);
  const deck = useDeckCardOwnership(card);
  return createElement("output", {
    "data-printing": printing,
    "data-deck": deck?.status,
    "data-printing-count": printings.length,
    "data-owned-quantity": printings.reduce((total, entry) => total + entry.quantity, 0),
  });
}

describe("card collection ownership scope", () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  afterEach(() => {
    act(() => root.render(createElement(Fragment)));
  });

  it("updates mounted card ownership when collection data changes", () => {
    const render = (quantities: Record<string, number>, status: DeckOwnershipSummary["status"]) => {
      const summary: DeckOwnershipSummary = {
        required: 1,
        owned: status === "missing" ? 0 : 1,
        exactOwned: status === "exact" ? 1 : 0,
        shortage: status === "missing" ? 1 : 0,
        status,
      };
      act(() =>
        root.render(
          createElement(
            CardCollectionOwnershipScope,
            {
              quantities,
              deckOwnership: new Map([["lightning bolt", summary]]),
              disabled: false,
            },
            createElement(Probe),
          ),
        ),
      );
    };

    render({ [collectionCardKey("Lightning Bolt", "lea", "161", false)]: 1 }, "exact");
    expect(container.querySelector("output")?.dataset).toMatchObject({
      printing: "exact",
      deck: "exact",
      printingCount: "1",
      ownedQuantity: "1",
    });

    render(
      {
        [collectionCardKey("Lightning Bolt", "2xm", "117", false)]: 1,
        [collectionCardKey("Lightning Bolt", "clb", "401", true)]: 2,
      },
      "other",
    );
    expect(container.querySelector("output")?.dataset).toMatchObject({
      printing: "other",
      deck: "other",
      printingCount: "2",
      ownedQuantity: "3",
    });
  });
});

describe("collection printing index", () => {
  it("groups every owned printing without changing its quantity", () => {
    const quantities = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [
        collectionCardKey("Lightning Bolt", `set${index}`, String(index), index % 2 === 0),
        index + 1,
      ]),
    );

    const printings = collectionPrintingsByName(quantities).get("lightning bolt");

    expect(printings).toHaveLength(250);
    expect(printings?.[249]).toMatchObject({
      setCode: "set249",
      collectorNumber: "249",
      foil: false,
      quantity: 250,
    });
  });
});
