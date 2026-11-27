import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LockKeyhole, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EngineMark } from "@/components/lobby/EngineMark";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { TableSetupGameCard } from "@/components/lobby/TableSetupGameCard";
import { TableSetupHostingCard } from "@/components/lobby/TableSetupHostingCard";
import { TableSetupTableCard } from "@/components/lobby/TableSetupTableCard";
import { boardBackgroundUrl, type BoardBackgroundId } from "@/pixi/board/boardBackgrounds";
import { TableCreatingSplash } from "@/components/lobby/TableCreatingSplash";
import { CREATE_SPLASH_MIN_MS, defaultMatchPlayers } from "@/components/lobby/tableSetup.constants";
import { useServerStore } from "@/stores/useServerStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useForgeRoomAvailabilityStore } from "@/stores/useForgeRoomAvailabilityStore";
import { getPlatformType } from "@/platform";
import { claimHostedTable } from "@/game/hostedAiPlay";
import { isFeatureEnabled } from "@/featureFlags";
import { trackClientUiAction } from "@/lib/clientAnalyticsFunnel";
import { forgeWasmNeedsValidation, useForgeWasmHostingEnabled } from "@/lib/forgeWasm";
import { validateForgeWasm } from "@/game/forgeWasmValidation";
import { cn } from "@/lib/utils";
import { IRONSMITH_WASM_AVAILABLE } from "@/game/ironsmithWasmAvailable";
import { DEFAULT_RECONNECT_TIMEOUT_S } from "@/types/server";
import type { GameFormat, RoomPlayerInfo } from "@/types/server";
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
  const forgeWasm = useForgeWasmHostingEnabled();
  const hostedNode = isTauri ? !forgeRoomAvailable : !forgeWasm;
  const [selectedEngine, setEngine] = useState<"Forge" | "Ironsmith">("Forge");
  const engine = ironsmithEnabled ? selectedEngine : "Forge";
  const [format, setFormat] = useState<GameFormat>(
    () => usePreferencesStore.getState().lastRoomSetup?.format ?? "Commander",
  );
  const [matchPlayersOverride, setMatchPlayersOverride] = useState<number | null>(() => {
    const last = usePreferencesStore.getState().lastRoomSetup;
    return last?.kind === "match" ? last.players : null;
  });
  const [roomName, setRoomName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [reconnectTimeoutS, setReconnectTimeoutS] = useState<number>(DEFAULT_RECONNECT_TIMEOUT_S);
  const [creating, setCreating] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState<string | null>(null);
  const showSplash = (label: string | null) => {
    setCreatingLabel(label);
    onCreatingChange(label);
  };
  const [background, setBackground] = useState<BoardBackgroundId>(
    () => usePreferencesStore.getState().tableBackground,
  );
  const chooseBackground = (id: BoardBackgroundId) => {
    setBackground(id);
    usePreferencesStore.getState().setTableBackground(id);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const maxPlayers = matchPlayersOverride ?? defaultMatchPlayers(format);
  const defaultName = `${username ?? `Player`}'s Table`;
  const disabledReason = connected ? null : "Connect to multiplayer to open a table.";
  const onNode = engine === "Forge" && hostedNode;
  const splashLabel = onNode ? `Finding you a table\u2026` : `Setting the table\u2026`;
  const openTableHint = onNode
    ? `A Manabrew node hosts this table, under its own name. Anyone in the lobby can take a seat.`
    : roomPassword.trim()
      ? `People with the password can join.`
      : `Anyone in the lobby can take a seat.`;
  const hostUsername = username ?? "You";
  const hostPlayer: RoomPlayerInfo = { username: hostUsername, ready: true, connected: true };
  async function handleCreate() {
    if (!connected) return;
    trackClientUiAction("lobby_create_table");
    setCreating(true);
    const checking = engine === "Forge" && forgeWasm && !isTauri && forgeWasmNeedsValidation();
    showSplash(checking ? "Checking browser engine support\u2026" : splashLabel);
    let splashUntil = Date.now() + CREATE_SPLASH_MIN_MS;
    try {
      let useNode = onNode;
      if (checking) {
        useNode = !(await validateForgeWasm());
        showSplash(useNode ? "Finding you a table\u2026" : splashLabel);
        splashUntil = Date.now() + CREATE_SPLASH_MIN_MS;
      }
      if (useNode) {
        await claimHostedTable(format, maxPlayers);
      } else {
        const password = roomPassword.trim() || undefined;
        await createRoom(
          roomName.trim() || defaultName,
          maxPlayers,
          format,
          engine,
          reconnectTimeoutS,
          password,
          background,
        );
      }
      usePreferencesStore.getState().setLastRoomSetup({
        kind: "match",
        format,
        players: matchPlayersOverride,
      });
      await new Promise((resolve) => setTimeout(resolve, splashUntil - Date.now()));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Couldn't create the table.`);
    } finally {
      setCreating(false);
      showSplash(null);
    }
  }

  if (creating) {
    return <TableCreatingSplash label={creatingLabel ?? splashLabel} />;
  }
  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex min-h-full flex-col gap-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex flex-col overflow-hidden rounded-2xl border border-primary/30 bg-card/85 shadow-xl backdrop-blur-md">
            <div className={cn("border-b border-border/60 px-5 py-4", onNode && "hidden")}>
              <input
                id="table-name"
                aria-label={`Table name`}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder={defaultName}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent font-serif text-xl font-semibold text-foreground outline-none placeholder:text-foreground sm:text-2xl touch:min-h-11 touch:min-w-11"
              />
              <div className="mt-3 flex max-w-64 items-center gap-1.5">
                {roomPassword.trim() && (
                  <LockKeyhole
                    aria-label={`Password protected`}
                    className="h-3 w-3 shrink-0 text-muted-foreground"
                  />
                )}
                <input
                  aria-label={`Password (optional)`}
                  type="text"
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  placeholder={`Password (optional)`}
                  autoComplete="off"
                  className="w-full bg-transparent text-ui-input text-foreground/80 outline-none placeholder:text-foreground/80 touch:min-h-11 touch:min-w-11"
                />
              </div>
            </div>
            <TableSetupTableCard background={background} onBackgroundChange={chooseBackground} />
            <div className="flex flex-1 items-center justify-center p-3 sm:p-4">
              <OpenTableSeats
                players={[hostPlayer]}
                maxPlayers={maxPlayers}
                showSeatLabels
                youUsername={hostUsername}
                size="room"
                className="h-[min(30rem,42dvh)] w-auto max-w-full"
                backgroundUrl={boardBackgroundUrl(background)}
                centerContent={
                  <span className="flex flex-col items-center gap-1 px-2 text-center">
                    <span className="font-serif text-lg font-semibold text-foreground/90 sm:text-2xl">
                      {format}
                    </span>
                    <span className="flex flex-wrap items-center justify-center gap-1 text-ui-meta text-muted-foreground">
                      <EngineMark engine={engine} className="h-3 w-3" />
                      {engine} · {maxPlayers} seats
                    </span>
                  </span>
                }
              />
            </div>
            <div className="flex flex-col gap-3 border-t border-border/60 bg-background/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <p className="min-w-0 text-ui-meta text-muted-foreground">
                {disabledReason ?? openTableHint}
              </p>
              <div className="flex flex-wrap shrink-0 gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreate}
                  disabled={!connected}
                  title={disabledReason ?? undefined}
                  className="gap-1.5"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Swords className="h-4 w-4" />
                  )}
                  {creating ? `Creating\u2026` : `Create table`}
                </Button>
              </div>
            </div>
          </section>

          <aside className="grid content-start gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] xl:grid-cols-1">
            <TableSetupGameCard
              format={format}
              onFormatChange={setFormat}
              maxPlayers={maxPlayers}
              onMaxPlayersChange={setMatchPlayersOverride}
            />
            <TableSetupHostingCard
              engine={engine}
              onEngineChange={setEngine}
              isTauri={isTauri}
              hostedNode={hostedNode}
              ironsmithEnabled={ironsmithEnabled}
              reconnectTimeoutS={reconnectTimeoutS}
              onReconnectTimeoutSChange={setReconnectTimeoutS}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
