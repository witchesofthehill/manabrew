import { ZoneViewer, SpellStackModal, AbilityPickerModal } from "@/components/game/modals";
import type { StackObjectDto } from "@/protocol/game";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";
import type { ZoneViewerProps } from "@/components/game/modals/ZoneViewer";
import type { StackDialogContext } from "@/components/game/modals/SpellStackModal";
import { useGameStore } from "@/stores/useGameStore";

interface GameOverlaysProps {
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

export function GameOverlays({
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
}: GameOverlaysProps) {
  const pending = useGameStore((s) => s.isWaitingForResponse);
  const error = useGameStore((s) =>
    s.debugInfo.startsWith("Respond error:") ? s.debugInfo : undefined,
  );
  return (
    <>
      {viewingZone && <ZoneViewer {...viewingZone} onClose={onCloseZone} />}

      {spellStackModalOpen && (
        <SpellStackModal
          {...stackContext}
          stack={stack}
          validSpellIds={validSpellIds}
          onTarget={onTargetSpell}
          onCancel={onCloseStack}
          playerColorMap={playerColorMap}
        />
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
