import { useState } from "react";
import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { X, Plus } from "lucide-react";
import { useDeckStore } from "@/stores/useDeckStore";
import { useTheme } from "@/hooks/useTheme";
import { toast } from "sonner";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const SUGGESTED_LABELS = [
  { value: "Aggro", label: msg`Aggro` },
  { value: "Midrange", label: msg`Midrange` },
  { value: "Control", label: msg`Control` },
  { value: "Combo", label: msg`Combo` },
  { value: "Tempo", label: msg`Tempo` },
  { value: "Ramp", label: msg`Ramp` },
  { value: "Tokens", label: msg`Tokens` },
  { value: "Tribal", label: msg`Tribal` },
  { value: "Mill", label: msg`Mill` },
  { value: "Burn", label: msg`Burn` },
  { value: "Voltron", label: msg`Voltron` },
  { value: "Stax", label: msg`Stax` },
  { value: "Budget", label: msg`Budget` },
  { value: "Competitive", label: msg`Competitive` },
  { value: "Casual", label: msg`Casual` },
  { value: "Jank", label: msg`Jank` },
];
interface DeckLabelsModalProps {
  open: boolean;
  onClose: () => void;
}
export function DeckLabelsModal({ open, onClose }: DeckLabelsModalProps) {
  const [newLabel, setNewLabel] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("");
  const { currentDeck, addDeckLabel, removeDeckLabel, updateDeckLabelColor, saveCurrentDeck } =
    useDeckStore();
  const themeColors = useTheme().gameTheme;
  const defaultLabelColor = themeColors.promptAction.cancel;
  const labels = currentDeck.labels ?? [];
  if (!open) return null;
  function handleAdd(label: string, color?: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    addDeckLabel(trimmed, color);
    saveCurrentDeck();
    setNewLabel("");
    setNewLabelColor("");
    toast.success(i18n._(msg`Label "${trimmed}" added`));
  }
  const unusedSuggestions = SUGGESTED_LABELS.filter(
    ({ value }) => !labels.some((label) => label.name.toLowerCase() === value.toLowerCase()),
  );
  return (
    <Modal onClose={onClose} maxWidth="max-w-md" maxHeight="max-h-[70dvh]">
      <Modal.Header onClose={onClose}>
        <h2 className="text-lg font-bold">
          <Trans>Deck Labels</Trans>
        </h2>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2">
              <Trans>Current Labels</Trans>
            </div>
            {labels.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                <Trans>No labels yet</Trans>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {labels.map((label) => (
                  <div key={label.name} className="flex items-center gap-1.5">
                    <DeckLabelBadge label={label} size="md" />
                    <input
                      type="color"
                      value={label.color ?? defaultLabelColor}
                      onChange={(e) => {
                        updateDeckLabelColor(label.name, e.target.value);
                        saveCurrentDeck();
                      }}
                      className="h-6 w-8 rounded border border-input bg-transparent p-0.5 cursor-pointer"
                      title={i18n._(msg`Pick color`)}
                    />
                    <button
                      type="button"
                      className="hover:text-destructive transition-colors text-muted-foreground"
                      onClick={() => {
                        removeDeckLabel(label.name);
                        saveCurrentDeck();
                        toast.success(i18n._(msg`Label "${label.name}" removed`));
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2">
              <Trans>Add Custom Label</Trans>
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-sm flex-1"
                placeholder={i18n._(msg`Type a label\u2026`)}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd(newLabel, newLabelColor || undefined);
                }}
              />
              <input
                type="color"
                value={newLabelColor || defaultLabelColor}
                onChange={(e) => setNewLabelColor(e.target.value)}
                className="h-8 w-10 rounded border border-input bg-transparent p-0.5 cursor-pointer"
                title={i18n._(msg`Pick color`)}
              />
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={!newLabel.trim()}
                onClick={() => handleAdd(newLabel, newLabelColor || undefined)}
              >
                <Trans>
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Trans>
              </Button>
            </div>
          </div>

          {unusedSuggestions.length > 0 && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">
                <Trans>Suggestions</Trans>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unusedSuggestions.map(({ value, label }) => (
                  <Badge
                    key={value}
                    variant="outline"
                    className="cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => handleAdd(value)}
                  >
                    <Plus className="h-2.5 w-2.5 mr-0.5" />
                    {i18n._(label)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <Trans>Done</Trans>
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
