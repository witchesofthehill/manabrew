import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, LockKeyhole, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetPicker } from "@/components/limited/SetPicker";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { fetchSetPool } from "@/api/limitedEdition";
import { EngineMark } from "@/components/lobby/EngineMark";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { TableSetupGameCard } from "@/components/lobby/TableSetupGameCard";
import { TableSetupHostingCard } from "@/components/lobby/TableSetupHostingCard";
import { TableCreatingSplash } from "@/components/lobby/TableCreatingSplash";
import {
  CREATE_SPLASH_MIN_MS,
  LIMITED_KINDS,
  PLAYER_OPTIONS_LIMITED,
  PLAYER_OPTIONS_MATCH,
  defaultMatchPlayers,
  type LimitedKind,
  type RoomKind,
} from "@/components/lobby/tableSetup.constants";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useServerStore } from "@/stores/useServerStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useForgeRoomAvailabilityStore } from "@/stores/useForgeRoomAvailabilityStore";
import { getPlatformType } from "@/platform";
import { claimHostedTable } from "@/game/hostedAiPlay";
import { isFeatureEnabled } from "@/featureFlags";
import { cn } from "@/lib/utils";
import { IRONSMITH_WASM_AVAILABLE } from "@/game/ironsmithWasmAvailable";
import { DEFAULT_RECONNECT_TIMEOUT_S } from "@/types/server";
import type {
  DraftConfig,
  EngineKind,
  GameFormat,
  RoomPlayerInfo,
  SealedConfig,
} from "@/types/server";
import type { CubeImportResult } from "@/types/limited";

interface TableSetupProps {
  username: string | null;
  onClose: () => void;
  onCreatingChange: (label: string | null) => void;
}

export function TableSetup({ username, onClose, onCreatingChange }: TableSetupProps) {
  const { connected, createRoom } = useServerStore();
  const isTauri = getPlatformType() === "tauri";
  const forgeRoomAvailable = useForgeRoomAvailabilityStore((state) => state.available);
  const ironsmithOptedIn = usePreferencesStore((s) => s.ironsmithRuntimeEnabled);
  const ironsmithEnabled =
    isFeatureEnabled("ironsmithRuntime") && IRONSMITH_WASM_AVAILABLE && ironsmithOptedIn;
  const forgeWasm = isFeatureEnabled("forgeWasm");
  const hostedNode = !isTauri && !forgeWasm;
  const canHostForge = (isTauri && forgeRoomAvailable) || forgeWasm || hostedNode;

  const [engine, setEngine] = useState<EngineKind>(canHostForge ? "Forge" : "Manabrew");
  const [kind, setKind] = useState<RoomKind>(
    () => usePreferencesStore.getState().lastRoomSetup?.kind ?? "match",
  );
  const [limitedKind, setLimitedKind] = useState<LimitedKind>(
    () => usePreferencesStore.getState().lastRoomSetup?.limitedKind ?? "draft",
  );
  const [format, setFormat] = useState<GameFormat>(
    () => usePreferencesStore.getState().lastRoomSetup?.format ?? "Commander",
  );
  const [matchPlayersOverride, setMatchPlayersOverride] = useState<number | null>(() => {
    const last = usePreferencesStore.getState().lastRoomSetup;
    return last?.kind === "match" ? last.players : null;
  });
  const [limitedPlayers, setLimitedPlayers] = useState(() => {
    const last = usePreferencesStore.getState().lastRoomSetup;
    return last?.kind === "limited" ? (last.players ?? 8) : 8;
  });
  const [roomName, setRoomName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [reconnectTimeoutS, setReconnectTimeoutS] = useState<number>(DEFAULT_RECONNECT_TIMEOUT_S);

  const [draftSet, setDraftSet] = useState("");
  const [draftRounds, setDraftRounds] = useState(3);
  const [draftPicksPerPass, setDraftPicksPerPass] = useState(1);
  const [draftSeed, setDraftSeed] = useState("");
  const [draftFillWithBots, setDraftFillWithBots] = useState(true);

  const [sealedSet, setSealedSet] = useState("");
  const [sealedNumBoosters, setSealedNumBoosters] = useState(6);
  const [sealedSeed, setSealedSeed] = useState("");
  const [sealedUseCube, setSealedUseCube] = useState(false);

  const [importedCube, setImportedCube] = useState<CubeImportResult | null>(null);
  const [creating, setCreating] = useState(false);

  const draftPool = useSetPoolStatus(draftSet);
  const sealedPool = useSetPoolStatus(sealedSet);
  const allSets = useScryfallStore((s) => s.sets);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draftableSets = useMemo(
    () =>
      [...(allSets ?? [])]
        .filter((s) => DRAFTABLE_SET_TYPES.has(s.set_type) && !s.digital && s.card_count > 0)
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "")),
    [allSets],
  );

  const isBoosterDraft = kind === "limited" && limitedKind === "draft";
  const isCube = kind === "limited" && limitedKind === "cube";
  const isSealed = kind === "limited" && limitedKind === "sealed";
  const showPicker = isBoosterDraft || (isSealed && !sealedUseCube);
  const pickerSet = isSealed ? sealedSet : draftSet;
  const pickerUnsupported = isSealed ? sealedPool.unsupported : draftPool.unsupported;
  const pickerPrefetching = isSealed ? sealedPool.prefetching : draftPool.prefetching;
  const pickerOnSelect = isSealed ? setSealedSet : setDraftSet;
  const limitedKindEnabled =
    kind !== "limited" || (LIMITED_KINDS.find((k) => k.value === limitedKind)?.enabled ?? false);
  const draftConfigReady =
    (!isBoosterDraft || (!!draftSet && draftPool.unsupported !== draftSet)) &&
    (!isCube || !!importedCube) &&
    (!isSealed ||
      (sealedUseCube ? !!importedCube : !!sealedSet && sealedPool.unsupported !== sealedSet));
  const canSubmit = connected && limitedKindEnabled && draftConfigReady;

  const playerOptions = kind === "limited" ? PLAYER_OPTIONS_LIMITED : PLAYER_OPTIONS_MATCH;
  const matchPlayers = matchPlayersOverride ?? defaultMatchPlayers(format);
  const maxPlayers = kind === "limited" ? limitedPlayers : matchPlayers;
  const handleMaxPlayersChange = kind === "limited" ? setLimitedPlayers : setMatchPlayersOverride;

  const defaultName = `${username ?? "Player"}'s Table`;
  const submittedEngine: EngineKind =
    kind === "match" && (engine !== "Forge" || canHostForge) ? engine : "Manabrew";
  const modeLabel =
    kind === "limited"
      ? (LIMITED_KINDS.find((k) => k.value === limitedKind)?.label ?? "Limited")
      : format;
  const poolLabel = isBoosterDraft
    ? draftSet
      ? draftSet.toUpperCase()
      : null
    : isCube || (isSealed && sealedUseCube)
      ? (importedCube?.name ?? null)
      : isSealed
        ? sealedSet
          ? sealedSet.toUpperCase()
          : null
        : null;

  const disabledReason = !connected
    ? "Connect to multiplayer to open a table."
    : !limitedKindEnabled
      ? "That limited mode isn't wired for multiplayer yet."
      : isBoosterDraft && (!draftSet || draftPool.unsupported === draftSet)
        ? "Pick a set for the draft below."
        : (isCube || (isSealed && sealedUseCube)) && !importedCube
          ? "Import a cube before creating the table."
          : isSealed && !sealedUseCube && (!sealedSet || sealedPool.unsupported === sealedSet)
            ? "Pick a set for sealed below."
            : null;
  const onNode = submittedEngine === "Forge" && hostedNode;
  const splashLabel = onNode ? "Finding you a table\u2026" : "Setting the table\u2026";
  const openTableHint = onNode
    ? "A Manabrew node hosts this table, under its own name. Anyone in the lobby can take a seat."
    : roomPassword.trim()
      ? "People with the password can join."
      : "Anyone in the lobby can take a seat.";

  const hostUsername = username ?? "You";
  const hostPlayer: RoomPlayerInfo = { username: hostUsername, ready: true, connected: true };

  async function handleCreate() {
    if (!canSubmit) return;
    setCreating(true);
    onCreatingChange(splashLabel);
    const splashUntil = Date.now() + CREATE_SPLASH_MIN_MS;
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
          set_code: sealedUseCube ? undefined : sealedSet,
          cube_id: sealedUseCube ? importedCube!.cubeId : undefined,
          cube_name: sealedUseCube ? importedCube!.name : undefined,
          singleton: sealedUseCube ? importedCube!.singleton : false,
          num_boosters: sealedNumBoosters,
          base_seed: Number.isFinite(parsedSeed) ? parsedSeed : undefined,
        };
      }
      if (onNode) {
        await claimHostedTable(submittedFormat, maxPlayers);
      } else {
        const password = roomPassword.trim() || undefined;
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
      }
      usePreferencesStore.getState().setLastRoomSetup({
        kind,
        limitedKind,
        format,
        players: kind === "limited" ? limitedPlayers : matchPlayersOverride,
      });
      await new Promise((resolve) => setTimeout(resolve, splashUntil - Date.now()));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't create the table.");
    } finally {
      setCreating(false);
      onCreatingChange(null);
    }
  }

  if (creating) return <TableCreatingSplash label={splashLabel} />;

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex min-h-full flex-col gap-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-primary/30 bg-card/85 shadow-xl backdrop-blur-md">
            <div className={cn("border-b border-border/60 px-5 py-4", onNode && "hidden")}>
              <input
                id="table-name"
                aria-label="Table name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder={defaultName}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent font-serif text-xl font-normal text-foreground outline-none placeholder:text-foreground sm:text-2xl"
              />
              <div className="mt-3 flex max-w-64 items-center gap-1.5">
                {roomPassword.trim() && (
                  <LockKeyhole
                    aria-label="Password protected"
                    className="h-3 w-3 shrink-0 text-muted-foreground"
                  />
                )}
                <input
                  aria-label="Password (optional)"
                  type="text"
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder="Password (optional)"
                  autoComplete="off"
                  className="w-full bg-transparent text-xs text-foreground/80 outline-none placeholder:text-foreground/80"
                />
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
              <OpenTableSeats
                players={[hostPlayer]}
                maxPlayers={maxPlayers}
                showSeatLabels
                youUsername={hostUsername}
                size="room"
                className="max-w-3xl"
                centerContent={
                  <span className="flex flex-col items-center gap-1 px-2 text-center">
                    <span className="font-serif text-lg font-light text-foreground/90 sm:text-2xl">
                      {modeLabel}
                    </span>
                    <span className="flex flex-wrap items-center justify-center gap-1 text-[11px] text-muted-foreground sm:text-xs">
                      <EngineMark engine={submittedEngine} className="h-3 w-3" />
                      {[submittedEngine, poolLabel, `${maxPlayers} seats`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                }
              />
            </div>
            <div className="flex flex-col gap-3 border-t border-border/60 bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <p className="min-w-0 text-xs text-muted-foreground sm:text-sm">
                {disabledReason ?? openTableHint}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !canSubmit}
                  title={disabledReason ?? undefined}
                  className="gap-1.5"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Swords className="h-4 w-4" />
                  )}
                  {creating ? "Creating…" : "Create table"}
                </Button>
              </div>
            </div>
          </section>

          <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <TableSetupGameCard
              kind={kind}
              onKindChange={setKind}
              limitedKind={limitedKind}
              onLimitedKindChange={setLimitedKind}
              format={format}
              onFormatChange={setFormat}
              playerOptions={playerOptions}
              maxPlayers={maxPlayers}
              onMaxPlayersChange={handleMaxPlayersChange}
              isBoosterDraft={isBoosterDraft}
              isCube={isCube}
              isSealed={isSealed}
              draftRounds={draftRounds}
              onDraftRoundsChange={setDraftRounds}
              draftPicksPerPass={draftPicksPerPass}
              onDraftPicksPerPassChange={setDraftPicksPerPass}
              draftSeed={draftSeed}
              onDraftSeedChange={setDraftSeed}
              draftFillWithBots={draftFillWithBots}
              onDraftFillWithBotsChange={setDraftFillWithBots}
              sealedUseCube={sealedUseCube}
              onSealedUseCubeChange={setSealedUseCube}
              sealedNumBoosters={sealedNumBoosters}
              onSealedNumBoostersChange={setSealedNumBoosters}
              sealedSeed={sealedSeed}
              onSealedSeedChange={setSealedSeed}
              importedCube={importedCube}
              onCubeImported={setImportedCube}
            />
            <TableSetupHostingCard
              kind={kind}
              engine={engine}
              onEngineChange={setEngine}
              canHostForge={canHostForge}
              isTauri={isTauri}
              hostedNode={hostedNode}
              forgeRoomAvailable={forgeRoomAvailable}
              ironsmithEnabled={ironsmithEnabled}
              reconnectTimeoutS={reconnectTimeoutS}
              onReconnectTimeoutSChange={setReconnectTimeoutS}
            />
          </aside>
        </div>

        {showPicker && (
          <div className="space-y-2">
            {draftableSets.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading sets from Scryfall…
              </p>
            ) : (
              <SetPicker
                variant="inline"
                sets={draftableSets}
                selectedCode={pickerSet}
                prefetching={pickerPrefetching}
                onSelect={pickerOnSelect}
              />
            )}
            {!!pickerSet && pickerUnsupported === pickerSet && (
              <p className="text-[11px] text-destructive">
                Your game data doesn't include {pickerSet.toUpperCase()}. Update the app to use this
                set.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function useSetPoolStatus(setCode: string) {
  const prefetchSet = useScryfallStore((s) => s.prefetchSet);
  const [prefetching, setPrefetching] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  useEffect(() => {
    if (!setCode) return;
    let cancelled = false;
    void (async () => {
      setPrefetching(setCode);
      await prefetchSet(setCode).catch(() => {});
      if (!cancelled) setPrefetching((cur) => (cur === setCode ? null : cur));
    })();
    return () => {
      cancelled = true;
    };
  }, [setCode, prefetchSet]);

  useEffect(() => {
    if (!setCode) return;
    let cancelled = false;
    void (async () => {
      try {
        await fetchSetPool(setCode);
        if (!cancelled) setUnsupported(null);
      } catch {
        if (!cancelled) setUnsupported(setCode);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setCode]);

  return { prefetching, unsupported };
}
