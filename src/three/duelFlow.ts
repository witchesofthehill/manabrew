export const duelPhases = [
  { id: "upkeep", label: "Beginning", icon: "sun", steps: ["untap", "upkeep", "draw"] },
  { id: "main1", label: "Main", icon: "card", steps: ["main1"] },
  {
    id: "combatBegin",
    label: "Combat",
    icon: "swords",
    steps: [
      "combatBegin",
      "combatDeclareAttackers",
      "combatDeclareBlockers",
      "combatFirstStrikeDamage",
      "combatDamage",
      "combatEnd",
    ],
  },
  { id: "main2", label: "Main", icon: "card", steps: ["main2"] },
  { id: "endOfTurn", label: "End", icon: "moon", steps: ["endOfTurn", "cleanup"] },
] as const;

export const stepNames: Record<string, string> = {
  untap: "Untap",
  upkeep: "Upkeep",
  draw: "Draw",
  main1: "First main phase",
  combatBegin: "Beginning of combat",
  combatDeclareAttackers: "Declare attackers",
  combatDeclareBlockers: "Declare blockers",
  combatFirstStrikeDamage: "First strike damage",
  combatDamage: "Combat damage",
  combatEnd: "End of combat",
  main2: "Second main phase",
  endOfTurn: "End step",
  cleanup: "Cleanup",
};

export function nextStepLabel(step: string, stack: number, fullControl: boolean) {
  if (stack) return "Resolve";
  if (fullControl) return "Pass priority";
  if (step === "main1") return "To combat";
  if (step === "main2") return "End turn";
  if (step === "combatBegin") return "To attackers";
  if (step === "combatDeclareAttackers") return "To blockers";
  if (step === "combatDeclareBlockers") return "To damage";
  if (step === "combatEnd") return "To main phase";
  return "Continue";
}

export function isPhaseStopped(stops: string[], step: string) {
  return (
    stops.includes(step) ||
    duelPhases.some(
      (phase) => stops.includes(phase.id) && (phase.steps as readonly string[]).includes(step),
    )
  );
}
