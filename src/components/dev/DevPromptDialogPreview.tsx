import { PromptModalChromeContext } from "@/components/game/modals/promptModalChrome.context";

import type { DevDialogPreview } from "./promptDialogPreviews";
import { BattlefieldDialogPreview } from "./promptDialogs/BattlefieldDialogPreview";
import { PromptModalPreview } from "./promptDialogs/PromptModalPreview";
import { useDevDialogFixtures } from "./promptDialogs/useDevDialogFixtures";

interface DevPromptDialogPreviewProps {
  preview: DevDialogPreview;
  onClose: () => void;
}

const PROMPT_DIALOG_PREVIEWS = new Set<DevDialogPreview>([
  "choose-boolean",
  "choose-color",
  "choose-colors",
  "choose-number-buttons",
  "choose-number-input",
  "choose-cards",
  "reveal-cards",
  "scry",
  "reorder",
  "choose-selection",
  "assign-combat-damage",
  "damage-order",
  "dice-roll",
  "dice-roll-contest",
]);

export function DevPromptDialogPreview({ preview, onClose }: DevPromptDialogPreviewProps) {
  const fixtures = useDevDialogFixtures();
  if (!fixtures) return null;

  return PROMPT_DIALOG_PREVIEWS.has(preview) ? (
    <PromptModalChromeContext.Provider value={{ showMinimize: true, onMinimize: onClose }}>
      <PromptModalPreview preview={preview} fixtures={fixtures} onClose={onClose} />
    </PromptModalChromeContext.Provider>
  ) : (
    <BattlefieldDialogPreview preview={preview} fixtures={fixtures} onClose={onClose} />
  );
}
