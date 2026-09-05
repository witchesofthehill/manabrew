import { useCallback, useMemo, useRef, useState } from "react";
import type { ClientCardDto } from "@/stores/gameStore.types";
import type { CardDto, ZoneKind } from "@/protocol/game";
import { isFacelessCard } from "@/lib/gameCard";
import { BoardCanvas } from "@/pixi/BoardCanvas";
import type { PhaseStripState } from "@/pixi/PhaseStripLayer";
import type { GameCanvasCallbacks } from "@/pixi/types";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useTheme } from "@/hooks/useTheme";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { Button } from "@/components/ui/button";
import { PlayerSheetModal } from "@/components/game/panels/PlayerSheetModal";
import { BoardPlaygroundControls } from "@/components/dev/BoardPlaygroundControls";
import { buildPlaygroundSpecs } from "@/components/dev/boardPlayground.specs";
import {
  createPlaygroundTable,
  LOCAL_PLAYER_ID,
  makePlaygroundCard,
  PLAYGROUND_CREATURES,
  PLAYGROUND_LANDS,
  type PlaygroundScenarioId,
} from "@/components/dev/boardPlayground.data";

export function BoardPlayground() {
  const [table, setTable] = useState(() => createPlaygroundTable("opening"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetPlayerId, setSheetPlayerId] = useState<string | null>(null);
  const [overview, setOverview] = useState(false);
  const [focusedPlayerId, setFocusedPlayerId] = useState(table.players[1]!.id);
  const [selfStops, setSelfStops] = useState(new Set<string>(["main1", "combatDeclareAttackers"]));
  const [opponentStops, setOpponentStops] = useState(new Map<string, Set<string>>());
  const nextId = useRef(0);
  const triggerEtbGlow = useGameDevStore((state) => state.triggerEtbGlow);
  const preview = useCardPreview([table.cards]);
  const compact = useIsMobileGame();
  const theme = useTheme().gameTheme;
  const showSticky = preview.showSticky;
  const inspect = useCallback(
    (card: CardDto) => {
      if (isFacelessCard(card)) return;
      setSelectedId(card.id);
      showSticky(card);
    },
    [showSticky],
  );
  const specs = useMemo(
    () => buildPlaygroundSpecs(table, theme, compact, inspect),
    [table, theme, compact, inspect],
  );
  const sheetSpec = specs.playerBars.find((spec) => spec.playerId === sheetPlayerId);
  const hand = useMemo(
    () => table.cards.filter((card) => card.zoneId === "hand" && card.ownerId === LOCAL_PLAYER_ID),
    [table.cards],
  );
  const target =
    table.cards.find((card) => card.id === selectedId) ??
    table.cards.filter((card) => card.zoneId === "battlefield").at(-1);
  const loadScenario = (scenario: PlaygroundScenarioId) => {
    const next = createPlaygroundTable(scenario);
    setTable(next);
    setSelectedId(null);
    setSheetPlayerId(null);
    setFocusedPlayerId(next.players[1]!.id);
    setOverview(scenario === "combat" || scenario === "player-panels");
    setSelfStops(new Set(["main1", "combatDeclareAttackers"]));
    setOpponentStops(new Map());
    nextId.current = 0;
    preview.dismiss();
  };
  const update = (fn: (card: ClientCardDto) => ClientCardDto) => {
    if (target)
      setTable((current) => ({
        ...current,
        cards: current.cards.map((card) => (card.id === target.id ? fn(card) : card)),
      }));
  };
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
    if (!card || isFacelessCard(card)) {
      preview.dismiss();
      return;
    }
    preview.handleMouseEnter(card, undefined, {
      ...options,
      useAnchor: true,
      anchorOverride: bounds
        ? new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height)
        : undefined,
    });
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
    <div className="space-y-3">
      <BoardPlaygroundControls
        table={table}
        setTable={setTable}
        loadScenario={loadScenario}
        overview={overview}
        setOverview={setOverview}
        focusedPlayerId={focusedPlayerId}
        setFocusedPlayerId={setFocusedPlayerId}
      />
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
        <Button size="sm" variant="outline" onClick={() => move("graveyard")} disabled={!target}>
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
          Re-stomp all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
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
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {target
          ? `Selected: ${target.identity.name} · ${table.players.find((player) => player.id === target.controllerId)?.name} · ${target.zoneId}. `
          : "Select a card to use the controls. "}
        Click selects; hover or long-press inspects. Phase-strip stops are interactive. No game
        actions reach a backend.
      </p>
      <div className="relative h-[85dvh] min-h-80 overflow-hidden rounded-lg border border-border bg-background">
        <BoardCanvas
          regions={specs.regions}
          hand={{ cards: hand }}
          zones={specs.zones}
          arrowSpecs={[]}
          focusLocked={!!sheetPlayerId || preview.isSticky}
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
          playerBars={specs.playerBars}
          showPlayerBars
          zoneTiles={specs.zoneTiles}
          callbacks={{
            onClickCard: (card) => setSelectedId(card.id),
            onClickAnyCard: (card) => setSelectedId(card.id),
            onClickCard_Hand: (card) => setSelectedId(card.id),
            onHoverCard: hover,
            onHoverHandCard: hover,
            onLongPressCard: (card) => inspect(card),
            onFocusOpponentField: setFocusedPlayerId,
            onShowPlayerSheet: (playerId) => {
              preview.dismiss();
              setSheetPlayerId(playerId);
            },
            onFlipCard: preview.flipCard,
            onDismissHoverPreview: preview.dismiss,
          }}
        />
      </div>
      <HoverCardPreview preview={preview} />
      {sheetSpec && <PlayerSheetModal spec={sheetSpec} onClose={() => setSheetPlayerId(null)} />}
    </div>
  );
}
