import { isToggledOff, type PromptResolver } from "./promptHandlers";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

export const skipBoolean: PromptResolver<"chooseBoolean"> = (_prompt, ctx) => {
  if (!isToggledOff("chooseBoolean", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "decision", value: false },
    reason: i18n._(msg`boolean prompt toggled off; defaulting to decline`),
  };
};
