import type { LucideIcon } from "lucide-react";
import { Plus, Minus, Tag } from "lucide-react";
import type React from "react";
import type { GameIconName } from "@/components/game/GameIcon";
import type { DeckCard } from "@/protocol/deck";
import { canBeSignatureSpell } from "@/lib/formats";

export interface CommanderSlot {
  noun: string;
  icon: GameIconName;
}

export const DEFAULT_COMMANDER_SLOT: CommanderSlot = { noun: "commander", icon: "overlord-helm" };

/** What a card's command-zone action is called in this format — Oathbreaker
 *  splits it into the oathbreaker and the signature spell. */
export function commanderSlotFor(card: DeckCard | undefined, deckFormat?: string): CommanderSlot {
  if (deckFormat !== "oathbreaker") return DEFAULT_COMMANDER_SLOT;
  return canBeSignatureSpell(card)
    ? { noun: "signature spell", icon: "scroll-quill" }
    : { noun: "oathbreaker", icon: "overlord-helm" };
}

export interface OverlayAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "primary" | "ghost";
}

/** Build the standard Add + Remove/Untag actions array for card overlays. */
export function buildCardActions(
  onAddOne: () => void,
  onRemoveOne: () => void,
  onUntag?: () => void,
): OverlayAction[] {
  const actions: OverlayAction[] = [
    { label: "Add", icon: Plus, onClick: onAddOne, variant: "primary" },
  ];
  if (onUntag) {
    actions.push({ label: "Untag", icon: Tag, onClick: onUntag });
  } else {
    actions.push({ label: "Remove", icon: Minus, onClick: onRemoveOne });
  }
  return actions;
}

export function handleCardClick(
  e: React.MouseEvent,
  cardName: string,
  onSelect?: (cardName: string, addToSelection: boolean) => void,
  onShowInfo?: () => void,
) {
  e.stopPropagation();
  if (e.shiftKey && onSelect) {
    onSelect(cardName, true);
  } else if (onShowInfo) {
    onShowInfo();
  }
}
