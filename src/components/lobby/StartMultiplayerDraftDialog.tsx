import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { startDraftAsHost, type DraftHostParticipant } from "@/game/draftHost";
import type { MpDraftConfig } from "@/game/draftRelay";
import { cn } from "@/lib/utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useServerStore } from "@/stores/useServerStore";

interface StartMultiplayerDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StartMultiplayerDraftDialog({
  open,
  onOpenChange,
}: StartMultiplayerDraftDialogProps) {
  const currentRoom = useServerStore((s) => s.currentRoom);
  const username = useServerStore((s) => s.username);
  const allSets = useScryfallStore((s) => s.sets);
  const prefetchSet = useScryfallStore((s) => s.prefetchSet);

  const draftableSets = useMemo(
    () =>
      [...(allSets ?? [])]
        .filter((s) => DRAFTABLE_SET_TYPES.has(s.set_type) && !s.digital && s.card_count > 0)
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "")),
    [allSets],
  );

  const [selectedSet, setSelectedSet] = useState<string>("");
  const [rounds, setRounds] = useState(3);
  const [picksPerPass, setPicksPerPass] = useState(1);
  const [fillWithBots, setFillWithBots] = useState(true);
  const [seedInput, setSeedInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [prefetchingSet, setPrefetchingSet] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedSet("");
      setRounds(3);
      setPicksPerPass(1);
      setFillWithBots(true);
      setSeedInput("");
    }
  }, [open]);

  // Warm the Scryfall card cache for the chosen set so the first pack
  // doesn't render as a wall of skeletons.
  useEffect(() => {
    if (!selectedSet) return;
    let cancelled = false;
    setPrefetchingSet(selectedSet);
    void prefetchSet(selectedSet).finally(() => {
      if (!cancelled) setPrefetchingSet((cur) => (cur === selectedSet ? null : cur));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSet, prefetchSet]);

  const podSize = currentRoom?.max_players ?? 0;
  const humans = currentRoom?.players.length ?? 0;
  const canStart =
    !!selectedSet &&
    !!currentRoom &&
    !!username &&
    !submitting &&
    (fillWithBots ? humans <= podSize : humans === podSize);

  async function handleStart() {
    if (!currentRoom || !username) return;
    setSubmitting(true);
    try {
      const participants: DraftHostParticipant[] = currentRoom.players
        .filter((p) => p.username !== username)
        .map((p) => ({
          // Server stamps `from_player` with the username (see
          // forge-server connection.rs), so seat slots must use
          // username too. Peer side reads it from
          // `useServerStore.username` at AuthResult time.
          playerSlot: p.username,
          displayName: p.username,
        }));
      const config: MpDraftConfig = {
        setCode: selectedSet,
        podSize,
        rounds,
        picksPerPass,
        seed: seedInput ? Number(seedInput) || undefined : undefined,
        fillWithBots,
      };
      const result = await startDraftAsHost({
        roomId: currentRoom.room_id,
        hostSlot: username,
        hostName: username,
        participants,
        config,
      });
      if (!result.ok) {
        toast.error(`Failed to start draft: ${result.error}`);
        return;
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Start Multiplayer Draft
          </DialogTitle>
          <DialogDescription>
            {currentRoom
              ? `Pod size ${podSize}. ${humans} human${humans === 1 ? "" : "s"} ready.`
              : "Not in a room."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {draftableSets.length === 0 ? (
            <p className="flex items-center gap-2 rounded border border-border/40 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading sets from Scryfall…
            </p>
          ) : (
            <SetPicker
              sets={draftableSets}
              selectedCode={selectedSet}
              prefetching={prefetchingSet}
              onSelect={setSelectedSet}
            />
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="draft-rounds">Rounds</Label>
              <Input
                id="draft-rounds"
                type="number"
                min={1}
                max={6}
                value={rounds}
                onChange={(e) => setRounds(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="picks-per-pass">Picks per pass</Label>
              <Input
                id="picks-per-pass"
                type="number"
                min={1}
                max={4}
                value={picksPerPass}
                onChange={(e) =>
                  setPicksPerPass(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-seed">Seed (optional)</Label>
              <Input
                id="draft-seed"
                type="text"
                inputMode="numeric"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="random"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={fillWithBots}
              onChange={(e) => setFillWithBots(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>
              Fill empty seats with AI bots ({podSize - humans} bot
              {podSize - humans === 1 ? "" : "s"})
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={!canStart}
            className={cn("gap-1.5")}
            title={
              !selectedSet
                ? "Pick a set first"
                : !fillWithBots && humans < podSize
                  ? `Need ${podSize - humans} more human(s) or enable bot fill`
                  : undefined
            }
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {submitting ? "Starting…" : "Start Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
