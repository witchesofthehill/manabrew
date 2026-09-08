import { GameOverlays } from "@/components/game/GameOverlays";
import type { StackObjectDto } from "@/protocol/game";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";
import type { ZoneViewerProps } from "@/components/game/modals/ZoneViewer";
import type { StackDialogContext } from "@/components/game/modals/SpellStackModal";

interface GameModalsProps {
  viewingZone: Omit<ZoneViewerProps, "onClose"> | null;
  onCloseZone: () => void;
  spellStackModalOpen: boolean;
  stackContext: StackDialogContext;
  stack: StackObjectDto[];
  validSpellIds: string[];
  onTargetSpell: (spellId: string) => void;
  onCloseStack: () => void;
  playerColorMap?: Map<string, string>;
  abilityPickerState: AbilityPickerState | null;
  onSelectAbility: (ability: HandActionOption) => void;
  onCancelAbilityPicker: () => void;
}

export function GameModals({
  viewingZone,
  onCloseZone,
  spellStackModalOpen,
  stackContext,
  stack,
  validSpellIds,
  onTargetSpell,
  onCloseStack,
  playerColorMap,
  abilityPickerState,
  onSelectAbility,
  onCancelAbilityPicker,
}: GameModalsProps) {
  return (
    <>
      <GameOverlays
        viewingZone={viewingZone}
        onCloseZone={onCloseZone}
        spellStackModalOpen={spellStackModalOpen}
        stackContext={stackContext}
        stack={stack}
        validSpellIds={validSpellIds}
        onTargetSpell={onTargetSpell}
        onCloseStack={onCloseStack}
        playerColorMap={playerColorMap}
        abilityPickerState={abilityPickerState}
        onSelectAbility={onSelectAbility}
        onCancelAbilityPicker={onCancelAbilityPicker}
      />
    </>
  );
}
