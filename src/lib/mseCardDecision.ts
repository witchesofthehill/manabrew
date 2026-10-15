import type { MseRenderDecision } from "@mse-renderer";

export class MseCardRenderError extends Error {
  readonly decision: MseRenderDecision;
  constructor(
    decision: MseRenderDecision,
    message = decision.mode === "original" ? decision.reason : "Native rendering failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MseCardRenderError";
    this.decision = decision;
  }
}

export class MseCardArtworkError extends MseCardRenderError {
  constructor(layout: string, faceIndex: number) {
    super(
      { mode: "original", reason: "unrepresentable-fields", layout, faceIndex },
      "Selected artwork requires the original printing layout",
    );
    this.name = "MseCardArtworkError";
  }
}
