import { Button } from "@/components/ui/button";
import {
  GAMEPLAY_PREVIEW_ACTIONS,
  type GameplayPreviewAction,
  type GameplayPreviewModal,
} from "./boardGameplayPreview.data";

interface BoardGameplayPreviewControlsProps {
  mode: GameplayPreviewAction;
  onModeChange: (mode: GameplayPreviewAction) => void;
  modalOpen: boolean;
  modalHidden: boolean;
  onOpenModal: (kind: GameplayPreviewModal) => void;
  onCloseModal: () => void;
  onShowModal: () => void;
  stackVisible: boolean;
  onToggleStack: () => void;
  outcome: string;
}

export function BoardGameplayPreviewControls({
  mode,
  onModeChange,
  modalOpen,
  modalHidden,
  onOpenModal,
  onCloseModal,
  onShowModal,
  stackVisible,
  onToggleStack,
  outcome,
}: BoardGameplayPreviewControlsProps) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label="Gameplay action preview"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as GameplayPreviewAction)}
          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
        >
          {GAMEPLAY_PREVIEW_ACTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant={stackVisible ? "secondary" : "outline"}
          onClick={onToggleStack}
          aria-pressed={stackVisible}
        >
          Stack
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpenModal("choose-cards")}>
          Card choice
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpenModal("scry")}>
          Scry
        </Button>
        {modalOpen && (
          <Button size="sm" variant="outline" onClick={onCloseModal}>
            Close prompt
          </Button>
        )}
        {modalHidden && (
          <Button size="sm" onClick={onShowModal}>
            Show prompt
          </Button>
        )}
      </div>
      {outcome && (
        <p role="status" className="max-h-10 overflow-y-auto text-xs text-muted-foreground">
          {outcome}
        </p>
      )}
    </div>
  );
}
