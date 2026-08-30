import { useState } from "react";
import { Check, ChevronDown, Loader2, Sparkles, Swords, Users, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchCubeMetadata } from "@/api/limitedEdition";
import { FormatBadge } from "@/components/game/FormatBadge";
import {
  FORMATS,
  LIMITED_KINDS,
  type LimitedKind,
  type LimitedKindMeta,
  type RoomKind,
} from "@/components/lobby/tableSetup.constants";
import { cn } from "@/lib/utils";
import type { CubeImportResult } from "@/types/limited";
import type { GameFormat } from "@/types/server";

interface TableSetupGameCardProps {
  kind: RoomKind;
  onKindChange: (kind: RoomKind) => void;
  limitedKind: LimitedKind;
  onLimitedKindChange: (kind: LimitedKind) => void;
  format: GameFormat;
  onFormatChange: (format: GameFormat) => void;
  playerOptions: readonly number[];
  maxPlayers: number;
  onMaxPlayersChange: (maxPlayers: number) => void;
  isBoosterDraft: boolean;
  isCube: boolean;
  isSealed: boolean;
  draftRounds: number;
  onDraftRoundsChange: (rounds: number) => void;
  draftPicksPerPass: number;
  onDraftPicksPerPassChange: (picks: number) => void;
  draftSeed: string;
  onDraftSeedChange: (seed: string) => void;
  draftFillWithBots: boolean;
  onDraftFillWithBotsChange: (fill: boolean) => void;
  sealedUseCube: boolean;
  onSealedUseCubeChange: (useCube: boolean) => void;
  sealedNumBoosters: number;
  onSealedNumBoostersChange: (boosters: number) => void;
  sealedSeed: string;
  onSealedSeedChange: (seed: string) => void;
  importedCube: CubeImportResult | null;
  onCubeImported: (cube: CubeImportResult | null) => void;
}

export function TableSetupGameCard({
  kind,
  onKindChange,
  limitedKind,
  onLimitedKindChange,
  format,
  onFormatChange,
  playerOptions,
  maxPlayers,
  onMaxPlayersChange,
  isBoosterDraft,
  isCube,
  isSealed,
  draftRounds,
  onDraftRoundsChange,
  draftPicksPerPass,
  onDraftPicksPerPassChange,
  draftSeed,
  onDraftSeedChange,
  draftFillWithBots,
  onDraftFillWithBotsChange,
  sealedUseCube,
  onSealedUseCubeChange,
  sealedNumBoosters,
  onSealedNumBoostersChange,
  sealedSeed,
  onSealedSeedChange,
  importedCube,
  onCubeImported,
}: TableSetupGameCardProps) {
  const [cubeInput, setCubeInput] = useState("");
  const [importingCube, setImportingCube] = useState(false);
  const [cubeImportError, setCubeImportError] = useState<string | null>(null);

  async function handleImportCube() {
    if (!cubeInput.trim()) return;
    setImportingCube(true);
    setCubeImportError(null);
    try {
      const result = await fetchCubeMetadata(cubeInput.trim());
      onCubeImported(result);
      if (isSealed) {
        onSealedNumBoostersChange(Math.max(1, Math.min(12, result.numPacks)));
      }
    } catch (err) {
      setCubeImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingCube(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
      <h2 className="text-sm font-semibold">The game</h2>
      <div className="mt-3 space-y-4">
        <div className="flex overflow-hidden rounded-md border">
          <ModeButton
            active={kind === "match"}
            bordered={false}
            onClick={() => onKindChange("match")}
          >
            <Swords className="h-3.5 w-3.5" /> Match
          </ModeButton>
          <ModeButton active={kind === "limited"} bordered onClick={() => onKindChange("limited")}>
            <Sparkles className="h-3.5 w-3.5" /> Limited
          </ModeButton>
        </div>

        {kind === "limited" && (
          <div className="grid grid-cols-2 gap-2">
            {LIMITED_KINDS.map((meta) => (
              <LimitedKindCard
                key={meta.value}
                meta={meta}
                selected={limitedKind === meta.value}
                onClick={() => meta.enabled && onLimitedKindChange(meta.value)}
              />
            ))}
          </div>
        )}

        {kind === "match" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Format</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  id="room-format"
                  title="Change format"
                  className="inline-flex w-full cursor-pointer items-center gap-1.5 rounded-full border bg-background/60 px-2 py-1 text-xs backdrop-blur-sm transition-colors hover:bg-background/80"
                >
                  <FormatBadge formatId={format.toLowerCase()} />
                  <span className="font-medium">
                    {FORMATS.find((option) => option.value === format)?.label}
                  </span>
                  <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
              >
                {FORMATS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => onFormatChange(option.value)}
                    className="gap-2"
                  >
                    <FormatBadge formatId={option.value.toLowerCase()} />
                    <span className="text-xs">{option.label}</span>
                    {format === option.value && <Check className="ml-auto h-3 w-3 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              {FORMATS.find((option) => option.value === format)?.description}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            {kind === "limited" ? "Pod size" : "Players"}
          </Label>
          <div className="flex items-center gap-2">
            {playerOptions.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onMaxPlayersChange(n)}
                className={cn(
                  "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border transition-colors",
                  maxPlayers === n
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
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
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sealedUseCube}
                onChange={(e) => {
                  onSealedUseCubeChange(e.target.checked);
                  onCubeImported(null);
                }}
                className="h-3.5 w-3.5"
              />
              <span>Use a CubeCobra cube instead of a set</span>
            </label>
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
                    onSealedNumBoostersChange(
                      Math.max(3, Math.min(12, Number(e.target.value) || 6)),
                    )
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
                  onChange={(e) => onSealedSeedChange(e.target.value)}
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

        {(isCube || (isSealed && sealedUseCube)) && (
          <div className="space-y-1.5">
            <Label htmlFor="cube-input" className="text-xs font-medium">
              Cube
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="cube-input"
                type="text"
                value={cubeInput}
                onChange={(e) => setCubeInput(e.target.value)}
                placeholder="cubeid or cubecobra.com/…"
                className="h-9 flex-1 text-sm pointer-coarse:text-base"
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
                {importedCube.rejectedCardCount > 0 &&
                  ` · ${importedCube.rejectedCardCount} without local engine data`}
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
                    onDraftRoundsChange(Math.max(1, Math.min(6, Number(e.target.value) || 3)))
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
                    onDraftPicksPerPassChange(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
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
                  onChange={(e) => onDraftSeedChange(e.target.value)}
                  placeholder="random"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={draftFillWithBots}
                onChange={(e) => onDraftFillWithBotsChange(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span>Fill empty seats with AI bots</span>
            </label>
          </>
        )}
      </div>
    </section>
  );
}

function ModeButton({
  active,
  bordered = false,
  onClick,
  children,
}: {
  active: boolean;
  bordered?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 p-2 text-xs font-medium transition-colors pointer-coarse:p-3",
        bordered && "border-l",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
      onClick={onClick}
    >
      {children}
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
        !meta.enabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="flex items-center gap-1.5">
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
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">{meta.description}</span>
    </button>
  );
}
