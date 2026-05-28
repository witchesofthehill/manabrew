import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useServerStore } from "@/stores/useServerStore";
import type { DraftConfig, EngineKind, GameFormat } from "@/types/server";
import { cn } from "@/lib/utils";
import {
  Cloud,
  Coins,
  Cpu,
  Gem,
  Layers,
  Loader2,
  Shield,
  Sparkles,
  Swords,
  Users,
  Wand2,
} from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";

const CommanderIcon = ({ className }: { className?: string }) => (
  <GameIcon name="overlord-helm" className={className} />
);

const FORMATS: {
  value: GameFormat;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    value: "Standard",
    label: "Standard",
    icon: Swords,
    description: "60-card constructed, rotating sets",
  },
  {
    value: "Pioneer",
    label: "Pioneer",
    icon: Layers,
    description: "60-card, Return to Ravnica forward",
  },
  { value: "Modern", label: "Modern", icon: Shield, description: "60-card, 8th Edition forward" },
  { value: "Legacy", label: "Legacy", icon: Gem, description: "60-card, all sets, banned list" },
  {
    value: "Vintage",
    label: "Vintage",
    icon: Sparkles,
    description: "60-card, all sets, restricted list",
  },
  { value: "Pauper", label: "Pauper", icon: Coins, description: "60-card, commons only" },
  {
    value: "Commander",
    label: "Commander",
    icon: CommanderIcon,
    description: "100-card singleton, 40 life",
  },
  { value: "Brawl", label: "Brawl", icon: Wand2, description: "60-card singleton, 25 life" },
  {
    value: "Oathbreaker",
    label: "Oathbreaker",
    icon: Wand2,
    description: "60-card singleton, planeswalker cmdr",
  },
];

// Match: realistic MTG game pods. Draft: 8 is the canonical pod, 4/6
// are common casual sizes. Bot fill comes from the room's draft_config.
const PLAYER_OPTIONS_MATCH = [2, 3, 4] as const;
const PLAYER_OPTIONS_DRAFT = [2, 4, 6, 8] as const;

type RoomKind = "match" | "draft";

interface CreateRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRoomDialog({ open, onOpenChange }: CreateRoomDialogProps) {
  const { createRoom, username } = useServerStore();
  const allSets = useScryfallStore((s) => s.sets);
  const prefetchSet = useScryfallStore((s) => s.prefetchSet);
  const [kind, setKind] = useState<RoomKind>("match");
  const [roomName, setRoomName] = useState("");
  const [matchPlayers, setMatchPlayers] = useState(4);
  const [draftPlayers, setDraftPlayers] = useState(8);
  const [format, setFormat] = useState<GameFormat>("Standard");
  const [engine, setEngine] = useState<EngineKind>("Wasm");

  // Draft-specific config baked into the room.
  const [draftSet, setDraftSet] = useState<string>("");
  const [draftRounds, setDraftRounds] = useState(3);
  const [draftPicksPerPass, setDraftPicksPerPass] = useState(1);
  const [draftSeed, setDraftSeed] = useState("");
  const [draftFillWithBots, setDraftFillWithBots] = useState(true);
  const [prefetchingSet, setPrefetchingSet] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const defaultName = `${username ?? "Player"}'s Room`;
  const hostedAvailable = isHostedEngineAvailable();
  const playerOptions = kind === "draft" ? PLAYER_OPTIONS_DRAFT : PLAYER_OPTIONS_MATCH;
  const maxPlayers = kind === "draft" ? draftPlayers : matchPlayers;
  const setMaxPlayers = kind === "draft" ? setDraftPlayers : setMatchPlayers;

  const draftableSets = useMemo(
    () =>
      [...(allSets ?? [])]
        .filter((s) => DRAFTABLE_SET_TYPES.has(s.set_type) && !s.digital && s.card_count > 0)
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "")),
    [allSets],
  );

  // Warm the Scryfall cache for the chosen set so the first pack
  // doesn't render as a wall of skeletons when the draft starts.
  useEffect(() => {
    if (!draftSet) return;
    let cancelled = false;
    setPrefetchingSet(draftSet);
    void prefetchSet(draftSet).finally(() => {
      if (!cancelled) setPrefetchingSet((cur) => (cur === draftSet ? null : cur));
    });
    return () => {
      cancelled = true;
    };
  }, [draftSet, prefetchSet]);

  const draftConfigReady = kind !== "draft" || !!draftSet;

  async function handleCreate() {
    if (!draftConfigReady) return;
    setCreating(true);
    try {
      const submittedFormat: GameFormat = kind === "draft" ? "Any" : format;
      let draftConfig: DraftConfig | undefined;
      if (kind === "draft") {
        // `Number("0") || undefined` collapses an explicit 0 seed to
        // undefined; `Number.isFinite` keeps seed 0 as a valid value.
        const parsedSeed = draftSeed.trim() ? Number(draftSeed) : NaN;
        draftConfig = {
          set_code: draftSet,
          rounds: draftRounds,
          picks_per_pass: draftPicksPerPass,
          seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
          fill_with_bots: draftFillWithBots,
        };
      }
      await createRoom(
        roomName.trim() || defaultName,
        maxPlayers,
        submittedFormat,
        engine,
        draftConfig,
      );
      onOpenChange(false);
      setRoomName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <DialogTitle className="text-lg">Create Room</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Set up a new game room for others to join.
          </DialogDescription>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Room kind */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Room type</Label>
            <div className="grid grid-cols-2 gap-2">
              <RoomKindCard
                selected={kind === "match"}
                onClick={() => setKind("match")}
                icon={Swords}
                label="Match"
                description="Constructed game — pick a format and bring a deck."
              />
              <RoomKindCard
                selected={kind === "draft"}
                onClick={() => setKind("draft")}
                icon={Sparkles}
                label="Draft"
                description="Multiplayer booster draft — no deck required; pick a set at start."
              />
            </div>
          </div>

          {/* Room name */}
          <div className="space-y-1.5">
            <Label htmlFor="room-name" className="text-xs font-medium">
              Room Name
            </Label>
            <Input
              id="room-name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={defaultName}
              className="h-9"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          {/* Engine */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Engine</Label>
            <div className="grid grid-cols-2 gap-2">
              <EngineCard
                selected={engine === "Wasm"}
                onClick={() => setEngine("Wasm")}
                icon={Cpu}
                label="Rust (Wasm)"
                badge="in-browser"
                description="ManaBrew's own engine, running locally. Instant, no network."
              />
              <EngineCard
                selected={engine === "Java"}
                onClick={() => setEngine("Java")}
                icon={Cloud}
                label="Forge (hosted)"
                badge={hostedAvailable ? "hosted" : "coming soon"}
                description={
                  hostedAvailable
                    ? "Java Forge on a ManaBrew-hosted node. Full card support."
                    : "Hosted multiplayer Java match requires a node-side host that isn't wired yet."
                }
                disabled={!hostedAvailable}
              />
            </div>
          </div>

          {/* Format (Match only) */}
          {kind === "match" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Format</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[240px] overflow-y-auto">
                {FORMATS.map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFormat(f.value)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors",
                        format === f.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30 hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon
                          className={cn(
                            "h-3.5 w-3.5",
                            format === f.value ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="text-xs font-medium">{f.label}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        {f.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Max players */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              {kind === "draft" ? "Pod size" : "Players"}
            </Label>
            <div className="flex items-center gap-2">
              {playerOptions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxPlayers(n)}
                  className={cn(
                    "flex-1 h-10 rounded-lg border flex items-center justify-center gap-1.5 transition-colors",
                    maxPlayers === n
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/30 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium">{n}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Draft config (Draft only) */}
          {kind === "draft" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Set</Label>
                {draftableSets.length === 0 ? (
                  <p className="flex items-center gap-2 rounded border border-border/40 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading sets from Scryfall…
                  </p>
                ) : (
                  <SetPicker
                    sets={draftableSets}
                    selectedCode={draftSet}
                    prefetching={prefetchingSet}
                    onSelect={setDraftSet}
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="draft-rounds" className="text-xs font-medium">
                    Rounds
                  </Label>
                  <Input
                    id="draft-rounds"
                    type="number"
                    min={1}
                    max={6}
                    value={draftRounds}
                    onChange={(e) =>
                      setDraftRounds(Math.max(1, Math.min(6, Number(e.target.value) || 3)))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="draft-picks-per-pass" className="text-xs font-medium">
                    Picks / pass
                  </Label>
                  <Input
                    id="draft-picks-per-pass"
                    type="number"
                    min={1}
                    max={4}
                    value={draftPicksPerPass}
                    onChange={(e) =>
                      setDraftPicksPerPass(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="draft-seed" className="text-xs font-medium">
                    Seed
                  </Label>
                  <Input
                    id="draft-seed"
                    type="text"
                    inputMode="numeric"
                    value={draftSeed}
                    onChange={(e) => setDraftSeed(e.target.value)}
                    placeholder="random"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={draftFillWithBots}
                  onChange={(e) => setDraftFillWithBots(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Fill empty seats with AI bots</span>
              </label>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating || !draftConfigReady}
            className="gap-1.5 min-w-[100px]"
            title={!draftConfigReady ? "Pick a set for the draft" : undefined}
          >
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Swords className="h-3.5 w-3.5" />
            )}
            {creating ? "Creating..." : "Create Room"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface RoomKindCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}

function RoomKindCard({ selected, onClick, icon: Icon, label, description }: RoomKindCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/30 hover:bg-muted/30",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-[11px] text-muted-foreground leading-snug">{description}</span>
    </button>
  );
}

interface EngineCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge: string;
  description: string;
  disabled?: boolean;
}

function EngineCard({
  selected,
  onClick,
  icon: Icon,
  label,
  badge,
  description,
  disabled,
}: EngineCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border enabled:hover:border-primary/30 enabled:hover:bg-muted/30",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", selected ? "text-primary" : "text-muted-foreground")} />
        <span className="text-xs font-medium">{label}</span>
        <Badge variant="outline" className="text-[9px]">
          {badge}
        </Badge>
      </div>
      <span className="text-[10px] text-muted-foreground leading-tight">{description}</span>
    </button>
  );
}
