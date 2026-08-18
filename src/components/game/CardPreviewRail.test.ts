// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { useCardPreview } from "@/hooks/useCardPreview";
import { CardPreviewMachine, type PreviewCard } from "@/lib/cardPreview";

vi.mock("./HoverCardPreview", () => ({ HoverCardPreview: () => null }));

import { CardPreviewRail } from "./CardPreviewRail";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("CardPreviewRail", () => {
  it("updates from the preview machine without a parent render", () => {
    const machine = new CardPreviewMachine();
    const preview = {
      subscribe: machine.subscribe,
      getSnapshot: machine.getSnapshot,
      hoveredCard: null,
      phase: "hidden",
      mousePos: { x: 0, y: 0 },
      anchorRect: null,
      placement: "auto",
      showBackFace: false,
      isSticky: false,
      dismiss: () => machine.dismiss(),
      flipCard: () => machine.flip(),
      handleMouseEnter: () => undefined,
      handleMouseLeave: () => undefined,
      onMouseEnterPreview: () => undefined,
      onMouseLeavePreview: () => undefined,
      showSticky: () => undefined,
    } as ReturnType<typeof useCardPreview>;
    const card = {
      identity: { id: "card-1", name: "Lightning Bolt" },
    } as unknown as PreviewCard;
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() =>
      root.render(
        createElement(CardPreviewRail, {
          preview,
          renderDetails: (current) => createElement("output", null, current.identity.name),
        }),
      ),
    );
    expect(container.querySelector("output")).toBeNull();

    act(() => machine.hoverStart(card));

    expect(container.querySelector("output")?.textContent).toBe("Lightning Bolt");
    act(() => root.unmount());
    machine.destroy();
  });
});
