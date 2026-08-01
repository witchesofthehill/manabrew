import { describe, expect, it } from "vitest";
import { computeStackLayout, reconcileStackHover } from "./stackLayout";

const portrait = { width: 220, height: 308 };
const landscape = { width: 308, height: 220 };

function layout(
  cards: Array<{ width: number; height: number }>,
  overrides: Partial<Parameters<typeof computeStackLayout>[0]> = {},
) {
  return computeStackLayout({
    viewWidth: 1200,
    viewHeight: 800,
    cards,
    fallbackWidth: portrait.width,
    fallbackHeight: portrait.height,
    flash: null,
    fanOut: true,
    hoveredIndex: -1,
    hoverScale: 1.12,
    buttonWidth: 18,
    buttonGap: 6,
    ...overrides,
  });
}

describe("computeStackLayout", () => {
  it("fits portrait cards inside the expanded pile bounds", () => {
    const result = layout([portrait, portrait]);

    for (const [index, card] of result.cards.entries()) {
      expect(card.x - portrait.width / 2).toBeGreaterThanOrEqual(result.panelLeft);
      expect(card.x + portrait.width / 2).toBeLessThanOrEqual(result.panelLeft + result.pileWidth);
      expect(card.y - portrait.height / 2).toBeGreaterThanOrEqual(result.panelTop);
      expect(card.y + portrait.height / 2).toBeLessThanOrEqual(result.panelTop + result.pileHeight);
      expect(card.zIndex).toBe(index + 1);
    }
  });

  it("uses landscape dimensions for mixed piles", () => {
    const result = layout([portrait, landscape]);

    expect(result.pileWidth).toBe(36 + 120 + landscape.width);
    expect(result.pileHeight).toBe(portrait.height + 4);
    expect(result.cards[1]!.x - landscape.width / 2).toBeGreaterThanOrEqual(result.panelLeft);
  });

  it("pushes neighbours away and raises the hovered card", () => {
    const baseline = layout([portrait, landscape, portrait]);
    const hovered = layout([portrait, landscape, portrait], { hoveredIndex: 1 });

    expect(hovered.cards[0]!.x).toBe(baseline.cards[0]!.x + 42);
    expect(hovered.cards[2]!.x).toBe(baseline.cards[2]!.x - 42);
    expect(hovered.cards[1]!.zIndex).toBeGreaterThan(hovered.cards[0]!.zIndex);
    expect(hovered.cards[1]!.zIndex).toBeGreaterThan(hovered.cards[2]!.zIndex);
  });

  it("keeps the collapsed pile at the screen edge", () => {
    const result = layout([landscape], { fanOut: false });

    expect(result.drawLeft).toBe(1200 - 16 - 60);
    expect(result.cards[0]!.x - landscape.width / 2).toBe(result.drawLeft + 60);
  });

  it("places a landscape pre-stack flash with its own dimensions", () => {
    const result = layout([portrait], { flash: landscape });

    expect(result.flash).not.toBeNull();
    expect(result.flash!.x).toBe(result.drawLeft + result.xShift + landscape.width / 2);
    expect(result.flash!.y).toBe(result.panelTop + landscape.height / 2);
  });
});

describe("reconcileStackHover", () => {
  it("publishes the replacement stack id for a reused source", () => {
    expect(
      reconcileStackHover("casting-1", new Set(["stack-2"]), new Map([["casting-1", "stack-2"]])),
    ).toBe("stack-2");
  });

  it("clears a hovered stack object that disappeared", () => {
    expect(reconcileStackHover("stack-1", new Set(), new Map())).toBeNull();
  });

  it("preserves a hovered stack object that remains", () => {
    expect(reconcileStackHover("stack-1", new Set(["stack-1"]), new Map())).toBe("stack-1");
  });
});
