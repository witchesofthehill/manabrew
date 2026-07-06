import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  Crown,
  Dice5,
  Hourglass,
  Layers,
  Shuffle,
  Sparkles,
  Swords,
  Wand2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { SetSymbol } from "@/components/limited/SetSymbol";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { fetchEditionInfo, fetchSetPool, type EditionInfo } from "@/api/limitedEdition";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { ScryfallSet } from "@/types/scryfall";

export default function Limited() {
  const navigate = useNavigate();
  const startSealed = useLimitedStore((s) => s.startSealed);
  const startBoosterDraft = useLimitedStore((s) => s.startBoosterDraft);
  const startWinston = useLimitedStore((s) => s.startWinston);
  const importCube = useLimitedStore((s) => s.importCubeFromCubeCobra);
  const isStarting = useLimitedStore((s) => s.isStarting);
  const lastError = useLimitedStore((s) => s.lastError);
  const fetchSealedTemplates = useLimitedStore((s) => s.fetchSealedTemplates);
  const fetchChaosThemes = useLimitedStore((s) => s.fetchChaosThemes);
  const sealedTemplates = useLimitedStore((s) => s.sealedTemplates);
  const chaosThemes = useLimitedStore((s) => s.chaosThemes);
  const lastImportedCube = useLimitedStore((s) => s.lastImportedCube);

  const allSets = useScryfallStore((s) => s.sets);
  const prefetchSet = useScryfallStore((s) => s.prefetchSet);

  const draftableSets = useMemo(
    () =>
      [...(allSets ?? [])]
        .filter((s) => DRAFTABLE_SET_TYPES.has(s.set_type) && !s.digital && s.card_count > 0)
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "")),
    [allSets],
  );

  const [numBoosters, setNumBoosters] = useState(6);
  const [podSize, setPodSize] = useState(8);
  const [winstonPacks, setWinstonPacks] = useState(6);
  const [cubeInput, setCubeInput] = useState("");
  const [selectedSetCode, setSelectedSetCode] = useState("");
  const [prefetchingSet, setPrefetchingSet] = useState<string | null>(null);
  const [fetchingPool, setFetchingPool] = useState(false);
  const [editionInfo, setEditionInfo] = useState<EditionInfo | null>(null);
  const [editionInfoLoading, setEditionInfoLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [seedInput, setSeedInput] = useState("");
  const [picksPerPass, setPicksPerPass] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const seedOpt = useMemo(() => {
    const trimmed = seedInput.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
  }, [seedInput]);

  useEffect(() => {
    if (!selectedSetCode) {
      setEditionInfo(null);
      setSelectedVariant("");
      return;
    }
    let cancelled = false;
    setEditionInfoLoading(true);
    fetchEditionInfo(selectedSetCode)
      .then((info) => {
        if (cancelled) return;
        setEditionInfo(info);
        setSelectedVariant("");
      })
      .finally(() => {
        if (!cancelled) setEditionInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSetCode]);

  useEffect(() => {
    fetchSealedTemplates();
    fetchChaosThemes();
  }, [fetchSealedTemplates, fetchChaosThemes]);

  const fetchPool = async (): Promise<DraftCard[]> => {
    if (!selectedSetCode) {
      throw new Error("Pick a set to draft first.");
    }
    setFetchingPool(true);
    try {
      return await fetchSetPool(selectedSetCode);
    } finally {
      setFetchingPool(false);
    }
  };

  const variantOpt = selectedVariant || undefined;

  const handleStartSealed = async () => {
    try {
      const pool = await fetchPool();
      const result = await startSealed({
        poolType: "Full",
        numBoosters,
        pool,
        variant: variantOpt,
        seed: seedOpt,
      });
      navigate(`/sealed/${result.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };

  const handleStartDraft = async () => {
    try {
      const pool = await fetchPool();
      const state = await startBoosterDraft({
        podSize,
        rounds: 3,
        pool,
        variant: variantOpt,
        seed: seedOpt,
        picksPerPass,
      });
      navigate(`/draft/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };

  const handleStartWinston = async () => {
    try {
      const pool = await fetchPool();
      const state = await startWinston({
        poolPacks: winstonPacks,
        pool,
        variant: variantOpt,
        seed: seedOpt,
      });
      navigate(`/winston/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };

  const handleImportCube = async () => {
    if (!cubeInput.trim()) return;
    try {
      await importCube(cubeInput.trim());
    } catch {
      /* surfaced via lastError */
    }
  };

  const handleLoadPoolFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { name?: string; pool?: DraftCard[] } | DraftCard[];
      const pool = Array.isArray(parsed) ? parsed : (parsed.pool ?? []);
      if (!Array.isArray(pool) || pool.length === 0) {
        throw new Error("Pool file must contain a non-empty `pool` array of DraftCards.");
      }
      const name =
        (Array.isArray(parsed) ? null : parsed.name) ?? file.name.replace(/\.json$/i, "");
      useLimitedStore.setState({
        lastImportedCube: {
          cubeId: `local:${name}`,
          name,
          cardCount: pool.length,
          numPacks: 3,
          singleton: false,
          pool,
        },
        lastError: null,
      });
    } catch (err) {
      useLimitedStore.setState({ lastError: `Failed to load pool: ${err}` });
    }
  };

  const startBlocked = isStarting || fetchingPool || !selectedSetCode || prefetchingSet !== null;
  const selectedSet = draftableSets.find((s) => s.code === selectedSetCode) ?? null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Limited</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Open packs, build a deck on the fly, then play a quick gauntlet against AI opponents.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{draftableSets.length} sets available</span>
        </div>
      </header>

      <SetPicker
        sets={draftableSets}
        selectedCode={selectedSetCode}
        prefetching={prefetchingSet}
        onSelect={async (code) => {
          setSelectedSetCode(code);
          if (!code) return;
          setPrefetchingSet(code);
          try {
            await prefetchSet(code);
          } finally {
            setPrefetchingSet((current) => (current === code ? null : current));
          }
        }}
      />

      {selectedSet && (
        <SelectedSetSummary
          set={selectedSet}
          info={editionInfo}
          loading={editionInfoLoading}
          prefetching={prefetchingSet === selectedSet.code}
          selectedVariant={selectedVariant}
          onVariantChange={setSelectedVariant}
          onClear={() => setSelectedSetCode("")}
        />
      )}

      <AdvancedToggle
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((v) => !v)}
        seed={seedInput}
        onSeedChange={setSeedInput}
        picksPerPass={picksPerPass}
        onPicksPerPassChange={setPicksPerPass}
      />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Choose a mode
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModeCard
            icon={<Boxes className="h-5 w-5" />}
            title="Sealed"
            description="Open packs, build a 40-card deck, run an AI gauntlet."
            ctaLabel={ctaLabel(fetchingPool, isStarting, "Open packs", "Start Sealed")}
            disabled={startBlocked}
            onStart={handleStartSealed}
          >
            <NumberField
              id="numBoosters"
              label="Packs"
              value={numBoosters}
              min={3}
              max={12}
              onChange={setNumBoosters}
            />
          </ModeCard>

          <ModeCard
            icon={<Swords className="h-5 w-5" />}
            title="Booster Draft"
            description="Pod draft against AI seats — 3 packs each."
            ctaLabel={ctaLabel(fetchingPool, isStarting, "Open packs", "Start Draft")}
            disabled={startBlocked}
            onStart={handleStartDraft}
          >
            <NumberField
              id="podSize"
              label="Pod size"
              value={podSize}
              min={2}
              max={8}
              onChange={setPodSize}
            />
          </ModeCard>

          <ModeCard
            icon={<Layers className="h-5 w-5" />}
            title="Winston Draft"
            description="2-player pile draft against the AI."
            ctaLabel={ctaLabel(fetchingPool, isStarting, "Shuffle", "Start Winston")}
            disabled={startBlocked}
            onStart={handleStartWinston}
          >
            <NumberField
              id="winstonPacks"
              label="Packs"
              value={winstonPacks}
              min={2}
              max={12}
              onChange={setWinstonPacks}
            />
          </ModeCard>

          <ModeCard
            icon={<Wand2 className="h-5 w-5" />}
            title="CubeCobra Import"
            description="Paste a cube id or url, or load a saved pool .json file."
            ctaLabel={isStarting ? "Importing…" : "Import Cube"}
            disabled={isStarting || !cubeInput.trim()}
            onStart={handleImportCube}
            footnote={
              lastImportedCube ? (
                <>
                  Loaded: <span className="text-foreground/90">{lastImportedCube.name}</span> —{" "}
                  {lastImportedCube.cardCount} cards
                </>
              ) : null
            }
          >
            <Input
              type="text"
              value={cubeInput}
              onChange={(e) => setCubeInput(e.target.value)}
              placeholder="cubeid or cubecobra.com/…"
              className="h-8 text-xs"
            />
            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/60 hover:text-foreground/90">
              <input
                type="file"
                accept="application/json,.json,.draft"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleLoadPoolFile(file);
                  e.target.value = ""; // allow re-upload of same file
                }}
              />
              <span>or load saved pool…</span>
            </label>
          </ModeCard>
        </div>
      </section>

      {lastImportedCube && lastImportedCube.pool && lastImportedCube.pool.length > 0 && (
        <CubeStartActions
          cube={lastImportedCube}
          numBoosters={numBoosters}
          podSize={podSize}
          winstonPacks={winstonPacks}
          seed={seedOpt}
          isStarting={isStarting}
          onStartSealed={async () => {
            try {
              const result = await startSealed({
                poolType: "Custom",
                numBoosters,
                pool: lastImportedCube.pool!,
                seed: seedOpt,
              });
              navigate(`/sealed/${result.sessionId}`);
            } catch {
              /* surfaced via lastError */
            }
          }}
          onStartDraft={async () => {
            try {
              const state = await startBoosterDraft({
                podSize,
                rounds: 3,
                pool: lastImportedCube.pool!,
                seed: seedOpt,
                picksPerPass,
              });
              navigate(`/draft/${state.sessionId}`);
            } catch {
              /* surfaced via lastError */
            }
          }}
          onStartWinston={async () => {
            try {
              const state = await startWinston({
                poolPacks: winstonPacks,
                pool: lastImportedCube.pool!,
                seed: seedOpt,
              });
              navigate(`/winston/${state.sessionId}`);
            } catch {
              /* surfaced via lastError */
            }
          }}
        />
      )}

      {lastError && (
        <p className="rounded-md border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}

      <CollapsibleSection
        icon={<Hourglass className="h-4 w-4" />}
        title="Sealed templates"
        count={sealedTemplates.length}
      >
        <ul className="grid gap-1.5 text-sm md:grid-cols-2">
          {sealedTemplates.map((t) => (
            <li
              key={t.id}
              className="rounded border border-border/40 bg-card/30 px-3 py-2 transition hover:border-border"
            >
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.description}</div>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Shuffle className="h-4 w-4" />}
        title="Themed Chaos Draft"
        count={chaosThemes.length}
      >
        <p className="mb-2 text-xs text-muted-foreground">
          Pick a theme. We'll merge pools from the most recent draftable sets that match its
          rotation window and start a normal pod draft against AI seats.
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {chaosThemes.map((t) => {
            const matched = matchSetsForTheme(t.tag, draftableSets);
            return (
              <li key={t.tag}>
                <button
                  type="button"
                  disabled={isStarting || fetchingPool || matched.length === 0}
                  onClick={async () => {
                    try {
                      setFetchingPool(true);
                      const merged: DraftCard[] = [];
                      for (const s of matched) {
                        merged.push(...(await fetchSetPool(s.code)));
                      }
                      const state = await startBoosterDraft({
                        podSize,
                        rounds: 3,
                        pool: merged,
                        seed: seedOpt,
                        picksPerPass,
                      });
                      navigate(`/draft/${state.sessionId}`);
                    } catch {
                      /* surfaced via lastError */
                    } finally {
                      setFetchingPool(false);
                    }
                  }}
                  className="group flex w-full items-center justify-between gap-2 rounded border border-border/40 bg-card/30 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-card/60 disabled:cursor-not-allowed disabled:opacity-60"
                  title={
                    matched.length === 0
                      ? "No matching sets in the Scryfall list yet"
                      : `${matched.length} sets · ${matched
                          .slice(0, 6)
                          .map((s) => s.code.toUpperCase())
                          .join(", ")}${matched.length > 6 ? "…" : ""}`
                  }
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {matched.length} set{matched.length === 1 ? "" : "s"} · pod {podSize}
                    </div>
                  </div>
                  <Shuffle className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                </button>
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>
    </div>
  );
}

interface SelectedSetSummaryProps {
  set: ScryfallSet;
  info: EditionInfo | null;
  loading: boolean;
  prefetching: boolean;
  selectedVariant: string;
  onVariantChange: (v: string) => void;
  onClear: () => void;
}

function SelectedSetSummary({
  set,
  info,
  loading,
  prefetching,
  selectedVariant,
  onVariantChange,
  onClear,
}: SelectedSetSummaryProps) {
  const foilPct = info ? Math.round(info.foilChance * 100) : null;
  const totalSlots = info ? info.slots.reduce((acc, s) => acc + s.count, 0) : null;

  return (
    <section className="rounded-lg border border-primary/40 bg-gradient-to-br from-primary/5 via-card/30 to-card/40 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 p-2.5">
            <SetSymbol setCode={set.code} className="h-10 w-10 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-lg font-semibold leading-tight">{set.name}</h3>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
              <span className="font-mono">{set.code.toUpperCase()}</span>
              {info?.alias && (
                <span className="ml-1 font-mono text-muted-foreground/70">/{info.alias}</span>
              )}{" "}
              · {set.set_type} · {set.released_at ?? "—"} · {set.card_count} cards
              {info?.boosterCovers && info.boosterCovers > 1 && (
                <span className="ml-1">· {info.boosterCovers} cover arts</span>
              )}
              {prefetching && <span className="ml-2 text-primary">· prefetching images…</span>}
            </p>
            {info?.prerelease && (
              <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                Prerelease: <span className="text-foreground/80">{info.prerelease}</span>
              </p>
            )}
          </div>
        </div>

        <Button size="sm" variant="ghost" onClick={onClear} className="h-7 shrink-0 px-2 text-xs">
          <X className="mr-1 h-3 w-3" /> Clear
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3 md:col-span-2 lg:col-span-1">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Booster recipe
          </div>
          {loading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : info ? (
            <div className="flex flex-wrap items-center gap-1">
              {info.slots.map((slot, i) => (
                <span
                  key={`${slot.label}-${i}`}
                  className="max-w-full break-words rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90"
                  title={slot.label}
                >
                  {slot.count}× {slot.label}
                </span>
              ))}
              {totalSlots !== null && (
                <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">
                  {totalSlots} cards / pack
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-yellow-100">
              <span aria-hidden>⚠</span>
              <span className="min-w-0 break-words">
                No Forge booster recipe for this set — using generic 10C / 3U / 1RM / 1 Land.
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Foil
          </div>
          {info ? (
            foilPct !== null && info.foilType !== "NotSupported" ? (
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{foilPct}%</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {info.foilType}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-muted/60">
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${Math.min(100, foilPct)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Not supported</div>
            )
          ) : (
            <div className="text-xs text-muted-foreground">—</div>
          )}
        </div>

        <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Booster variant
          </div>
          {info && info.variants.length > 0 ? (
            <select
              value={selectedVariant}
              onChange={(e) => onVariantChange(e.target.value)}
              className="w-full rounded border border-border/70 bg-background px-2 py-1 text-xs pointer-coarse:text-base"
            >
              <option value="">Default</option>
              {info.variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-muted-foreground">Single recipe</div>
          )}
          {info?.hasReplacementHooks && (
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-200">
              <Crown className="h-3 w-3 shrink-0" />
              <span className="truncate">guaranteed slot active</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface AdvancedToggleProps {
  open: boolean;
  onToggle: () => void;
  seed: string;
  onSeedChange: (v: string) => void;
  picksPerPass: number;
  onPicksPerPassChange: (n: number) => void;
}

function AdvancedToggle({
  open,
  onToggle,
  seed,
  onSeedChange,
  picksPerPass,
  onPicksPerPassChange,
}: AdvancedToggleProps) {
  return (
    <details
      className="rounded-md border border-border/40 bg-card/20 px-3 py-2 text-xs"
      open={open}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open !== open) onToggle();
      }}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-muted-foreground">
        <Dice5 className="h-3.5 w-3.5" />
        <span>Advanced</span>
        {seed.trim() && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            seed = {seed.trim()}
          </span>
        )}
        {picksPerPass > 1 && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            {picksPerPass}× pick
          </span>
        )}
      </summary>
      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2">
            <span>RNG seed</span>
            <Input
              type="text"
              inputMode="numeric"
              value={seed}
              onChange={(e) => onSeedChange(e.target.value)}
              placeholder="random"
              className="h-7 w-32 font-mono text-xs"
              title="Optional integer for reproducible opens. Leave blank for random."
            />
            {seed && (
              <button
                type="button"
                onClick={() => onSeedChange("")}
                className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                clear
              </button>
            )}
          </label>
          <span className="text-[10px] text-muted-foreground">
            Same seed + same pool → identical packs every open.
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="picksPerPass" className="flex items-center gap-2">
            <span>Picks per pass</span>
            <Input
              id="picksPerPass"
              type="number"
              min={1}
              max={4}
              value={picksPerPass}
              onChange={(e) =>
                onPicksPerPassChange(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
              }
              className="h-7 w-16 text-xs"
              title="Booster Draft only. 1 = vanilla MTG. 2+ = each seat picks N cards before passing."
            />
          </label>
          <span className="text-[10px] text-muted-foreground">
            Booster Draft only. With 4-player pods, raise to 2 so each seat ends with ~30 picks.
          </span>
        </div>
      </div>
    </details>
  );
}

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  disabled: boolean;
  onStart: () => void;
  children?: React.ReactNode;
  footnote?: React.ReactNode;
}

function ModeCard({
  icon,
  title,
  description,
  ctaLabel,
  disabled,
  onStart,
  children,
  footnote,
}: ModeCardProps) {
  return (
    <div
      className={cn(
        "group flex flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-4 transition",
        disabled
          ? "opacity-90"
          : "hover:border-primary/60 hover:bg-card/70 hover:shadow-[0_0_0_1px_var(--color-primary)]/20",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "rounded-md border border-border/50 bg-card p-1.5 transition",
            "group-hover:border-primary/40 group-hover:text-primary",
          )}
        >
          {icon}
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <div className="flex flex-col gap-2">
        {children}
        <Button onClick={onStart} disabled={disabled} className="w-full">
          {ctaLabel}
        </Button>
        {footnote && <p className="truncate text-[10px] text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
        className="h-7 w-16 text-xs"
      />
    </label>
  );
}

function ctaLabel(
  fetching: boolean,
  starting: boolean,
  busyLabel: string,
  defaultLabel: string,
): string {
  if (fetching) return "Fetching set…";
  if (starting) return `${busyLabel}…`;
  return defaultLabel;
}

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}

function CollapsibleSection({ icon, title, count, children }: CollapsibleSectionProps) {
  if (count === 0) return null;
  return (
    <details className="rounded-md border border-border/40 bg-card/20 px-3 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground/90">
        {icon}
        <span className="font-semibold uppercase tracking-wide text-xs">{title}</span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px]">{count}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function matchSetsForTheme(tag: string, sets: ScryfallSet[]): ScryfallSet[] {
  const sorted = [...sets].sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
  switch (tag.toUpperCase()) {
    case "STANDARD": {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 3);
      const stamp = cutoff.toISOString().slice(0, 10);
      return sorted
        .filter((s) => s.set_type === "expansion" && (s.released_at ?? "") >= stamp)
        .slice(0, 8);
    }
    case "PIONEER": {
      const cutoff = "2012-10-05"; // Return to Ravnica era.
      return sorted
        .filter((s) => s.set_type === "expansion" && (s.released_at ?? "") >= cutoff)
        .slice(0, 8);
    }
    case "MODERN": {
      const cutoff = "2003-07-28"; // Eighth Edition era.
      return sorted
        .filter((s) => s.set_type === "expansion" && (s.released_at ?? "") >= cutoff)
        .slice(0, 8);
    }
    case "DEFAULT":
    default:
      return sorted.slice(0, 6);
  }
}

interface CubeStartActionsProps {
  cube: { name: string; cardCount: number; numPacks: number; singleton: boolean };
  numBoosters: number;
  podSize: number;
  winstonPacks: number;
  seed: number | undefined;
  isStarting: boolean;
  onStartSealed: () => void | Promise<void>;
  onStartDraft: () => void | Promise<void>;
  onStartWinston: () => void | Promise<void>;
}

function CubeStartActions({
  cube,
  numBoosters,
  podSize,
  winstonPacks,
  seed,
  isStarting,
  onStartSealed,
  onStartDraft,
  onStartWinston,
}: CubeStartActionsProps) {
  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="h-4 w-4 text-primary" />
            Start from imported cube
          </h3>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/90">{cube.name}</span> · {cube.cardCount}{" "}
            cards · {cube.numPacks} packs/player{" "}
            {cube.singleton && <span className="text-muted-foreground">· singleton</span>}
            {seed !== undefined && (
              <span className="ml-2 font-mono text-[10px] text-primary">seed {seed}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={isStarting} onClick={onStartSealed}>
            <Boxes className="mr-1.5 h-4 w-4" />
            Sealed ({numBoosters} packs)
          </Button>
          <Button size="sm" variant="outline" disabled={isStarting} onClick={onStartDraft}>
            <Swords className="mr-1.5 h-4 w-4" />
            Draft (pod {podSize})
          </Button>
          <Button size="sm" variant="outline" disabled={isStarting} onClick={onStartWinston}>
            <Layers className="mr-1.5 h-4 w-4" />
            Winston ({winstonPacks} packs)
          </Button>
        </div>
      </div>
    </section>
  );
}
