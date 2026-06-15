import type {
  ActivatableAbilityInfo,
  CardRulesSummary,
  GameCard,
  StackObject,
} from "@/types/manabrew";
import type { AvailableAction } from "@/protocol/prompts/chooseAction";
import { PROMPT_LABELS } from "./game.constants";

export function manaAbilityInfos(actions: AvailableAction[]): ActivatableAbilityInfo[] {
  return actions.flatMap((a) =>
    a.type === "activateAbility" && a.isManaAbility
      ? [
          {
            cardId: a.cardId,
            abilityIndex: a.abilityIndex,
            description: a.description,
            isManaAbility: true,
            cost: a.cost,
          },
        ]
      : [],
  );
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getPromptLabel(promptType?: string): string {
  if (!promptType) return "Waiting for your next decision";
  return PROMPT_LABELS[promptType] ?? promptType;
}

export function isCreature(card: CardRulesSummary): boolean {
  return card.types?.some((t) => t.toLowerCase() === "creature") ?? false;
}

export function isLethalDamage(card: GameCard, queuedDamage = 0): boolean {
  if (!card.toughness) return false;
  const total = (card.damage ?? 0) + queuedDamage;
  if (total <= 0) return false;
  const toughness = parseInt(card.toughness, 10);
  return !isNaN(toughness) && total >= toughness;
}

export type ScryfallImageSize = "small" | "normal" | "large" | "png" | "border_crop" | "art_crop";

/** GameCard view of a stack-resident source for rendering. Owner/controller
 *  come from the StackObject; printing identity comes from the wire so
 *  `asDeckCard` can resolve the image. */
export function stackObjectToCardStub(obj: StackObject): GameCard {
  return {
    id: obj.sourceId,
    name: obj.name,
    setCode: obj.setCode,
    cardNumber: obj.cardNumber,
    color: "",
    colorIdentity: [],
    manaCost: "",
    cmc: 0,
    types: [],
    subtypes: [],
    supertypes: [],
    text: obj.text,
    isPlayable: false,
    isSelected: false,
    controllerId: obj.controllerId,
    ownerId: obj.controllerId,
    zoneId: "stack",
  };
}
