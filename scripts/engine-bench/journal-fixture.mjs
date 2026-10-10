export const deck = {
  format: "standard",
  cards: [
    { name: "Forest", count: 20 },
    { name: "Memnite", count: 20 },
    { name: "Sprout", count: 20 },
  ],
};

export function scriptedAnswer({ prompt }) {
  const input = prompt.input;
  let output;
  switch (input.type) {
    case "diceRolled":
      output = { type: "diceRolledAcknowledged" };
      break;
    case "mulligan":
      output = { type: "mulliganDecision", keep: true };
      break;
    case "revealCards":
      output = { type: "revealCardsAcknowledged" };
      break;
    case "payManaCost":
      output = { type: "pay", auto: !input.canConfirmFromPool };
      break;
    case "chooseAction": {
      const action = input.actions.find((entry) => entry.type === "cast");
      output = action ? { type: "act", actionId: action.id } : { type: "pass" };
      break;
    }
    case "chooseAttackers":
      output = { type: "declareAttackers", assignments: [] };
      break;
    case "chooseBlockers":
      output = { type: "declareBlockers", assignments: [] };
      break;
    case "chooseBoardTargets":
      output = { type: "boardTargetsDecision", chosen: [input.candidates[0]] };
      break;
    case "scry":
      output = {
        type: "scryDecision",
        zoneCardIds: [
          input.cards.map((card) => card.id).reverse(),
          ...input.zones.slice(1).map(() => []),
        ],
      };
      break;
    case "chooseCards":
      output = {
        type: "chooseCardsDecision",
        chosenCardIds: input.cards
          .slice(0, Math.max(input.min, Math.min(1, input.max)))
          .map((card) => card.id),
      };
      break;
    default:
      throw new Error(`Unsupported fixture prompt ${input.type}`);
  }
  return { type: input.type, output };
}
