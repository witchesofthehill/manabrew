import { useState, type ReactNode } from "react";

import { DiceRollFeedback } from "@/components/game/dice";
import { ChooseBooleanModal } from "@/components/prompts/ChooseBooleanModal";
import { ChooseCardsModal } from "@/components/prompts/ChooseCardsModal";
import { ChooseColorModal } from "@/components/prompts/ChooseColorModal";
import { ChooseFromSelectionModal } from "@/components/prompts/ChooseFromSelectionModal";
import { ChooseNumberModal } from "@/components/prompts/ChooseNumberModal";
import { DamageOrderModal } from "@/components/prompts/DamageOrderModal";
import { ReorderCardsModal } from "@/components/prompts/ReorderCardsModal";
import { ScryModal } from "@/components/prompts/ScryModal";
import { VAssignCombatDamageModal } from "@/components/prompts/VAssignCombatDamageModal";
import type { CardDto } from "@/protocol/game";

import type { DevDialogPreview } from "../promptDialogPreviews";
import type { DevDialogFixtures } from "./useDevDialogFixtures";

interface PromptModalPreviewProps {
  preview: DevDialogPreview;
  fixtures: DevDialogFixtures;
  onClose: () => void;
}

function DamageOrderPreview({ cards, onClose }: { cards: CardDto[]; onClose: () => void }) {
  const [order, setOrder] = useState<string[]>([]);
  const blockers = cards.slice(1, 3);
  const toggle = (cardId: string) =>
    setOrder((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
    );

  return (
    <DamageOrderModal
      attackerName={cards[0].identity.name}
      blockerCards={blockers}
      order={order}
      isWaiting={false}
      onToggle={toggle}
      onUndo={() => setOrder((current) => current.slice(0, -1))}
      onAuto={() => setOrder(blockers.map((card) => card.id))}
      onConfirm={onClose}
    />
  );
}

export function PromptModalPreview({ preview, fixtures, onClose }: PromptModalPreviewProps) {
  const { gameView, cards, sourceCard, me, targetPlayer, presentation } = fixtures;
  const closeOnResponse = () => onClose();
  let content: ReactNode = null;

  switch (preview) {
    case "choose-boolean":
      content = (
        <ChooseBooleanModal
          input={{ presentation, confirmLabel: "Create the token", denyLabel: "Decline" }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "choose-color":
      content = (
        <ChooseColorModal
          input={{
            presentation,
            validColors: ["W", "U", "B", "R", "G"],
            amount: 1,
            repeatAllowed: false,
          }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "choose-colors":
      content = (
        <ChooseColorModal
          input={{
            presentation,
            validColors: ["W", "U", "B", "R", "G"],
            amount: 3,
            repeatAllowed: true,
          }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "choose-number-buttons":
    case "choose-number-input":
      content = (
        <ChooseNumberModal
          input={{ presentation, min: 0, max: preview === "choose-number-buttons" ? 5 : 99 }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "choose-cards":
    case "reveal-cards":
      content = (
        <ChooseCardsModal
          cards={cards}
          presentation={
            preview === "reveal-cards" ? { ...presentation, title: "Revealed cards" } : presentation
          }
          min={preview === "reveal-cards" ? 0 : 1}
          max={preview === "reveal-cards" ? 0 : 2}
          sourceCard={sourceCard}
          reveal={preview === "reveal-cards"}
          onConfirm={closeOnResponse}
        />
      );
      break;
    case "scry":
      content = (
        <ScryModal
          input={{
            presentation: { ...presentation, title: "Scry 3" },
            cards,
            zones: ["libraryTop", "libraryBottom", "graveyard"],
          }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "reorder":
      content = (
        <ReorderCardsModal
          input={{
            presentation: { ...presentation, title: "Choose the trigger order" },
            items: cards.map((card, index) => ({
              id: card.id,
              card,
              oracle: `Triggered ability ${index + 1}`,
            })),
          }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "choose-selection":
      content = (
        <ChooseFromSelectionModal
          input={{
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
          }}
          respond={closeOnResponse}
          sourceCard={sourceCard}
        />
      );
      break;
    case "assign-combat-damage":
      content = (
        <VAssignCombatDamageModal
          input={{
            attackerId: cards[0].id,
            blockerIds: [cards[1].id, cards[2].id],
            defenderId: targetPlayer.id,
            totalDamage: 7,
            attackerHasDeathtouch: false,
          }}
          respond={closeOnResponse}
        />
      );
      break;
    case "damage-order":
      content = <DamageOrderPreview cards={cards} onClose={onClose} />;
      break;
    case "dice-roll":
      content = (
        <DiceRollFeedback
          sides={20}
          rolls={[
            { naturalResults: [17], finalResults: [17], ignoredRolls: [], highlighted: false },
          ]}
          players={gameView.players.map((player) => ({ id: player.id, isHuman: player.isHuman }))}
          sourceCard={sourceCard}
          onAcknowledge={onClose}
        />
      );
      break;
    case "dice-roll-contest":
      content = (
        <DiceRollFeedback
          sides={20}
          title="Choose the starting player"
          rolls={[
            {
              label: me.name,
              playerId: me.id,
              naturalResults: [14],
              finalResults: [14],
              ignoredRolls: [],
              highlighted: true,
            },
            {
              label: targetPlayer.name,
              playerId: targetPlayer.id,
              naturalResults: [9],
              finalResults: [9],
              ignoredRolls: [],
              highlighted: false,
            },
          ]}
          players={gameView.players.map((player) => ({ id: player.id, isHuman: player.isHuman }))}
          onAcknowledge={onClose}
        />
      );
      break;
  }

  return content;
}
