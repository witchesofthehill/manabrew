import type { DeckCard } from "@/protocol/deck";

const RETRO_LAYOUTS = new Set([
  "normal",
  "token",
  "double_faced_token",
  "emblem",
  "transform",
  "modal_dfc",
  "meld",
  "reversible_card",
]);

export function supportsRetroCardFrame(
  card: Pick<DeckCard, "layout" | "types" | "subtypes" | "text">,
): boolean {
  return (
    RETRO_LAYOUTS.has(card.layout ?? "normal") &&
    ![...(card.types ?? []), ...(card.subtypes ?? [])].some((type) =>
      /^(Saga|Class|Planeswalker|Battle|Room|Plane|Phenomenon|Scheme|Vanguard)$/i.test(type),
    ) &&
    !/^Level up\b/m.test(card.text ?? "")
  );
}

export interface CardRenderDecision {
  readonly mode: "native" | "host" | "original";
  readonly reason?: string;
  readonly layout: string;
  readonly faceIndex: number;
  readonly template?: string;
  readonly engine?: "card-glint" | "manabrew";
}

export class CardRenderError extends Error {
  readonly decision: CardRenderDecision;
  constructor(
    decision: CardRenderDecision,
    message = decision.mode === "original" ? decision.reason : "Generated rendering failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CardRenderError";
    this.decision = decision;
  }
}

export class CardArtworkError extends CardRenderError {
  constructor(layout: string, faceIndex: number) {
    super(
      {
        mode: "original",
        reason: "unrepresentable-fields",
        layout,
        faceIndex,
        engine: "card-glint",
      },
      "Selected artwork requires the original printing layout",
    );
    this.name = "CardArtworkError";
  }
}
