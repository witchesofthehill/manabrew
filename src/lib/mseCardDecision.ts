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
