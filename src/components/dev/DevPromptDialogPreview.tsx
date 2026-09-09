import type { CardDto } from "@/protocol/game";

import type { DevDialogPreview } from "./promptDialogPreviews";
import { BattlefieldDialogPreview } from "./promptDialogs/BattlefieldDialogPreview";
import { PromptModalPreview } from "./promptDialogs/PromptModalPreview";
import { useDevDialogFixtures } from "./promptDialogs/useDevDialogFixtures";

interface DevPromptDialogPreviewProps {
  preview: DevDialogPreview;
  cards?: CardDto[];
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
  "scry-landscape",
  "scry-double-sided",
  "scry-mixed",
  "reorder",
  "choose-selection",
  "assign-combat-damage",
  "damage-order",
  "dice-roll",
  "dice-roll-contest",
  "game-over",
]);

export function DevPromptDialogPreview({ preview, cards, onClose }: DevPromptDialogPreviewProps) {
  const fixtures = useDevDialogFixtures(cards);
  if (!fixtures) return null;

  return PROMPT_DIALOG_PREVIEWS.has(preview) ? (
    <PromptModalPreview preview={preview} fixtures={fixtures} onClose={onClose} />
  ) : (
    <BattlefieldDialogPreview preview={preview} fixtures={fixtures} onClose={onClose} />
  );
}
