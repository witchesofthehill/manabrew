import type { CardChoiceDto, CardDto, ManaColor, StackObjectDto } from "@/protocol/game";
import type { CardRulesSummary } from "@/types/manabrew";
import type { AvailableAction, PaymentAction } from "@/protocol/prompts/common";
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { ManaAbilityActionInfo } from "@/components/game/manaUtils";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { PROMPT_LABELS } from "./game.constants";

const MANA_COLOR_LABEL: Record<ManaColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

export function isPermanentSpellCard(card: Pick<CardDto, "types">): boolean {
  return !card.types.includes("Instant") && !card.types.includes("Sorcery");
}

export function manaAbilityInfos(
  actions: Array<AvailableAction | PaymentAction>,
): ManaAbilityActionInfo[] {
  return actions.flatMap((a) =>
    a.type === "activateManaAbility" || (a.type === "activateAbility" && a.isManaAbility)
      ? [
          {
            cardId: a.cardId,
            abilityIndex: a.abilityIndex,
            description: a.description,
            isManaAbility: true,
            isClassLevelUp: false,
            cost: a.cost,
            producedMana: a.producedMana,
            actionId: a.id,
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

export function isCreature(card: Pick<CardRulesSummary, "types">): boolean {
  return card.types?.some((t) => t.toLowerCase() === "creature") ?? false;
}

export function isLethalDamage(card: CardDto, queuedDamage = 0): boolean {
  if (!card.toughness) return false;
  const total = (card.damage ?? 0) + queuedDamage;
  if (total <= 0) return false;
  const toughness = parseInt(card.toughness, 10);
  return !isNaN(toughness) && total >= toughness;
}

export type ScryfallImageSize = "small" | "normal" | "large" | "png" | "border_crop" | "art_crop";

/** CardDto view of a stack-resident source for rendering. Owner/controller
 *  come from the StackObjectDto; printing identity comes from the wire so
 *  `asDeckCard` can resolve the image. */
export function stackObjectToCardStub(obj: StackObjectDto): ClientCardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id: obj.sourceId,
    identity: obj.identity,
    text: obj.text,
    controllerId: obj.controllerId,
    ownerId: obj.ownerId,
    zoneId: "stack",
    isDoubleFaced: obj.isDoubleFaced,
    isTransformed: obj.faceIndex === 1,
  };
}

export function getPreviewActionShortcut(
  index: number,
  classLevelUpIndex: number | null,
  classLevel: number | null,
): number {
  if (classLevel !== null && index === classLevelUpIndex) return classLevel;
  const actionPosition =
    index - (classLevelUpIndex !== null && classLevelUpIndex < index ? 1 : 0) + 1;
  return classLevel !== null && actionPosition >= classLevel ? actionPosition + 1 : actionPosition;
}

export interface CardChoiceIndicator {
  key: string;
  kind: CardChoiceDto["kind"];
  label: string;
  description: string;
  colors: ManaColor[];
}

export function firstChosenColor(card: Pick<CardDto, "choices">): ManaColor | null {
  for (const choice of card.choices ?? []) {
    if (choice.kind === "color") return choice.colors[0] ?? null;
  }
  return null;
}

export function deriveCardChoiceIndicators(card: Pick<CardDto, "choices">): CardChoiceIndicator[] {
  return (card.choices ?? []).map((choice, index) => {
    switch (choice.kind) {
      case "color": {
        const label = choice.colors.map((color) => MANA_COLOR_LABEL[color]).join(" / ");
        return {
          key: `color-${index}`,
          kind: choice.kind,
          label,
          description: `Chosen color: ${label}`,
          colors: choice.colors,
        };
      }
      case "type": {
        const label = choice.values.join(", ");
        return {
          key: `type-${index}`,
          kind: choice.kind,
          label,
          description: `Chosen type: ${label}`,
          colors: [],
        };
      }
      case "namedCard": {
        const label = choice.names.join(", ");
        return {
          key: `named-card-${index}`,
          kind: choice.kind,
          label,
          description: `Named card: ${label}`,
          colors: [],
        };
      }
      case "chosenCard": {
        const label = `${choice.count} ${choice.count === 1 ? "card" : "cards"}`;
        return {
          key: `chosen-card-${index}`,
          kind: choice.kind,
          label,
          description: `Chosen cards: ${choice.count}`,
          colors: [],
        };
      }
      case "number":
        return {
          key: `number-${index}`,
          kind: choice.kind,
          label: `#${choice.value}`,
          description: `Chosen number: ${choice.value}`,
          colors: [],
        };
      case "mode":
        return {
          key: `mode-${index}`,
          kind: choice.kind,
          label: choice.value,
          description: `Chosen mode: ${choice.value}`,
          colors: [],
        };
      case "player":
        return {
          key: `player-${choice.playerId}`,
          kind: choice.kind,
          label: choice.name,
          description: `Chosen player: ${choice.name}`,
          colors: [],
        };
    }
  });
}
