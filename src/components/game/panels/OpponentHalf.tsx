import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PlayerPanel } from "./PlayerPanel";
import { withAlpha } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { OPPONENT_SEATS, type OpponentHalfProps } from "../game.types";
import { PixiGameCanvas } from "@/pixi/PixiGameCanvas";
import type { BattlefieldState, GameCanvasCallbacks } from "@/pixi/types";

const OPPONENT_SCENE_OPTIONS = {
  mirrored: true,
  showHand: false,
  allowDrag: false,
} as const;

const OPPONENT_PANEL_SCALE = 0.72;
const OPPONENT_MIN_ROWS = 3;
const PANEL_EDGE_OFFSET_PX = 8;
const PANEL_GAP_PX = 8;
const PANEL_BOX_FALLBACK = { width: 260, height: 120 } as const;

export function OpponentHalf({
  player,
  opponentIndex,
  permanents,
  graveyard,
  exile,
  commandZone,
  isTargetable,
  isSelectedTarget,
  onTarget,
  isFlashing,
  activePlayerId,
  priorityPlayerId,
  step: _step,
  promptType,
  pendingAttacker,
  attackerIds,
  selectableCardIds,
  onClickCard,
  onClickAnyCard,
  onHoverCard,
  onFlipCard,
  onOpenZone,
  zonePanelOrder,
  hostileTargeting,
  manaAbilityOptions,
  pixiSceneRef,
  isMonarch,
  hasInitiative,
}: OpponentHalfProps) {
  const themeColors = useTheme().gameTheme;

  const panelRef = useRef<HTMLDivElement>(null);
  const [panelBox, setPanelBox] = useState<{ width: number; height: number }>(PANEL_BOX_FALLBACK);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect) return;
      setPanelBox({
        width: PANEL_EDGE_OFFSET_PX + rect.width * OPPONENT_PANEL_SCALE + PANEL_GAP_PX,
        height: PANEL_EDGE_OFFSET_PX + rect.height * OPPONENT_PANEL_SCALE + PANEL_GAP_PX,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const canTarget = promptType === "chooseTargetCard" || promptType === "chooseTargetAny";
  const canPickAttackDefender = promptType === "chooseAttackers";
  const canPickForBlockers = promptType === "chooseBlockers";

  const pixiBattlefield = useMemo<BattlefieldState>(
    () => ({
      cards: permanents,
      attackingCardIds: canPickForBlockers ? (attackerIds ?? []) : undefined,
      pendingCardIds: canPickForBlockers && pendingAttacker ? [pendingAttacker] : undefined,
      selectableCardIds,
      hostileTargeting,
      manaAbilityOptions,
    }),
    [
      permanents,
      canPickForBlockers,
      attackerIds,
      pendingAttacker,
      selectableCardIds,
      hostileTargeting,
      manaAbilityOptions,
    ],
  );

  const pixiCallbacks: GameCanvasCallbacks = useMemo(
    () => ({
      onClickCard: (c) => {
        if (canTarget || (canPickAttackDefender && selectableCardIds?.includes(c.id))) {
          onClickCard(c);
        } else if (canPickForBlockers && attackerIds?.includes(c.id)) {
          onClickAnyCard(c);
        }
      },
      onClickAnyCard: (c) => {
        if (canPickForBlockers && attackerIds?.includes(c.id)) onClickAnyCard(c);
      },
      onHoverCard: (c, bounds, opts) => {
        if (c && bounds) {
          const rect = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
          onHoverCard(c, undefined, {
            anchorOverride: rect,
            useAnchor: opts?.useAnchor,
            placement: opts?.placement,
          });
        } else {
          onHoverCard(null);
        }
      },
      onFlipCard,
    }),
    [
      canTarget,
      canPickAttackDefender,
      canPickForBlockers,
      selectableCardIds,
      attackerIds,
      onClickCard,
      onClickAnyCard,
      onHoverCard,
      onFlipCard,
    ],
  );

  return (
    <div
      className={cn("flex flex-col h-full min-h-0 rounded-lg border border-transparent")}
      style={
        priorityPlayerId === player.id
          ? {
              borderColor: themeColors.activeAction.active,
              boxShadow: `inset 0 0 0 1px ${withAlpha(themeColors.activeAction.active, 0.85)}`,
            }
          : undefined
      }
    >
      <div className="flex gap-2 flex-1 min-h-0">
        <div className="relative flex flex-col gap-1 flex-1 min-w-0 min-h-0">
          <div
            ref={panelRef}
            className="absolute top-2 left-2 z-30 max-w-[calc(100%-16px)] origin-top-left"
            style={{ transform: `scale(${OPPONENT_PANEL_SCALE})` }}
          >
            <PlayerPanel
              player={player}
              isOpponent
              seat={OPPONENT_SEATS[opponentIndex] ?? "opponent1"}
              verticalAlign="top"
              isActiveTurn={activePlayerId === player.id}
              isPriorityPlayer={priorityPlayerId === player.id}
              isTargetable={isTargetable}
              isSelectedTarget={isSelectedTarget}
              onTarget={onTarget}
              isFlashing={isFlashing}
              isMonarch={isMonarch}
              hasInitiative={hasInitiative}
              commanders={commandZone}
              graveyard={graveyard}
              exile={exile}
              onOpenCommandZone={
                (commandZone?.length ?? 0) > 0
                  ? () => onOpenZone(`${player.name}'s Command Zone`, commandZone!)
                  : undefined
              }
              onOpenGraveyard={() => onOpenZone(`${player.name}'s Graveyard`, graveyard)}
              onOpenExile={() => onOpenZone(`${player.name}'s Exile`, exile)}
              onHoverCard={(card, e) => onHoverCard(card, e, { useAnchor: true })}
              zonePanelOrder={zonePanelOrder}
            />
          </div>
          <div className="absolute inset-0 z-10 rounded-lg overflow-hidden">
            <PixiGameCanvas
              battlefield={pixiBattlefield}
              sceneRef={pixiSceneRef}
              callbacks={pixiCallbacks}
              topLeftReserved={panelBox}
              minRows={OPPONENT_MIN_ROWS}
              bottomReserved={0}
              externalBlockers={[]}
              sceneOptions={OPPONENT_SCENE_OPTIONS}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
