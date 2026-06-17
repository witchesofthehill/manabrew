import { isToggledOff, type PromptResolver } from "./promptHandlers";

export const skipBoolean: PromptResolver<"chooseBoolean"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseBoolean", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "decision", value: false },
    reason: "boolean prompt toggled off; defaulting to decline",
  };
};

export const skipMultikicker: PromptResolver<"chooseMultikicker"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseMultikicker", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "multikickerDecision", kickCount: 0 },
    reason: "multikicker prompt toggled off; defaulting to 0",
  };
};

export const skipReplicate: PromptResolver<"chooseReplicate"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseReplicate", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "replicateDecision", replicateCount: 0 },
    reason: "replicate prompt toggled off; defaulting to 0",
  };
};

export const skipDelve: PromptResolver<"chooseDelve"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseDelve", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "delveDecision", chosenCardIds: [] },
    reason: "delve prompt toggled off; defaulting to no delve",
  };
};

export const skipAssist: PromptResolver<"helpPayAssist"> = (_prompt, ctx) => {
  if (!isToggledOff("helpPayAssist", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "assistDecision", amountToPay: 0 },
    reason: "help-pay prompt toggled off; defaulting to 0",
  };
};
