import type { PromptResolver } from "./promptHandlers";

export const optionalTriggerMemory: PromptResolver = (prompt, ctx) => {
  const sourceId = prompt.sourceCardId;
  if (!sourceId) return { kind: "force-show" };
  const remembered = ctx.prefs.triggerMemory[sourceId];
  if (!remembered) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "optionalTriggerDecision", accept: remembered === "yes" },
    reason: `remembered "${remembered}" for ${sourceId}`,
  };
};
