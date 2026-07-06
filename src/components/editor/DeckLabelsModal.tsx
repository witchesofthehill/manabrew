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

const SUGGESTED_LABELS = [
  "Aggro",
  "Midrange",
  "Control",
  "Combo",
  "Tempo",
  "Ramp",
  "Tokens",
  "Tribal",
  "Mill",
  "Burn",
  "Voltron",
  "Stax",
  "Budget",
  "Competitive",
  "Casual",
  "Jank",
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
    toast.success(`Label "${trimmed}" added`);
  }

  const unusedSuggestions = SUGGESTED_LABELS.filter(
    (s) => !labels.some((l) => l.name.toLowerCase() === s.toLowerCase()),
  );

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" maxHeight="max-h-[70dvh]">
      <Modal.Header onClose={onClose}>
        <h2 className="text-lg font-bold">Deck Labels</h2>
      </Modal.Header>

      <Modal.Body>
        <div className="space-y-4">
          {/* Current labels */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2">Current Labels</div>
            {labels.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No labels yet</p>
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
                      title="Pick color"
                    />
                    <button
                      type="button"
                      className="hover:text-destructive transition-colors text-muted-foreground"
                      onClick={() => {
                        removeDeckLabel(label.name);
                        saveCurrentDeck();
                        toast.success(`Label "${label.name}" removed`);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add custom label */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2">Add Custom Label</div>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-sm flex-1"
                placeholder="Type a label…"
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
                title="Pick color"
              />
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={!newLabel.trim()}
                onClick={() => handleAdd(newLabel, newLabelColor || undefined)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>

          {/* Suggestions */}
          {unusedSuggestions.length > 0 && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">Suggestions</div>
              <div className="flex flex-wrap gap-1.5">
                {unusedSuggestions.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    className="cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => handleAdd(s)}
                  >
                    <Plus className="h-2.5 w-2.5 mr-0.5" />
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
