import { PromptModalHost } from "@/components/prompts/promptComponents";
// Dev-only prompt previews — uncomment one to summon that prompt in a live game
// and screenshot it. Each has an `EDIT ME` fixture block at the top.
// import { ChooseNumberModalPreview } from "@/components/prompts/dev/ChooseNumberModalPreview";
// import { ChooseCardsModalPreview } from "@/components/prompts/dev/ChooseCardsModalPreview";
// import { ReorderCardsModalPreview } from "@/components/prompts/dev/ReorderCardsModalPreview";
// import { ScryModalPreview } from "@/components/prompts/dev/ScryModalPreview";
// import { ChooseFromSelectionModalPreview } from "@/components/prompts/dev/ChooseFromSelectionModalPreview";
// import { ChooseBooleanModalPreview } from "@/components/prompts/dev/ChooseBooleanModalPreview";
// import { ChooseColorModalPreview } from "@/components/prompts/dev/ChooseColorModalPreview";
// import { RevealCardsModalPreview } from "@/components/prompts/dev/RevealCardsModalPreview";
// import { DiceRolledPreview } from "@/components/prompts/dev/DiceRolledPreview";
// import { VAssignCombatDamagePreview } from "@/components/prompts/dev/VAssignCombatDamagePreview";
import { GameOverlays } from "@/components/game/GameOverlays";
import type { CardDto, StackObjectDto } from "@/protocol/game";
import type { DeckCard } from "@/protocol/deck";
import type { Prompt } from "@/protocol";
import type { AbilityPickerState, HandActionOption } from "@/stores/useGameUIStore";

interface GameModalsProps {
  currentPrompt: Prompt | null;
  sourceDeckCard?: DeckCard;
  viewingZone: {
    title: string;
    cards: CardDto[];
    onClickCard?: (cardId: string) => void;
    clickableCardIds?: string[];
    targetHostile?: boolean;
  } | null;
  onCloseZone: () => void;
  spellStackModalOpen: boolean;
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
  currentPrompt,
  sourceDeckCard,
  viewingZone,
  onCloseZone,
  spellStackModalOpen,
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
      <PromptModalHost currentPrompt={currentPrompt} ctx={{ sourceDeckCard }} />
      {/*{import.meta.env.DEV && <ChooseNumberModalPreview />}*/}
      {/*{import.meta.env.DEV && <ChooseCardsModalPreview />}*/}
      {/*{import.meta.env.DEV && <ReorderCardsModalPreview />}*/}
      {/*{import.meta.env.DEV && <ScryModalPreview />}*/}
      {/*{import.meta.env.DEV && <ChooseFromSelectionModalPreview />}*/}
      {/*{import.meta.env.DEV && <ChooseBooleanModalPreview />}*/}
      {/*{import.meta.env.DEV && <ChooseColorModalPreview />}*/}
      {/*{import.meta.env.DEV && <RevealCardsModalPreview />}*/}
      {/*{import.meta.env.DEV && <DiceRolledPreview />}*/}
      {/*{import.meta.env.DEV && <VAssignCombatDamagePreview />}*/}
      <GameOverlays
        viewingZone={viewingZone}
        onCloseZone={onCloseZone}
        spellStackModalOpen={spellStackModalOpen}
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
