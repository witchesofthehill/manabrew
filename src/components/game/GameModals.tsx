import { GameOverlays } from "@/components/game/GameOverlays";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";
import type { ZoneViewerProps } from "@/components/game/modals/ZoneViewer";

interface GameModalsProps {
  viewingZone: Omit<ZoneViewerProps, "onClose"> | null;
  onCloseZone: () => void;
  abilityPickerState: AbilityPickerState | null;
  onSelectAbility: (ability: HandActionOption) => void;
  onCancelAbilityPicker: () => void;
}

export function GameModals({
  viewingZone,
  onCloseZone,
  abilityPickerState,
  onSelectAbility,
  onCancelAbilityPicker,
}: GameModalsProps) {
  return (
    <>
      <GameOverlays
        viewingZone={viewingZone}
        onCloseZone={onCloseZone}
        abilityPickerState={abilityPickerState}
        onSelectAbility={onSelectAbility}
        onCancelAbilityPicker={onCancelAbilityPicker}
      />
    </>
  );
}
