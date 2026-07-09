import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { fetchCubeMetadata, fetchSetPool } from "@/api/limitedEdition";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useServerStore } from "@/stores/useServerStore";
import { getPlatformType } from "@/platform";
import type { CubeImportResult } from "@/types/limited";
import { DEFAULT_RECONNECT_TIMEOUT_S } from "@/types/server";
import type { DraftConfig, EngineKind, GameFormat, SealedConfig } from "@/types/server";
import { cn } from "@/lib/utils";
import {
  Boxes,
  Coins,
  Gem,
  Layers,
  Loader2,
  Shield,
  Sparkles,
  Swords,
  TriangleAlert,
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
  {
    value: "Draft",
    label: "Draft",
    icon: Boxes,
    description: "40-card decks built from a draft",
  },
  {
    value: "Sealed",
    label: "Sealed",
    icon: Boxes,
    description: "40-card decks built from a sealed pool",
  },
];

const PLAYER_OPTIONS_MATCH = [2, 3, 4] as const;
const PLAYER_OPTIONS_LIMITED = [2, 4, 6, 8] as const;

const defaultMatchPlayers = (format: GameFormat) => (format === "Commander" ? 4 : 2);
// Capped at 90s: the engine auto-passes a silent seat after 120s
const RECONNECT_TIMEOUT_OPTIONS = [30, 60, 90] as const;

type RoomKind = "match" | "limited";

type LimitedKind = "draft" | "sealed" | "winston" | "cube";

interface LimitedKindMeta {
  value: LimitedKind;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  enabled: boolean;
}

const LIMITED_KINDS: LimitedKindMeta[] = [
  {
    value: "draft",
    label: "Booster Draft",
    icon: Swords,
    description: "Pod draft — pass packs around the table.",
    enabled: true,
  },
  {
    value: "sealed",
    label: "Sealed",
    icon: Boxes,
    description: "Each player opens packs and builds independently.",
    enabled: true,
  },
  {
    value: "winston",
    label: "Winston Draft",
    icon: Layers,
    description: "2-player pile draft from a shared pool. Single-player only for now.",
    enabled: false,
  },
  {
    value: "cube",
    label: "Cube",
    icon: Wand2,
    description: "Pod draft from a CubeCobra cube.",
    enabled: true,
  },
];

interface CreateRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateRoomDialog({ open, onOpenChange }: CreateRoomDialogProps) {
  const { createRoom, username } = useServerStore();
  const isTauri = getPlatformType() === "tauri";
  const [engine, setEngine] = useState<EngineKind>(isTauri ? "Forge" : "Manabrew");
  const [roomPassword, setRoomPassword] = useState("");
  const allSets = useScryfallStore((s) => s.sets);
  const prefetchSet = useScryfallStore((s) => s.prefetchSet);
  const [kind, setKind] = useState<RoomKind>("match");
  const [limitedKind, setLimitedKind] = useState<LimitedKind>("draft");
  const [roomName, setRoomName] = useState("");
  const [matchPlayersOverride, setMatchPlayersOverride] = useState<number | null>(null);
  const [limitedPlayers, setLimitedPlayers] = useState(8);
  const [format, setFormat] = useState<GameFormat>("Standard");
  const [reconnectTimeoutS, setReconnectTimeoutS] = useState<number>(DEFAULT_RECONNECT_TIMEOUT_S);

  const [draftSet, setDraftSet] = useState<string>("");
  const [draftRounds, setDraftRounds] = useState(3);
  const [draftPicksPerPass, setDraftPicksPerPass] = useState(1);
  const [draftSeed, setDraftSeed] = useState("");
  const [draftFillWithBots, setDraftFillWithBots] = useState(true);
  const [prefetchingSet, setPrefetchingSet] = useState<string | null>(null);
  const [unsupportedSet, setUnsupportedSet] = useState<string | null>(null);

  const [cubeInput, setCubeInput] = useState("");
  const [importedCube, setImportedCube] = useState<CubeImportResult | null>(null);
  const [importingCube, setImportingCube] = useState(false);
  const [cubeImportError, setCubeImportError] = useState<string | null>(null);

  const [sealedSet, setSealedSet] = useState<string>("");
  const [sealedNumBoosters, setSealedNumBoosters] = useState(6);
  const [sealedSeed, setSealedSeed] = useState("");
  const [prefetchingSealedSet, setPrefetchingSealedSet] = useState<string | null>(null);
  const [unsupportedSealedSet, setUnsupportedSealedSet] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const defaultName = `${username ?? "Player"}'s Room`;
  const playerOptions = kind === "limited" ? PLAYER_OPTIONS_LIMITED : PLAYER_OPTIONS_MATCH;
  const matchPlayers = matchPlayersOverride ?? defaultMatchPlayers(format);
  const maxPlayers = kind === "limited" ? limitedPlayers : matchPlayers;
  const setMaxPlayers = kind === "limited" ? setLimitedPlayers : setMatchPlayersOverride;

  const draftableSets = useMemo(
    () =>
      [...(allSets ?? [])]
        .filter((s) => DRAFTABLE_SET_TYPES.has(s.set_type) && !s.digital && s.card_count > 0)
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "")),
    [allSets],
  );

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

  useEffect(() => {
    if (!draftSet) {
      setUnsupportedSet(null);
      return;
    }
    let cancelled = false;
    setUnsupportedSet(null);
    fetchSetPool(draftSet).catch(() => {
      if (!cancelled) setUnsupportedSet(draftSet);
    });
    return () => {
      cancelled = true;
    };
  }, [draftSet]);

  useEffect(() => {
    if (!sealedSet) return;
    let cancelled = false;
    setPrefetchingSealedSet(sealedSet);
    void prefetchSet(sealedSet).finally(() => {
      if (!cancelled) setPrefetchingSealedSet((cur) => (cur === sealedSet ? null : cur));
    });
    return () => {
      cancelled = true;
    };
  }, [sealedSet, prefetchSet]);

  useEffect(() => {
    if (!sealedSet) {
      setUnsupportedSealedSet(null);
      return;
    }
    let cancelled = false;
    setUnsupportedSealedSet(null);
    fetchSetPool(sealedSet).catch(() => {
      if (!cancelled) setUnsupportedSealedSet(sealedSet);
    });
    return () => {
      cancelled = true;
    };
  }, [sealedSet]);

  useEffect(() => {
    if (open) return;
    setKind("match");
    setEngine(isTauri ? "Forge" : "Manabrew");
    setRoomPassword("");
    setLimitedKind("draft");
    setRoomName("");
    setMatchPlayersOverride(null);
    setFormat("Standard");
    setReconnectTimeoutS(DEFAULT_RECONNECT_TIMEOUT_S);
    setDraftSet("");
    setDraftRounds(3);
    setDraftPicksPerPass(1);
    setDraftSeed("");
    setDraftFillWithBots(true);
    setCubeInput("");
    setImportedCube(null);
    setCubeImportError(null);
    setSealedSet("");
    setSealedNumBoosters(6);
    setSealedSeed("");
  }, [open, isTauri]);

  const isBoosterDraft = kind === "limited" && limitedKind === "draft";
  const isCube = kind === "limited" && limitedKind === "cube";
  const isSealed = kind === "limited" && limitedKind === "sealed";
  const showPicker = isBoosterDraft || isSealed;
  const pickerSet = isSealed ? sealedSet : draftSet;
  const pickerUnsupported = isSealed ? unsupportedSealedSet : unsupportedSet;
  const limitedKindEnabled =
    kind !== "limited" || (LIMITED_KINDS.find((k) => k.value === limitedKind)?.enabled ?? false);
  const draftConfigReady =
    (!isBoosterDraft || (!!draftSet && unsupportedSet !== draftSet)) &&
    (!isCube || !!importedCube) &&
    (!isSealed || (!!sealedSet && unsupportedSealedSet !== sealedSet));
  const canSubmit = limitedKindEnabled && draftConfigReady;

  async function handleImportCube() {
    if (!cubeInput.trim()) return;
    setImportingCube(true);
    setCubeImportError(null);
    try {
      const result = await fetchCubeMetadata(cubeInput.trim());
      setImportedCube(result);
    } catch (err) {
      setCubeImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingCube(false);
    }
  }

  async function handleCreate() {
    if (!canSubmit) return;
    setCreating(true);
    try {
      const submittedFormat: GameFormat = kind === "limited" ? "Any" : format;
      let draftConfig: DraftConfig | undefined;
      let sealedConfig: SealedConfig | undefined;
      if (isBoosterDraft || isCube) {
        const parsedSeed = draftSeed.trim() ? Number(draftSeed) : NaN;
        draftConfig = {
          set_code: isBoosterDraft ? draftSet : undefined,
          cube_id: isCube ? importedCube!.cubeId : undefined,
          cube_name: isCube ? importedCube!.name : undefined,
          rounds: draftRounds,
          picks_per_pass: draftPicksPerPass,
          seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
          fill_with_bots: draftFillWithBots,
        };
      } else if (isSealed) {
        const parsedSeed = sealedSeed.trim() ? Number(sealedSeed) : NaN;
        sealedConfig = {
          set_code: sealedSet,
          num_boosters: sealedNumBoosters,
          base_seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
        };
      }
      const password = roomPassword.trim() || undefined;
      const submittedEngine: EngineKind = kind === "match" ? engine : "Manabrew";
      await createRoom(
        roomName.trim() || defaultName,
        maxPlayers,
        submittedFormat,
        submittedEngine,
        draftConfig,
        sealedConfig,
        reconnectTimeoutS,
        password,
      );
      onOpenChange(false);
      setRoomName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 gap-0 overflow-hidden flex flex-col max-h-[90dvh]",
          showPicker ? "max-w-4xl" : "max-w-3xl",
        )}
      >
        <div className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="text-lg">Create Room</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Set up a new game room for others to join.
          </DialogDescription>
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto",
            showPicker && "md:flex-row md:overflow-hidden",
          )}
        >
          <div
            className={cn(
              "space-y-5 px-6 pb-6",
              showPicker && "md:min-h-0 md:flex-1 md:overflow-y-auto",
            )}
          >
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
                  selected={kind === "limited"}
                  onClick={() => setKind("limited")}
                  icon={Sparkles}
                  label="Limited"
                  description="Draft, sealed, or other built-on-the-fly formats."
                />
              </div>
            </div>

            {/* Limited subtype picker — mirrors the offline Limited view's
              mode grid so the multiplayer surface area lines up. */}
            {kind === "limited" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Limited mode</Label>
                <div className="grid grid-cols-2 gap-2">
                  {LIMITED_KINDS.map((meta) => (
                    <LimitedKindCard
                      key={meta.value}
                      meta={meta}
                      selected={limitedKind === meta.value}
                      onClick={() => meta.enabled && setLimitedKind(meta.value)}
                    />
                  ))}
                </div>
              </div>
            )}

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

            {/* Room password (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="room-password" className="text-xs font-medium">
                Password <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="room-password"
                type="password"
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                placeholder="Leave blank for an open room"
                className="h-9"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            {/* Engine — rooms created here always run the Manabrew engine. Forge
                rooms come from self-hosted nodes and are joined from the list, but
                nodes only host constructed matches, not limited (draft/sealed). */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Engine</Label>
              <div className={cn("grid gap-2", kind === "match" ? "grid-cols-2" : "grid-cols-1")}>
                <button
                  type="button"
                  onClick={() => setEngine("Manabrew")}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors",
                    engine === "Manabrew"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <GameIcon
                      name="beer-stein"
                      className={cn(
                        "h-3.5 w-3.5",
                        engine === "Manabrew" ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span className="text-xs font-medium">Manabrew</span>
                    <Badge variant="outline" className="text-[9px]">
                      in-browser
                    </Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    Manabrew's own engine, running locally. Instant, no network.
                  </span>
                </button>
                {kind === "match" &&
                  (isTauri ? (
                    <button
                      type="button"
                      onClick={() => setEngine("Forge")}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors",
                        engine === "Forge"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30 hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <GameIcon
                          name="anvil"
                          className={cn(
                            "h-3.5 w-3.5",
                            engine === "Forge" ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="text-xs font-medium">Forge</span>
                        <Badge variant="outline" className="text-[9px]">
                          on this device
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        Full card support, hosted in-app on this device. Others join from the lobby.
                      </span>
                    </button>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5 rounded-lg border border-border p-2 text-left">
                      <div className="flex items-center gap-1.5">
                        <GameIcon name="anvil" className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">Forge</span>
                        <Badge variant="outline" className="text-[9px]">
                          hosted
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        Full card support. Available on
                        <a
                          href="https://docs.manabrew.app/getting-started/"
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          {" "}
                          Desktop{". "}
                        </a>
                        Or join a Forge room from the list, alternatively,{" "}
                        <a
                          href="https://docs.manabrew.app/self-hosting/"
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          host your own
                        </a>
                        .
                      </span>
                    </div>
                  ))}
              </div>
              {!(kind === "match" && engine === "Forge") && (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    {kind === "match"
                      ? "The Manabrew engine is a work in progress and may have bugs or missing cards. For the most stable experience, play on the Forge engine."
                      : "Limited runs on the Manabrew engine only — a work in progress that may have bugs or missing cards. Forge nodes host constructed matches, not drafts."}
                  </p>
                </div>
              )}
            </div>

            {/* Format (Match only) */}
            {kind === "match" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Format</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                {kind === "limited" ? "Pod size" : "Players"}
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

            {isSealed && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="sealed-boosters" className="text-xs font-medium">
                      Packs per player
                    </Label>
                    <Input
                      id="sealed-boosters"
                      type="number"
                      min={3}
                      max={12}
                      value={sealedNumBoosters}
                      onChange={(e) =>
                        setSealedNumBoosters(Math.max(3, Math.min(12, Number(e.target.value) || 6)))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sealed-seed" className="text-xs font-medium">
                      Seed
                    </Label>
                    <Input
                      id="sealed-seed"
                      type="text"
                      inputMode="numeric"
                      value={sealedSeed}
                      onChange={(e) => setSealedSeed(e.target.value)}
                      placeholder="random"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Each player opens their own pool — pools are independent but reproducible from the
                  seed.
                </p>
              </>
            )}

            {isCube && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Cube</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={cubeInput}
                    onChange={(e) => setCubeInput(e.target.value)}
                    placeholder="cubeid or cubecobra.com/…"
                    className="h-9 text-sm flex-1 pointer-coarse:text-base"
                    disabled={importingCube}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleImportCube}
                    disabled={importingCube || !cubeInput.trim()}
                    className="gap-1.5"
                  >
                    {importingCube ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" />
                    )}
                    {importingCube ? "Importing…" : "Import"}
                  </Button>
                </div>
                {importedCube && (
                  <p className="text-[11px] text-muted-foreground">
                    Loaded: <span className="text-foreground/90">{importedCube.name}</span> —{" "}
                    {importedCube.cardCount} cards
                  </p>
                )}
                {cubeImportError && !importedCube && !importingCube && (
                  <p className="text-[11px] text-destructive">{cubeImportError}</p>
                )}
              </div>
            )}

            {(isBoosterDraft || isCube) && (
              <>
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

            {kind === "match" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Reconnect timeout</Label>
                <div className="flex items-center gap-2">
                  {RECONNECT_TIMEOUT_OPTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setReconnectTimeoutS(s)}
                      className={cn(
                        "flex-1 h-9 rounded-lg border flex items-center justify-center transition-colors",
                        reconnectTimeoutS === s
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/30 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="text-sm font-medium">{s}s</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  How long the game waits for a disconnected player before it is aborted.
                </p>
              </div>
            )}
          </div>

          {/* Pool source — Booster Draft and Sealed pick a Scryfall set;
              Cube uses the CubeCobra import above. The downstream draftHost
              branches on draft_config.cube_id vs set_code. */}
          {showPicker && (
            <div className="flex flex-col border-t border-border/60 md:w-96 md:min-h-0 md:shrink-0 md:border-t-0 md:border-l">
              {draftableSets.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading sets from Scryfall…
                </p>
              ) : (
                <div className="md:min-h-0 md:flex-1">
                  <SetPicker
                    variant="column"
                    sets={draftableSets}
                    selectedCode={pickerSet}
                    prefetching={isSealed ? prefetchingSealedSet : prefetchingSet}
                    onSelect={isSealed ? setSealedSet : setDraftSet}
                  />
                </div>
              )}
              {!!pickerSet && pickerUnsupported === pickerSet && (
                <p className="shrink-0 border-t border-border/60 px-4 py-2 text-[11px] text-destructive">
                  Your game data doesn't include {pickerSet.toUpperCase()}. Update the app to use
                  this set.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating || !canSubmit}
            className="gap-1.5 min-w-[100px]"
            title={
              !limitedKindEnabled
                ? "That limited mode isn't wired for multiplayer yet"
                : isBoosterDraft && !draftSet
                  ? "Pick a set for the draft"
                  : isSealed && !sealedSet
                    ? "Pick a set for sealed"
                    : isCube && !importedCube
                      ? "Import a cube before creating the room"
                      : undefined
            }
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

function LimitedKindCard({
  meta,
  selected,
  onClick,
}: {
  meta: LimitedKindMeta;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!meta.enabled}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
        selected && meta.enabled
          ? "border-primary bg-primary/5"
          : "border-border enabled:hover:border-primary/30 enabled:hover:bg-muted/30",
        !meta.enabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            "h-4 w-4",
            selected && meta.enabled ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="text-sm font-medium">{meta.label}</span>
        {!meta.enabled && (
          <Badge variant="secondary" className="text-[9px]">
            coming soon
          </Badge>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground leading-snug">{meta.description}</span>
    </button>
  );
}
