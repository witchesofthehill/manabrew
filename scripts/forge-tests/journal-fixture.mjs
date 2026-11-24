export const deck = {
  format: "standard",
  cards: [
    { name: "Forest", count: 20 },
    { name: "Memnite", count: 20 },
    { name: "Sprout", count: 20 },
  ],
};

export const forgeAiDeck = {
  format: "standard",
  cards: [
    { name: "Mountain", count: 24 },
    { name: "Goblin Brigand", count: 24 },
    { name: "Shock", count: 12 },
  ],
};

export const forgeAiOpponentDeck = {
  format: "standard",
  cards: [
    { name: "Forest", count: 36 },
    { name: "Llanowar Elves", count: 24 },
  ],
};

export function forgeAiActivity(states) {
  const bot = "player-2";
  return {
    targetedSpell: states.some((state) =>
      state.stack.some(
        (item) =>
          item.controllerId === bot &&
          item.sourceCard?.identity.name === "Shock" &&
          !item.isCasting &&
          item.targets.length > 0,
      ),
    ),
    attack: states.some((state) =>
      state.zones.some(
        (zone) =>
          zone.zone === "battlefield" &&
          zone.ownerId === bot &&
          zone.cards.some((card) => card.isAttacking),
      ),
    ),
  };
}

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
    case "chooseBoolean":
      output = { type: "decision", value: true };
      break;
    case "chooseNumber":
      output = { type: "numberDecision", chosenNumber: input.min ?? 0 };
      break;
    case "reorder":
      output = { type: "reorderDecision", orderedIds: input.items.map((item) => item.id) };
      break;
    case "chooseFromSelection":
      output = {
        type: "selectionDecision",
        chosenIndices: input.options.map((_, i) => i).slice(0, input.minTotal ?? 1),
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
