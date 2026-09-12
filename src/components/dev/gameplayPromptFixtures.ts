import type { PromptInput } from "@/protocol";
import type { DevDialogPreview } from "./promptDialogPreviews";
import type { DevDialogFixtures } from "./promptDialogs/useDevDialogFixtures";

export function previewInput(preview: DevDialogPreview, fixtures: DevDialogFixtures): PromptInput {
  const { cards, me, targetPlayer, presentation } = fixtures;
  switch (preview) {
    case "choose-boolean":
      return {
        type: "chooseBoolean",
        presentation,
        confirmLabel: "Create the token",
        denyLabel: "Decline",
      };
    case "choose-color":
      return {
        type: "chooseColor",
        presentation,
        validColors: ["W", "U", "B", "R", "G"],
        amount: 1,
        repeatAllowed: false,
      };
    case "choose-colors":
      return {
        type: "chooseColor",
        presentation,
        validColors: ["W", "U", "B", "R", "G"],
        amount: 3,
        repeatAllowed: true,
      };
    case "choose-number-buttons":
      return { type: "chooseNumber", presentation, min: 0, max: 5 };
    case "choose-number-input":
      return { type: "chooseNumber", presentation, min: 0, max: 99 };
    case "choose-cards":
      return { type: "chooseCards", presentation, cards, min: 1, max: 2 };
    case "reveal-cards":
      return {
        type: "revealCards",
        presentation,
        cards,
        zone: "battlefield",
        ownerPlayerId: me.id,
      };
    case "scry":
    case "scry-landscape":
    case "scry-double-sided":
    case "scry-mixed":
      return {
        type: "scry",
        presentation: { ...presentation, title: `Scry ${cards.length}` },
        cards,
        zones: ["libraryTop", "libraryBottom", "graveyard"],
      };
    case "reorder":
      return {
        type: "reorder",
        presentation: { ...presentation, title: "Choose the trigger order" },
        items: cards.map((card, index) => ({
          id: card.id,
          card,
          oracle: `Triggered ability ${index + 1}`,
        })),
      };
    case "choose-selection":
      return {
        type: "chooseFromSelection",
        presentation,
        minTotal: 1,
        maxTotal: 3,
        options: [
          { label: "Draw a card", weight: 1, canRepeat: false },
          { label: "Create a 1/1 Soldier token", weight: 1, canRepeat: true },
          { label: "Gain 3 life", weight: 1, canRepeat: false },
          { label: "Return a permanent to its owner's hand", weight: 2, canRepeat: false },
          { label: "Add {G}{G}", weight: 1, canRepeat: false },
          { label: "Put two +1/+1 counters on a creature", weight: 2, canRepeat: false },
        ],
      };
    case "assign-combat-damage":
      return {
        type: "chooseCombatDamageAssignment",
        attackerId: cards[0]!.id,
        blockerIds: [cards[1]!.id, cards[2]!.id],
        defenderId: targetPlayer.id,
        totalDamage: 7,
        attackerHasDeathtouch: false,
      };
    case "damage-order":
      return {
        type: "chooseDamageAssignmentOrder",
        attackerId: cards[0]!.id,
        blockerIds: [cards[1]!.id, cards[2]!.id],
        blockerCards: cards.slice(1, 3),
      };
    case "dice-roll":
      return {
        type: "diceRolled",
        presentation: { ...presentation, title: "Roll two dice" },
        sides: 6,
        rolls: [
          {
            round: 0,
            playerId: me.id,
            naturalResults: [4, 2],
            finalResults: [5, 2],
            ignoredRolls: [1],
            highlighted: false,
          },
        ],
      };
    case "dice-roll-contest":
      return {
        type: "diceRolled",
        presentation: { ...presentation, title: "Roll for first player" },
        sides: 20,
        rolls: [
          {
            label: me.name,
            playerId: me.id,
            round: 0,
            naturalResults: [14],
            finalResults: [14],
            ignoredRolls: [],
            highlighted: false,
          },
          {
            label: targetPlayer.name,
            playerId: targetPlayer.id,
            round: 0,
            naturalResults: [14],
            finalResults: [14],
            ignoredRolls: [],
            highlighted: false,
          },
          {
            label: me.name,
            playerId: me.id,
            round: 1,
            naturalResults: [18],
            finalResults: [18],
            ignoredRolls: [],
            highlighted: true,
          },
          {
            label: targetPlayer.name,
            playerId: targetPlayer.id,
            round: 1,
            naturalResults: [7],
            finalResults: [7],
            ignoredRolls: [],
            highlighted: false,
          },
        ],
      };
    case "game-over":
      return { type: "gameOver" } as PromptInput;
  }
  throw new Error(`Unsupported prompt preview: ${preview}`);
}
