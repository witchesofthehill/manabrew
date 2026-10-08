import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LimitedBuildSaveActions } from "@/components/limited/LimitedBuildSaveActions";
import {
  LimitedBuildDialogs,
  type LimitedBuildDialog,
} from "@/components/limited/LimitedBuildDialogs";
import type { LimitedReferenceFormat } from "@/components/limited/LimitedSetReference";
import { exportToArena } from "@/components/editor/deckExport";
import { useLimitedBuildStore, type BuildSession } from "@/components/limited/useLimitedBuildStore";
import { resolveDeckCards } from "@/lib/limited.utils";
import type { DraftCard } from "@/types/limited";
import type { DeckFormat } from "@/protocol/deck";

type BuildDeck = { main: DraftCard[]; sideboard: DraftCard[] };
interface Props {
  sessionKey: string;
  session: BuildSession;
  deck: BuildDeck;
  shortTouch: boolean;
  suggestedMain?: DraftCard[];
  suggestedSideboard?: DraftCard[];
  defaultDeckName: string;
  targetMainSize: number;
  requireCompleteToSave: boolean;
  format: DeckFormat;
  onSaved?: (deckName: string) => void;
  onConfirm?: (deck: BuildDeck) => void;
  confirmLabel: string;
  reviewSessionId?: string;
  referenceFormat?: LimitedReferenceFormat;
}
export function LimitedBuildActions({
  sessionKey,
  session,
  deck,
  shortTouch,
  suggestedMain,
  suggestedSideboard,
  defaultDeckName,
  targetMainSize,
  requireCompleteToSave,
  format,
  onSaved,
  onConfirm,
  confirmLabel,
  reviewSessionId = sessionKey,
  referenceFormat,
}: Props) {
  const [dialog, setDialog] = useState<LimitedBuildDialog | null>(null);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const copy = async () => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      const [cards, sideboard] = await Promise.all([
        resolveDeckCards(deck.main),
        resolveDeckCards(deck.sideboard),
      ]);
      await navigator.clipboard.writeText(
        exportToArena({ name: defaultDeckName, cards, sideboard }),
      );
      toast.success("Deck copied to clipboard.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't copy the deck.");
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  };
  return (
    <>
      <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-1 [&>button]:shrink-0">
        <span
          className="mr-1 whitespace-nowrap px-2 text-xs tabular-nums text-foreground"
          title={`${
            deck.main.length < targetMainSize
              ? `${targetMainSize - deck.main.length} more mainboard cards needed`
              : "Ready to play"
          }. Exported sideboard includes Pool and Maybeboard: ${deck.sideboard.length} cards.`}
        >
          Mainboard {deck.main.length}/{targetMainSize}+ · Sideboard{" "}
          {session.allocation.sideboardIds.length}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!session.undo.length}
          onClick={() => useLimitedBuildStore.getState().undo(sessionKey)}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!session.redo.length}
          onClick={() => useLimitedBuildStore.getState().redo(sessionKey)}
        >
          Redo
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0">
              {shortTouch ? "Tools" : "Build tools"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setDialog("basics")}>
              Add basic lands
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("mana")}>Suggest lands</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("builds")}>Named builds</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("compare")}>
              Compare saved builds
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setDialog("hand")}
              disabled={!deck.main.length && !session.builds.some((build) => build.mainIds.length)}
            >
              Test hand
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("reference")}>
              Set reference
            </DropdownMenuItem>
            {format === "draft" && (
              <DropdownMenuItem onSelect={() => setDialog("review")}>Draft review</DropdownMenuItem>
            )}
            {!!suggestedMain?.length && (
              <DropdownMenuItem
                onSelect={() =>
                  useLimitedBuildStore
                    .getState()
                    .suggest(sessionKey, suggestedMain, suggestedSideboard ?? [])
                }
              >
                Use suggested build
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={copying || (!deck.main.length && !deck.sideboard.length)}
              onSelect={() => void copy()}
            >
              {copying ? "Copying..." : "Copy decklist"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                session.allocation.sideboardIds.length === deck.main.length + deck.sideboard.length
              }
              onSelect={() =>
                useLimitedBuildStore.getState().move(
                  sessionKey,
                  [...session.pool, ...session.allocation.basics].map((card) => card.id),
                  "sideboard",
                )
              }
            >
              Move all to Sideboard
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <LimitedBuildSaveActions
          deck={deck}
          defaultDeckName={defaultDeckName}
          targetMainSize={targetMainSize}
          requireCompleteToSave={requireCompleteToSave}
          format={format}
          onSaved={onSaved}
        />
        {onConfirm && (
          <Button
            variant="primary"
            size="sm"
            className="shrink-0"
            disabled={deck.main.length < targetMainSize}
            onClick={() => onConfirm(deck)}
          >
            {confirmLabel}
          </Button>
        )}
      </div>
      <LimitedBuildDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        sessionKey={sessionKey}
        session={session}
        deck={deck}
        targetMainSize={targetMainSize}
        reviewSessionId={reviewSessionId}
        referenceFormat={referenceFormat}
      />
    </>
  );
}
