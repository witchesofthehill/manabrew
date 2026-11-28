import type { ReactElement } from "react";
import { Label } from "@/components/ui/label";
import { GAME_FORMATS } from "@/lib/formats";
import { FormatBadge } from "@/components/game/FormatBadge";
import { cn } from "@/lib/utils";
import { Loader2, Shuffle, Swords } from "lucide-react";
import type { Deck } from "@/protocol/deck";
import type { EngineKind, PlayerDeckInfo } from "@/protocol";
import { useDeckSelection, type CommanderImportOptions } from "./useDeckSelection";
import { DeckPickerDialog } from "./DeckPickerDialog";
import { DeckSelectionList } from "./DeckSelectionList";
import { DeckSelectionCommander } from "./DeckSelectionCommander";
interface CreateGameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  mode?: "play" | "lobby";
  engineKind?: EngineKind;
  forcedFormatId?: string;
  commanderImport?: CommanderImportOptions;
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  preSelectedDeck?: PlayerDeckInfo;
  rematch?: boolean;
  target?: "player" | "bot";
  onStart: (
    deck: Deck,
    formatId: string,
    commanderName?: string,
    playerCount?: number,
    publishedDeckId?: string,
  ) => void | Promise<void>;
}
export function CreateGameDialog({
  open,
  onOpenChange,
  trigger,
  mode = "play",
  engineKind,
  forcedFormatId,
  commanderImport,
  preSelectedDeckId,
  preSelectedHubDeckId,
  preSelectedDeck,
  rematch = false,
  target = "player",
  onStart,
}: CreateGameDialogProps) {
  const model = useDeckSelection({
    open,
    onOpenChange,
    mode,
    engineKind,
    forcedFormatId,
    commanderImport,
    preSelectedDeckId,
    preSelectedHubDeckId,
    preSelectedDeck,
    target,
    onStart,
  });
  const isLobbyMode = mode === "lobby";
  const {
    selectedFormat,
    setSelectedFormat,
    playerCount,
    setPlayerCount,
    selectedDeckEntry,
    selectedDeckValidation,
    isReady,
    starting,
    handleCreate,
    handleOpenChange,
    invalidateHubSelection,
  } = model;
  return (
    <DeckPickerDialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={trigger}
      title={target === "bot" ? "Choose Bot Deck" : isLobbyMode ? "Choose Deck" : "New Game"}
      description={
        commanderImport
          ? "Choose a deck to fill the commander slots."
          : rematch
            ? "Choose your deck for the next game. Other players keep their own selections."
            : target === "bot"
              ? "Select the deck the AI will play in this lobby."
              : isLobbyMode
                ? "Select the deck you will play in this lobby."
                : "Pick a deck and battle a random AI opponent"
      }
      selection={
        selectedDeckEntry &&
        (!isLobbyMode ? (
          <>
            <span className="text-muted-foreground shrink-0">Playing</span>
            <span className="font-medium break-words">{selectedDeckEntry.name}</span>
            <span className="text-muted-foreground shrink-0">vs</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0">
              <Shuffle className="h-3 w-3" />
              Random AI
            </span>
          </>
        ) : (
          <div className="min-w-0">
            <span className="block break-words text-ui-label text-muted-foreground">
              Selected:{" "}
              <span className="font-medium text-foreground">{selectedDeckEntry.name}</span>
            </span>
            {!selectedDeckValidation.legal && (
              <span className="block break-words text-ui-meta text-warning">
                {selectedDeckValidation.errors[0] ?? "This deck is not legal in the room format."}
              </span>
            )}
          </div>
        ))
      }
      confirmLabel={
        starting
          ? "Selecting…"
          : rematch
            ? "Ready with this deck"
            : isLobbyMode
              ? "Select Deck"
              : "Play"
      }
      confirmIcon={
        starting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          !isLobbyMode && <Swords className="h-3.5 w-3.5" />
        )
      }
      canConfirm={isReady && !starting}
      onConfirm={() => void handleCreate()}
    >
      <div className="flex min-h-0 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
        {!isLobbyMode && (
          <div className="w-full sm:w-48 border-b sm:border-b-0 sm:border-r flex-shrink-0 p-4 space-y-5 sm:overflow-y-auto bg-muted/20">
            <div>
              <SectionLabel>Format</SectionLabel>
              <div className="mt-2 space-y-2">
                {GAME_FORMATS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    onClick={() => {
                      invalidateHubSelection();
                      setSelectedFormat(format);
                    }}
                    className={cn(
                      "w-full rounded-lg border p-2.5 text-left transition-colors touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal",
                      selectedFormat.id === format.id
                        ? "border-selection-border bg-selection"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <div className="mb-1">
                      <FormatBadge formatId={format.id} />
                    </div>
                    <p className="font-medium text-ui-label">{format.name}</p>
                    <p className="text-ui-body text-muted-foreground mt-0.5 leading-tight">
                      {format.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Rules</SectionLabel>
              <div className="mt-2 space-y-1.5">
                <RulePill
                  label={`Deck`}
                  value={
                    selectedFormat.deckRules.minDeckSize +
                    (selectedFormat.deckRules.maxDeckSize
                      ? `–${selectedFormat.deckRules.maxDeckSize}`
                      : "+") +
                    " cards"
                  }
                />
                <RulePill
                  label={`Copies`}
                  value={
                    selectedFormat.deckRules.maxCopies === 1
                      ? "Singleton"
                      : `Max ${selectedFormat.deckRules.maxCopies}`
                  }
                />
                <RulePill label={`Life`} value={`${selectedFormat.deckRules.startingLife}`} />
              </div>
            </div>

            <DeckSelectionCommander model={model} />

            <div>
              <SectionLabel>
                Opponents
                <span className="ml-1 text-ui-meta font-mono text-warning bg-warning/10 px-1 rounded">
                  DEV
                </span>
              </SectionLabel>
              <div className="mt-2 flex gap-1">
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setPlayerCount(count)}
                    className={cn(
                      "flex-1 py-1 rounded border text-ui-label transition-colors touch:min-h-11 touch:min-w-11 whitespace-normal",
                      playerCount === count
                        ? "border-warning bg-warning/10 text-warning font-semibold"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    {count - 1}v1
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex min-h-64 flex-1 flex-col sm:min-h-0">
          {isLobbyMode && (
            <div className="px-4 pt-3">
              <DeckSelectionCommander model={model} />
            </div>
          )}
          <DeckSelectionList model={model} />
        </div>
      </div>
    </DeckPickerDialog>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-ui-label uppercase tracking-wider text-muted-foreground font-semibold">
      {children}
    </Label>
  );
}
function RulePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-ui-meta">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
