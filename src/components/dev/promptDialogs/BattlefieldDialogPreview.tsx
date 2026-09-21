import { PlayModePicker } from "@/components/game/PlayModePicker";
import { CombatBreakdownModal } from "@/components/game/modals/CombatBreakdownModal";
import {
  AbilityPickerModal,
  ConcedeGameModal,
  EliminatedModal,
  GameSettingsModal,
  LeaveGameModal,
  ZoneViewer,
} from "@/components/game/modals";
import { PlayerSheetModal } from "@/components/game/panels/PlayerSheetModal";

import type { DevDialogPreview } from "../promptDialogPreviews";
import { ABILITY_OPTIONS, PLAY_OPTIONS, type DevDialogFixtures } from "./useDevDialogFixtures";

interface BattlefieldDialogPreviewProps {
  preview: DevDialogPreview;
  fixtures: DevDialogFixtures;
  onClose: () => void;
}

export function BattlefieldDialogPreview({
  preview,
  fixtures,
  onClose,
}: BattlefieldDialogPreviewProps) {
  const { cards, sourceCard, cardById, playerSpec } = fixtures;

  switch (preview) {
    case "ability-picker":
      return (
        <AbilityPickerModal
          sourceCard={sourceCard}
          abilities={ABILITY_OPTIONS}
          onSelect={onClose}
          onCancel={onClose}
        />
      );
    case "play-mode-picker":
      return (
        <PlayModePicker
          card={sourceCard}
          options={PLAY_OPTIONS}
          onSelect={onClose}
          onCancel={onClose}
        />
      );
    case "zone-viewer":
      return (
        <ZoneViewer
          title="Choose a card from your graveyard"
          cards={cards}
          mode="target"
          onClose={onClose}
          onClickCard={onClose}
          clickableCardIds={cards.slice(0, 2).map((card) => card.id)}
          selectedCardIds={[cards[0].id]}
          clickLabel="SELECT"
          selectedLabel="SELECTED"
          targetHostile={false}
        />
      );
    case "board-settings":
      return <GameSettingsModal onClose={onClose} />;
    case "concede-game":
      return <ConcedeGameModal onConfirm={onClose} onCancel={onClose} />;
    case "leave-game":
      return <LeaveGameModal onStay={onClose} onLeave={onClose} />;
    case "eliminated-player":
      return (
        <EliminatedModal heading="You lost" hosting={false} onObserve={onClose} onLeave={onClose} />
      );
    case "eliminated-host":
      return (
        <EliminatedModal heading="You conceded" hosting onObserve={onClose} onLeave={onClose} />
      );
    case "player-details":
      return <PlayerSheetModal spec={playerSpec} onClose={onClose} />;
    case "combat-summary":
      return (
        <CombatBreakdownModal
          attackerIds={[cards[0].id, cards[2].id]}
          blockAssignments={[{ attackerId: cards[0].id, blockerId: cards[1].id }]}
          resolveCardName={(cardId) => cardById.get(cardId)?.identity.name ?? cardId}
          resolveCard={(cardId) => cardById.get(cardId)}
          defenderLife={12}
          onClose={onClose}
        />
      );
    default:
      return null;
  }
}
