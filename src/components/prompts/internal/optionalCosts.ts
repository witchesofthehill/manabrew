import { isToggledOff, type PromptResolver } from "./promptHandlers";

export const skipKicker: PromptResolver<"chooseKicker"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseKicker", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "kickerDecision", kicked: false },
    reason: "kicker prompt toggled off; defaulting to skip",
  };
};

export const skipBuyback: PromptResolver<"chooseBuyback"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseBuyback", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "buybackDecision", buybackPaid: false },
    reason: "buyback prompt toggled off; defaulting to skip",
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

export const skipConvoke: PromptResolver<"chooseConvoke"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseConvoke", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "convokeDecision", chosenCardIds: [] },
    reason: "convoke prompt toggled off; defaulting to no convoke",
  };
};

export const skipImprovise: PromptResolver<"chooseImprovise"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseImprovise", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "improviseDecision", chosenCardIds: [] },
    reason: "improvise prompt toggled off; defaulting to no improvise",
  };
};

export const skipExertEnlist: PromptResolver<"chooseExertAttackers" | "chooseEnlistAttackers"> = (
  prompt,
  ctx,
) => {
  const promptType =
    prompt.input.type === "chooseExertAttackers" ? "chooseExertAttackers" : "chooseEnlistAttackers";
  if (!isToggledOff(promptType, ctx)) return { kind: "force-show" };
  const wireType = promptType === "chooseExertAttackers" ? "exertDecision" : "enlistDecision";
  return {
    kind: "auto",
    respond: { type: wireType, chosenAttackerIds: [] },
    reason: `${wireType} prompt toggled off; defaulting to none`,
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
