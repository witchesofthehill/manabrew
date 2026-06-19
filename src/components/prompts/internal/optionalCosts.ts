import { isToggledOff, type PromptResolver } from "./promptHandlers";

export const skipBoolean: PromptResolver<"chooseBoolean"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseBoolean", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "decision", value: false },
    reason: "boolean prompt toggled off; defaulting to decline",
  };
};
