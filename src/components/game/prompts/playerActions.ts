import type { Prompt, PromptOutput } from "@/protocol";

// "Pass" means decline whatever the current prompt asks: during combat
// declaration that's an empty attacker/blocker set; otherwise a priority pass.
export function passOutput(prompt: Prompt | null, untilPhase: string | null): PromptOutput | null {
  if (!prompt) return null;
  switch (prompt.input.type) {
    case "chooseAttackers":
      return { type: "declareAttackers", assignments: [] };
    case "chooseBlockers":
      return { type: "declareBlockers", assignments: [] };
    case "chooseAction":
      return { type: "pass", untilPhase: untilPhase ?? undefined };
    default:
      return { type: "pass", untilPhase: undefined };
  }
}

export function declareAttackersOutput(
  prompt: Prompt | null,
  attackerIds: string[],
  defenderId?: string,
): PromptOutput {
  const defaultDefender =
    prompt?.input.type === "chooseAttackers"
      ? (prompt.input.possibleDefenderIds[0]?.id ?? "player-1")
      : "player-1";
  return {
    type: "declareAttackers",
    assignments: attackerIds.map((id) => ({
      attackerId: id,
      defenderId: defenderId ?? defaultDefender,
    })),
  };
}
