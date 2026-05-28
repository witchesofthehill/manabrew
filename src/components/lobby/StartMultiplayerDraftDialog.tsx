import { useEffect, useMemo, useState } from "react";
import { Cloud, Cpu, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { startDraftAsHost, type DraftHostParticipant } from "@/game/draftHost";
import type { MpDraftConfig } from "@/game/draftRelay";
import { cn } from "@/lib/utils";
import { getPlatform } from "@/platform";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useServerStore } from "@/stores/useServerStore";
import type { GameStartedPayload, ServerErrorPayload } from "@/types/server";

const START_GAME_ACK_TIMEOUT_MS = 5000;

// Server error codes (`forge-server/src/error.rs::ServerError::code`)
// that come from a `StartGame` reaching `start_game_sync` and failing
// validation. Any other `server:error` during the wait window belongs
// to an unrelated client action and must not abort the draft start.
const START_GAME_FAILURE_CODES = new Set([
  "format_not_chosen",
  "deck_not_selected",
  "not_host",
  "players_not_ready",
  "game_already_started",
  "room_not_found",
  "not_in_room",
]);

function awaitGameStartedAck(roomId: string): Promise<void> {
  const events = getPlatform().events;
  return new Promise((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    const cleanup = () => unsubs.forEach((fn) => fn());
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("server did not acknowledge StartGame in time"));
    }, START_GAME_ACK_TIMEOUT_MS);
    unsubs.push(
      events.on<GameStartedPayload>("server:game_started", (payload) => {
        if (payload.room_id !== roomId) return;
        clearTimeout(timeout);
        cleanup();
        resolve();
      }),
    );
    unsubs.push(
      events.on<ServerErrorPayload>("server:error", (payload) => {
        if (!START_GAME_FAILURE_CODES.has(payload.code)) return;
        clearTimeout(timeout);
        cleanup();
        reject(new Error(payload.message || payload.code));
      }),
    );
  });
}

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
  const serverStartGame = useServerStore((s) => s.startGame);
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
      // `Number("0") || undefined` collapses an explicit `0` seed to
      // undefined; use `Number.isFinite` so seed `0` round-trips as
      // a valid seed instead of silently becoming random.
      const parsedSeed = seedInput.trim() ? Number(seedInput) : NaN;
      const config: MpDraftConfig = {
        setCode: selectedSet,
        podSize,
        rounds,
        picksPerPass,
        seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
        fillWithBots,
      };
      // Flip room to `Draft` server-side, then wait for the ack
      // before broadcasting draft-v1 — otherwise peers may see
      // `currentRoom.format === "Any"` when the start envelope lands.
      // `ackPromise` registers before `serverStartGame` to close the
      // race where the server's GameStarted arrives before the
      // listener is attached. The detached-catch handles the case
      // where `serverStartGame` throws synchronously, so the
      // listeners + timeout don't leak.
      const ackPromise = awaitGameStartedAck(currentRoom.room_id);
      ackPromise.catch(() => {});
      try {
        await serverStartGame("Draft");
        await ackPromise;
      } catch (e) {
        toast.error(`Failed to start draft: ${String(e)}`);
        return;
      }
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

          {/* Engine seam — drafting itself is pure card-selection in
              forge-limited, but surfacing the room's `EngineKind` keeps
              the UI honest about which backend will pick up the drafted
              pool for a follow-on match. Java draft host is not wired
              yet (#82 only covered play-vs-ai); show it as disabled. */}
          <div className="grid grid-cols-2 gap-2">
            <div
              className={cn(
                "rounded-lg border px-3 py-2 flex items-start gap-2",
                "border-primary bg-primary/5",
              )}
            >
              <Cpu className="h-4 w-4 text-primary mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold">Rust (Wasm)</span>
                  <Badge variant="outline" className="text-[9px]">
                    in-browser
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Host runs the draft locally. The drafted pool feeds whichever engine the room was
                  created with.
                </p>
              </div>
            </div>
            <div
              className={cn(
                "rounded-lg border px-3 py-2 flex items-start gap-2 opacity-50",
                "border-border",
              )}
            >
              <Cloud className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold">Forge (hosted)</span>
                  <Badge variant="secondary" className="text-[9px]">
                    coming soon
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Java-Forge node as draft host. Not available yet.
                </p>
              </div>
            </div>
          </div>
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
