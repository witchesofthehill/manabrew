import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { CardDto, ZoneKind } from "@/protocol/game";
import { GAME_CARD_DEFAULTS, isFacelessCard } from "@/lib/gameCard";
import { BoardCanvas } from "@/pixi/BoardCanvas";
import { BoardOverlayCanvas, type BoardOverlayPreviewSpec } from "@/pixi/BoardOverlayCanvas";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { PhaseStripState } from "@/pixi/PhaseStripLayer";
import type { PlayerHudSpec } from "@/pixi/hud/playerHud.types";
import type { GameCanvasCallbacks } from "@/pixi/types";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useTheme } from "@/hooks/useTheme";
import { useKeybindings } from "@/hooks/useKeybindings";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { PlayerSheetModal } from "@/components/game/panels/PlayerSheetModal";
import { SpellStackModal } from "@/components/game/modals/SpellStackModal";
import { BoardPlaygroundControls } from "@/components/dev/BoardPlaygroundControls";
import { buildPlaygroundSpecs } from "@/components/dev/boardPlayground.specs";
import { parsePrintedCardRailMetadata } from "@/components/game/cardRailState";
import { resolveCardFaces } from "@/lib/cardFaces";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { HandActionOption } from "@/stores/useGameUIStore";
import {
  createPlaygroundTable,
  LOCAL_PLAYER_ID,
  makePlaygroundCard,
  PLAYGROUND_CREATURES,
  PLAYGROUND_LANDS,
  type PlaygroundScenarioId,
} from "@/components/dev/boardPlayground.data";
import { PREVIEW_SCENARIOS } from "./devPreviewScenarios";
import { BoardGameplayPreviewControls } from "./BoardGameplayPreviewControls";
import { useBoardGameplayPreview } from "./useBoardGameplayPreview";
import { BoardPlaygroundZone } from "./BoardPlaygroundZone";

const DEV_MANA_ACTION_ID = "dev-mana";
const PREVIEW_VIEWPORTS = [
  { label: "Desktop", width: undefined, height: "85dvh" },
  { label: "Phone portrait", width: 390, height: 640 },
  { label: "Phone landscape", width: 740, height: 340 },
] as const;

let previewCardSequence = 0;

export function BoardPlayground({ themeEditor = false }: { themeEditor?: boolean }) {
  const [table, setTable] = useState(() =>
    createPlaygroundTable(themeEditor ? "theme" : "opening"),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetPlayerId, setSheetPlayerId] = useState<string | null>(null);
  const [viewingZone, setViewingZone] = useState<{ ownerId: string; zoneId: string } | null>(null);
  const [overview, setOverview] = useState(false);
  const [focusedPlayerId, setFocusedPlayerId] = useState(table.players[1]!.id);
  const [selfStops, setSelfStops] = useState(new Set<string>(["main1", "combatDeclareAttackers"]));
  const [opponentStops, setOpponentStops] = useState(new Map<string, Set<string>>());
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [customName, setCustomName] = useState("");
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState("");
  const [actionCount, setActionCount] = useState(0);
  const [lastAction, setLastAction] = useState("");
  const [viewportIndex, setViewportIndex] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(!themeEditor);
  const nextId = useRef(0);
  const sceneRef = useRef<BoardScene | null>(null);
  const [overlayScene, setOverlayScene] = useState<BoardScene | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const loadGeneration = useRef(0);
  const previewScenarioCardId = useRef<string | null>(null);
  const previewViewSwitchCardIdRef = useRef<string | null>(null);
  const triggerEtbGlow = useGameDevStore((state) => state.triggerEtbGlow);
  const preview = useCardPreview([], { useTriggerPreference: true });
  const compact = useIsMobileGame();
  const theme = useTheme().gameTheme;
  const previewStyle = usePreferencesStore((state) => state.inGameCardPreviewStyle);
  const setPreviewStyle = usePreferencesStore((state) => state.setInGameCardPreviewStyle);
  const previewMode = usePreferencesStore((state) => state.cardPreviewMode);
  const viewport = PREVIEW_VIEWPORTS[viewportIndex]!;
  const showSticky = preview.showSticky;
  const inspect = useCallback(
    (card: CardDto, bounds?: { x: number; y: number; width: number; height: number }) => {
      if (isFacelessCard(card)) return;
      setSelectedId(card.id);
      if (bounds) {
        const rect = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
        showSticky(card, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, rect);
      } else {
        showSticky(card);
      }
    },
    [showSticky],
  );
  const dismissPreview = preview.dismiss;
  const openZone = useCallback(
    (ownerId: string, zoneId: string) => {
      dismissPreview();
      setViewingZone({ ownerId, zoneId });
    },
    [dismissPreview],
  );
  const specs = useMemo(
    () => buildPlaygroundSpecs(table, theme, compact, openZone),
    [table, theme, compact, openZone],
  );
  const gameplay = useBoardGameplayPreview(table, setTable, specs.zones, theme, themeEditor, () =>
    setControlsOpen((open) => (themeEditor ? !open : true)),
  );
  const regions = specs.regions.map((region) => ({
    ...region,
    state: {
      ...region.state,
      selectableCardIds: gameplay.targetIds,
      pendingCardIds: gameplay.selectedTarget ? [gameplay.selectedTarget] : [],
      hostileTargeting: gameplay.mode === "hostile",
      hostileTargetCardIds: gameplay.mode === "hostile" ? gameplay.targetIds : [],
    },
  }));
  const playerBars: PlayerHudSpec[] = specs.playerBars.map((player) => ({
    ...player,
    isTargetable: gameplay.targetPlayerIds.includes(player.playerId) || player.isTargetable,
    isSelectedTarget: gameplay.selectedTarget === player.playerId || player.isSelectedTarget,
    targetingIntent:
      gameplay.mode === "hostile" || gameplay.mode === "friendly" ? gameplay.mode : undefined,
  }));
  const selectCard = (card: CardDto) => {
    setSelectedId(card.id);
    gameplay.selectCard(card);
  };
  const sheetSpec = specs.playerBars.find((spec) => spec.playerId === sheetPlayerId);
  const hand = useMemo(
    () => table.cards.filter((card) => card.zoneId === "hand" && card.ownerId === LOCAL_PLAYER_ID),
    [table.cards],
  );
  const target =
    table.cards.find((card) => card.id === selectedId) ??
    table.cards.filter((card) => card.zoneId === "battlefield").at(-1);
  const targetId = target?.id ?? null;
  const previewCard = table.cards.find((card) => card.id === preview.hoveredCard?.id) ?? null;
  const visibleZone = specs.zones.find(
    (zone) => zone.ownerId === viewingZone?.ownerId && zone.zone === viewingZone.zoneId,
  );

  const loadScenario = (scenario: PlaygroundScenarioId) => {
    const next = createPlaygroundTable(scenario);
    gameplay.closeModal();
    gameplay.setStackDialogOpen(false);
    gameplay.chooseMode("none");
    setTable(next);
    setSelectedId(null);
    setSheetPlayerId(null);
    setViewingZone(null);
    setFocusedPlayerId(next.players[1]!.id);
    setOverview(scenario === "combat" || scenario === "player-panels");
    setSelfStops(new Set(["main1", "combatDeclareAttackers"]));
    setOpponentStops(new Map());
    nextId.current = 0;
    previewScenarioCardId.current = null;
    preview.dismiss();
  };
  const updateCard = (cardId: string | null, update: (card: ClientCardDto) => ClientCardDto) => {
    if (!cardId) return;
    setTable((current) => ({
      ...current,
      cards: current.cards.map((card) => (card.id === cardId ? update(card) : card)),
    }));
  };
  const update = (fn: (card: ClientCardDto) => ClientCardDto) => updateCard(targetId, fn);
  const add = (land: boolean) => {
    const pool = land ? PLAYGROUND_LANDS : PLAYGROUND_CREATURES;
    const id = nextId.current++;
    const card = makePlaygroundCard(pool[id % pool.length]!, `lab-added-${id}`);
    setTable((current) => ({ ...current, cards: [...current.cards, card] }));
    setSelectedId(card.id);
  };
  const move = (zone: ZoneKind | null) => {
    if (!target) return;
    const ids = new Set([target.id, ...target.attachmentIds]);
    if (preview.hoveredCard && ids.has(preview.hoveredCard.id)) preview.dismiss();
    if (!zone && previewScenarioCardId.current && ids.has(previewScenarioCardId.current)) {
      previewScenarioCardId.current = null;
    }
    setTable((current) => ({
      ...current,
      blocks: current.blocks.filter(
        (block) => !ids.has(block.attackerId) && !ids.has(block.blockerId),
      ),
      cards: current.cards.flatMap((card) => {
        if (!ids.has(card.id))
          return [{ ...card, attachmentIds: card.attachmentIds.filter((id) => !ids.has(id)) }];
        if (!zone) return [];
        return [
          {
            ...card,
            zoneId: card.id === target.id ? zone : "graveyard",
            controllerId: card.ownerId,
            tapped: false,
            isAttacking: false,
            attackingPlayerId: undefined,
            attackTargetId: undefined,
            attachedTo: undefined,
            attachmentIds: [],
          },
        ];
      }),
    }));
    if (!zone) setSelectedId(null);
  };
  const hover: GameCanvasCallbacks["onHoverCard"] = (card, bounds, options) => {
    if (!card || !bounds || isFacelessCard(card)) {
      preview.handleMouseLeave();
      return;
    }
    preview.handleMouseEnter(card, undefined, {
      ...options,
      useAnchor: true,
      anchorOverride: new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height),
    });
  };

  const openPreviewScenario = async (index: number, nameOverride?: string) => {
    const generation = ++loadGeneration.current;
    const scenario = PREVIEW_SCENARIOS[index]!;
    const name = nameOverride ?? scenario.name;
    setScenarioIndex(index);
    setScenarioError("");
    setLoadingScenario(true);
    setLastAction("");
    try {
      let card: ClientCardDto;
      if (!name) {
        card = {
          ...GAME_CARD_DEFAULTS,
          id: `preview-${++previewCardSequence}`,
          ownerId: LOCAL_PLAYER_ID,
          controllerId: LOCAL_PLAYER_ID,
          zoneId: "battlefield",
          isFaceDown: true,
          types: ["Creature"],
          power: "2",
          toughness: "2",
        };
      } else {
        const { info } = await useScryfallStore.getState().getCard({ name });
        if (generation !== loadGeneration.current) return;
        const faces = resolveCardFaces(info);
        const back = nameOverride == null && !!scenario.back && faces.isFlippable;
        const face = info.card_faces?.[back ? 1 : 0];
        card = scryfallToSampleGameCard(
          face ? { ...info, ...face, type_line: face.type_line ?? info.type_line } : info,
          {
            id: `preview-${++previewCardSequence}`,
            identity: {
              name: info.name,
              setCode: info.set,
              cardNumber: info.collector_number,
              isToken: info.layout.includes("token"),
            },
            isDoubleFaced: faces.isFlippable,
            isTransformed: back,
            ownerId: LOCAL_PLAYER_ID,
            controllerId: LOCAL_PLAYER_ID,
          },
        );
        const loyalty = face?.loyalty ?? info.loyalty;
        const defense = face?.defense ?? info.defense;
        if (loyalty) card.counters = { Loyalty: Number(loyalty) };
        if (defense) card.counters = { Defense: Number(defense) };
        const rail = parsePrintedCardRailMetadata(card);
        if (rail?.kind === "saga") {
          card.sagaChapters = rail.sagaChapters;
          card.counters = { Lore: 1 };
        } else if (rail?.kind === "class") {
          card.classLevels = rail.classLevels;
          card.classLevel = 1;
        }
      }
      if (generation !== loadGeneration.current) return;
      const previousId = previewScenarioCardId.current;
      previewScenarioCardId.current = card.id;
      preview.dismiss();
      setTable((current) => ({
        ...current,
        blocks: previousId
          ? current.blocks.filter(
              (block) => block.attackerId !== previousId && block.blockerId !== previousId,
            )
          : current.blocks,
        cards: [...current.cards.filter((candidate) => candidate.id !== previousId), card],
      }));
      setSelectedId(card.id);
      boardRef.current?.scrollIntoView({ block: "nearest" });
      preview.showSticky(card);
    } catch (error) {
      if (generation === loadGeneration.current) {
        setScenarioError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === loadGeneration.current) setLoadingScenario(false);
    }
  };

  const showSelectedPreview = () => {
    if (target) preview.showSticky(target, window.innerWidth / 2, window.innerHeight / 2);
  };
  const previewActions = useMemo<HandActionOption[]>(() => {
    if (!previewCard) return [];
    return Array.from({ length: actionCount }, (_, index) => ({
      kind: "ability",
      cardId: previewCard.id,
      actionId: index === 0 ? DEV_MANA_ACTION_ID : `dev-action-${index}`,
      label: index === 0 ? "Add {G}." : `Preview test action ${index + 1}.`,
      cost: index === 0 ? "{T}" : `{${index + 1}}`,
      isManaAbility: index === 0,
      abilityIndex: index,
    }));
  }, [previewCard, actionCount]);
  useEffect(() => {
    if (preview.phase !== "open") previewViewSwitchCardIdRef.current = null;
  }, [preview.phase]);
  const skipPreviewEnterAnimation =
    preview.phase === "open" &&
    previewCard != null &&
    previewViewSwitchCardIdRef.current === previewCard.id;
  const togglePreviewView = () => {
    if (!previewCard) return;
    previewViewSwitchCardIdRef.current = previewCard.id;
    const preferences = usePreferencesStore.getState();
    preferences.setInGameCardPreviewStyle(
      preferences.inGameCardPreviewStyle === "printed" ? "rules" : "printed",
    );
  };
  const rulesPreview: BoardOverlayPreviewSpec | null =
    previewStyle === "rules" && previewCard && preview.phase !== "hidden"
      ? {
          card: previewCard,
          phase: preview.phase === "closing" ? "closing" : "open",
          sticky: preview.isSticky,
          showBackFace: preview.showBackFace,
          suppressed: false,
          skipEnterAnimation: skipPreviewEnterAnimation,
          actions: previewActions,
          mousePos: preview.mousePos,
          anchorRect: preview.anchorRect,
        }
      : null;
  const externalPreviewActive = previewCard !== null && preview.phase === "open";
  useKeybindings(
    externalPreviewActive
      ? {
          "toggle-card-view": togglePreviewView,
        }
      : {},
  );
  const handlePreviewAction = (action: HandActionOption) => {
    setLastAction(`Selected ${action.label} (${action.actionId})`);
    if (action.actionId === DEV_MANA_ACTION_ID) {
      updateCard(action.cardId, (card) => ({ ...card, tapped: true }));
      return;
    }
    updateCard(action.cardId, (card) => ({
      ...card,
      power: String((card.power ? parseInt(card.power, 10) : 0) + 1),
      toughness: String((card.toughness ? parseInt(card.toughness, 10) : 0) + 1),
      counters: { ...(card.counters ?? {}), P1P1: (card.counters?.P1P1 ?? 0) + 1 },
    }));
  };
  const phaseStrip = useMemo<PhaseStripState>(
    () => ({
      currentStep: table.step,
      isActiveTurn: table.activePlayerId === LOCAL_PLAYER_ID,
      activePlayerId: table.activePlayerId,
      priorityPlayerId: table.priorityPlayerId,
      activePlayerName: table.players.find((player) => player.id === table.activePlayerId)!.name,
      priorityPlayerName: table.players.find((player) => player.id === table.priorityPlayerId)!
        .name,
      myPlayerId: LOCAL_PLAYER_ID,
      selfEnabledPhases: selfStops,
      opponentEnabledPhases: opponentStops,
      opponents: table.players.slice(1).map((player, index) => ({ id: player.id, index })),
      isInteractive: true,
    }),
    [
      table.step,
      table.activePlayerId,
      table.priorityPlayerId,
      table.players,
      selfStops,
      opponentStops,
    ],
  );
  return (
    <div className={cn(themeEditor ? "flex h-full min-h-0 flex-col gap-2" : "space-y-3")}>
      <details
        open={controlsOpen}
        onToggle={(event) => setControlsOpen(event.currentTarget.open)}
        className={cn(
          themeEditor && "max-h-[30%] shrink-0 overflow-y-auto rounded-lg border border-border",
          visibleZone && "hidden md:block",
        )}
      >
        <summary
          className={cn("cursor-pointer px-3 py-2 text-xs font-medium", !themeEditor && "hidden")}
        >
          Table and card controls
        </summary>
        <div
          className={cn(
            "space-y-3",
            themeEditor && "max-h-36 overflow-y-auto overscroll-contain p-2 sm:max-h-44",
          )}
        >
          <BoardPlaygroundControls
            key={table.scenario}
            table={table}
            setTable={setTable}
            loadScenario={loadScenario}
            overview={overview}
            setOverview={setOverview}
            focusedPlayerId={focusedPlayerId}
            setFocusedPlayerId={setFocusedPlayerId}
          />
          <div className="space-y-2 rounded-lg bg-muted p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium" htmlFor="preview-scenario">
                Preview scenario
              </label>
              <select
                id="preview-scenario"
                className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm"
                value={scenarioIndex}
                onChange={(event) => void openPreviewScenario(Number(event.target.value))}
              >
                {PREVIEW_SCENARIOS.map((scenario, index) => (
                  <option key={scenario.label} value={index}>
                    {scenario.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={loadingScenario}
                onClick={() =>
                  void openPreviewScenario(
                    (scenarioIndex + PREVIEW_SCENARIOS.length - 1) % PREVIEW_SCENARIOS.length,
                  )
                }
              >
                Previous
              </Button>
              <Button
                size="sm"
                disabled={loadingScenario}
                onClick={() => void openPreviewScenario(scenarioIndex)}
              >
                {loadingScenario ? "Loading card…" : "Open scenario"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={loadingScenario}
                onClick={() =>
                  void openPreviewScenario((scenarioIndex + 1) % PREVIEW_SCENARIOS.length)
                }
              >
                Next
              </Button>
            </div>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (customName.trim()) void openPreviewScenario(scenarioIndex, customName.trim());
              }}
            >
              <Input
                aria-label="Custom preview card name"
                placeholder="Any card name"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                className="max-w-72"
              />
              <Button
                size="sm"
                variant="outline"
                type="submit"
                disabled={loadingScenario || !customName.trim()}
              >
                Open card
              </Button>
              <label className="flex items-center gap-2 text-sm">
                Test actions
                <select
                  aria-label="Test action count"
                  className="h-9 rounded-md border border-input bg-background px-2"
                  value={actionCount}
                  onChange={(event) => setActionCount(Number(event.target.value))}
                >
                  {[0, 2, 9].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                Viewport
                <select
                  aria-label="Preview viewport"
                  className="h-9 rounded-md border border-input bg-background px-2"
                  value={viewportIndex}
                  onChange={(event) => setViewportIndex(Number(event.target.value))}
                >
                  {PREVIEW_VIEWPORTS.map((size, index) => (
                    <option key={size.label} value={index}>
                      {size.label}
                    </option>
                  ))}
                </select>
              </label>
            </form>
            <p className="text-xs text-muted-foreground">
              Each scenario opens a real Scryfall card on the living table. Flip changes the
              displayed face; rotate switches portrait and landscape without rotating rules text.
              Test actions stay local to the playground.
            </p>
            {scenarioError && (
              <p role="alert" className="text-sm text-destructive">
                {scenarioError}
              </p>
            )}
            {lastAction && (
              <p role="status" className="text-xs text-muted-foreground">
                {lastAction}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => add(false)}>
              + Creature
            </Button>
            <Button size="sm" variant="outline" onClick={() => add(true)}>
              + Land
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update((card) => ({ ...card, tapped: !card.tapped }))}
              disabled={!target}
            >
              Tap / untap
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update((card) => ({ ...card, damage: card.damage + 1 }))}
              disabled={!target}
            >
              Damage
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update((card) => ({
                  ...card,
                  power: String(Number(card.power) + 1),
                  toughness: String(Number(card.toughness) + 1),
                  counters: { ...card.counters, P1P1: (card.counters.P1P1 ?? 0) + 1 },
                }))
              }
              disabled={!target?.types.includes("Creature")}
            >
              +1/+1
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update((card) => {
                  const defender =
                    card.controllerId === focusedPlayerId ? LOCAL_PLAYER_ID : focusedPlayerId;
                  return {
                    ...card,
                    isAttacking: !card.isAttacking,
                    attackingPlayerId: card.isAttacking ? undefined : defender,
                    attackTargetId: card.isAttacking ? undefined : defender,
                  };
                })
              }
              disabled={!target?.types.includes("Creature") || target.zoneId !== "battlefield"}
            >
              Attack
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => move("graveyard")}
              disabled={!target}
            >
              To graveyard
            </Button>
            <Button size="sm" variant="outline" onClick={() => move("exile")} disabled={!target}>
              To exile
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => move("battlefield")}
              disabled={!target || target.zoneId === "battlefield"}
            >
              To battlefield
            </Button>
            <Button size="sm" variant="outline" onClick={() => move(null)} disabled={!target}>
              Remove
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => target && inspect(target)}
              disabled={!target}
            >
              Inspect
            </Button>
            <Button size="sm" variant="outline" onClick={triggerEtbGlow}>
              Replay entry effect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                preview.dismiss();
                previewScenarioCardId.current = null;
                setTable((current) => ({
                  ...current,
                  cards: current.cards.filter((card) => card.zoneId !== "battlefield"),
                  blocks: [],
                }));
                setSelectedId(null);
              }}
            >
              Clear battlefield
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              size="sm"
              variant={previewStyle === "printed" ? "default" : "outline"}
              onClick={() => setPreviewStyle("printed")}
            >
              Printed preview
            </Button>
            <Button
              size="sm"
              variant={previewStyle === "rules" ? "default" : "outline"}
              onClick={() => setPreviewStyle("rules")}
            >
              Rules preview
            </Button>
            <Button size="sm" variant="outline" onClick={showSelectedPreview} disabled={!targetId}>
              Open selected preview
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {target
              ? `Selected: ${target.identity.name} · ${table.players.find((player) => player.id === target.controllerId)?.name} · ${target.zoneId}. `
              : "Select a card to use the controls. "}
            Click selects; hover or long-press inspects. Phase-strip stops are interactive. No game
            actions reach a backend.
          </p>
        </div>
      </details>
      <div
        className={cn(
          "flex max-h-[20%] shrink-0 items-start gap-2 overflow-y-auto",
          visibleZone && "hidden md:flex",
        )}
      >
        <BoardGameplayPreviewControls
          mode={gameplay.mode}
          onModeChange={gameplay.chooseMode}
          modalOpen={gameplay.modal !== null}
          modalHidden={gameplay.modalHidden}
          onOpenModal={(kind) => {
            preview.dismiss();
            setViewingZone(null);
            gameplay.openModal(kind);
          }}
          onCloseModal={gameplay.closeModal}
          onShowModal={() => gameplay.setModalHidden(false)}
          stackVisible={gameplay.stackVisible}
          onToggleStack={() => gameplay.setStackVisible((visible) => !visible)}
          outcome={gameplay.outcome}
        />
        <Button
          size="sm"
          variant={visibleZone?.zone === "graveyard" ? "secondary" : "outline"}
          onClick={() =>
            visibleZone?.zone === "graveyard"
              ? setViewingZone(null)
              : openZone(LOCAL_PLAYER_ID, "graveyard")
          }
        >
          Graveyard (
          {specs.zones.find((zone) => zone.ownerId === LOCAL_PLAYER_ID && zone.zone === "graveyard")
            ?.count ?? 0}
          )
        </Button>
      </div>
      <div
        ref={boardRef}
        style={{ width: viewport.width, height: themeEditor ? undefined : viewport.height }}
        className={cn(
          "relative max-w-full overflow-hidden rounded-lg border border-border bg-background",
          themeEditor ? "min-h-0 flex-1" : "min-h-80",
        )}
      >
        <BoardCanvas
          regions={regions}
          hand={{ cards: hand }}
          arrowSpecs={gameplay.arrowSpecs}
          focusLocked={!!sheetPlayerId || preview.isSticky || gameplay.modal !== null}
          sceneRef={sceneRef}
          onSceneChange={setOverlayScene}
          externalPreviewActive={externalPreviewActive}
          combatBlocks={specs.blocks}
          combatFocusIds={specs.combatFocusIds}
          phaseStrip={phaseStrip}
          phaseStripCallbacks={{
            onToggleSelfPhase: (id) =>
              setSelfStops((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              }),
            onToggleOpponentPhase: (playerId, id) =>
              setOpponentStops((current) => {
                const next = new Map(current);
                const stops = new Set(next.get(playerId));
                if (stops.has(id)) stops.delete(id);
                else stops.add(id);
                next.set(playerId, stops);
                return next;
              }),
          }}
          compact={compact}
          opponentLayout={overview ? "overview" : "focused"}
          focusedOpponentId={focusedPlayerId}
          manualFocusId={focusedPlayerId}
          playerBars={playerBars}
          showPlayerBars
          zoneTiles={specs.zoneTiles}
          callbacks={{
            onClickCard: selectCard,
            onClickAnyCard: selectCard,
            onClickCard_Hand: selectCard,
            onTargetPlayer: gameplay.setSelectedTarget,
            onHoverCard: hover,
            onHoverHandCard: hover,
            onLongPressCard: (card, bounds) => inspect(card, bounds),
            onRightClickCard:
              previewMode === "right-click"
                ? (card, bounds) => {
                    const rect = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
                    preview.showSticky(
                      card,
                      bounds.x + bounds.width / 2,
                      bounds.y + bounds.height / 2,
                      rect,
                    );
                  }
                : undefined,
            onShowPlayerSheet: (playerId) => {
              preview.dismiss();
              setSheetPlayerId(playerId);
            },
            onFlipCard: preview.flipCard,
            onDismissHoverPreview: preview.dismiss,
          }}
        />
        <div className="pointer-events-none absolute inset-0 z-40">
          <BoardOverlayCanvas
            onOpenStack={gameplay.openStack}
            scene={overlayScene}
            stackSpec={gameplay.stackSpec}
            onTargetSpell={gameplay.selectSpell}
            onHoverStack={gameplay.setHoveredSpell}
            onToggleStack={() => gameplay.setStackCollapsed((collapsed) => !collapsed)}
            promptSpec={gameplay.promptSpec}
            externalPreviewActive={externalPreviewActive}
            previewSpec={rulesPreview}
            onPreviewPointerEnter={preview.onMouseEnterPreview}
            onPreviewPointerLeave={preview.onMouseLeavePreview}
            onSelectPreviewAction={handlePreviewAction}
            onDismissPreview={preview.dismiss}
            onFlipPreview={preview.flipCard}
            onTogglePreviewView={togglePreviewView}
          />
        </div>
      </div>
      {visibleZone && (
        <BoardPlaygroundZone
          key={`${visibleZone.ownerId}-${visibleZone.zone}`}
          zone={visibleZone}
          actionableCardIds={table.actionableGraveyardIds}
          onClose={() => setViewingZone(null)}
        />
      )}
      {previewStyle === "printed" && (
        <HoverCardPreview
          preview={{ ...preview, hoveredCard: previewCard }}
          actions={previewActions}
          onSelectAction={handlePreviewAction}
          skipEnterAnimation={skipPreviewEnterAnimation}
          onToggleView={togglePreviewView}
        />
      )}
      {gameplay.stackDialogOpen && (
        <SpellStackModal
          mode={gameplay.mode === "hostile" || gameplay.mode === "friendly" ? "target" : "browse"}
          stack={gameplay.stack}
          validSpellIds={gameplay.stack.map((spell) => spell.id)}
          onTarget={gameplay.selectSpell}
          onCancel={() => gameplay.setStackDialogOpen(false)}
        />
      )}
      {sheetSpec && <PlayerSheetModal spec={sheetSpec} onClose={() => setSheetPlayerId(null)} />}
    </div>
  );
}
