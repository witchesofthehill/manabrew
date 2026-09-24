import { ZoneViewer, AbilityPickerModal } from "@/components/game/modals";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";
import type { ZoneViewerProps } from "@/components/game/modals/ZoneViewer";
import { useGameStore } from "@/stores/useGameStore";

interface GameOverlaysProps {
  viewingZone: Omit<ZoneViewerProps, "onClose"> | null;
  onCloseZone: () => void;
  abilityPickerState: AbilityPickerState | null;
  onSelectAbility: (ability: HandActionOption) => void;
  onCancelAbilityPicker: () => void;
  onLongPressCard: NonNullable<ZoneViewerProps["onLongPressCard"]>;
}

export function GameOverlays({
  viewingZone,
  onCloseZone,
  abilityPickerState,
  onSelectAbility,
  onCancelAbilityPicker,
  onLongPressCard,
}: GameOverlaysProps) {
  const pending = useGameStore((s) => s.isWaitingForResponse);
  const error = useGameStore((s) =>
    s.debugInfo.startsWith("Respond error:") ? s.debugInfo : undefined,
  );
  return (
    <>
      {viewingZone && (
        <ZoneViewer {...viewingZone} onClose={onCloseZone} onLongPressCard={onLongPressCard} />
      )}

      {abilityPickerState?.card && (
        <AbilityPickerModal
          sourceCard={abilityPickerState.card}
          liveCard={abilityPickerState.source}
          pending={pending}
          error={error}
          abilities={abilityPickerState.abilities}
          onSelect={onSelectAbility}
          onCancel={onCancelAbilityPicker}
        />
      )}
    </>
  );
}
