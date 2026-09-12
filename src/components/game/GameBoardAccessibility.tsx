import { useState } from "react";

import type { CardDto } from "@/protocol/game";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { PHASES, ZONE_BADGES, ZONE_TILE_KEY } from "@/components/game/game.constants";
import type { ZoneTileSpec } from "@/pixi/board/BoardZoneTiles";
import type { StackSpec } from "@/pixi/stack/stack.types";
import { DEFAULT_OPPONENT_STOPS } from "@/stores/usePhaseStopStore";
import type { ManaAbilityActionInfo } from "@/components/game/manaUtils";
import { getDisplayedManaAbilities } from "@/components/game/manaUtils";

interface AccessiblePlayer {
  id: string;
  name: string;
  life: number;
  isSelf: boolean;
  isTargetable: boolean;
}

interface GameBoardAccessibilityProps {
  players: AccessiblePlayer[];
  battlefield: CardDto[];
  hand: CardDto[];
  selectableBattlefieldCardIds?: string[];
  playableIds: Set<string>;
  handSelectionMode: boolean;
  handSelectedIds?: ReadonlySet<string>;
  tappableCardIds?: readonly string[];
  untappableCardIds?: readonly string[];
  manaAbilityOptions?: ManaAbilityActionInfo[];
  zonesByPlayer: Record<string, ZoneTileSpec[]>;
  stack: StackSpec;
  currentStep: string;
  selfStops: Set<string>;
  opponentStops: Map<string, Set<string>>;
  getHandActions?: (card: CardDto) => HandActionOption[];
  onSelectHandAction?: (action: HandActionOption) => void;
  onToggleHandCard?: (cardId: string) => void;
  onTapLand?: (card: CardDto) => void;
  onUntapLand?: (card: CardDto) => void;
  onTapLandAbility?: (actionId: string) => void;
  onActivateBattlefieldCard: (card: CardDto) => void;
  onInspectCard: (card: CardDto, anchor: DOMRect) => void;
  onFocusCard: (card: CardDto, anchor: DOMRect) => void;
  onBlurCard: () => void;
  onInspectPlayer: (playerId: string) => void;
  onTargetPlayer: (playerId: string) => void;
  onOpenStack: () => void;
  onTargetSpell: (spellId: string) => void;
  onToggleStack: () => void;
  onToggleSelfPhase: (phaseId: string) => void;
  onToggleOpponentPhase: (playerId: string, phaseId: string) => void;
}
const UNCONFIGURABLE_PHASE_ID = "untap";

const cardLabel = (card: CardDto, owner: string): string => {
  const name = card.isFaceDown ? "Face-down card" : card.identity.name;
  const parts = [name, owner];
  if (card.tapped) parts.push("tapped");
  if (card.types.length > 0) parts.push(card.types.join(" "));
  if (card.power != null && card.toughness != null) parts.push(`${card.power}/${card.toughness}`);
  if (card.damage > 0) parts.push(`${card.damage} damage marked`);
  if (card.counters && Object.keys(card.counters).length > 0) {
    parts.push(
      Object.entries(card.counters)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind} counter${count === 1 ? "" : "s"}`)
        .join(", "),
    );
  }
  return parts.filter(Boolean).join(", ");
};

export function GameBoardAccessibility({
  players,
  battlefield,
  hand,
  selectableBattlefieldCardIds,
  playableIds,
  handSelectionMode,
  handSelectedIds,
  tappableCardIds,
  untappableCardIds,
  manaAbilityOptions,
  zonesByPlayer,
  stack,
  currentStep,
  selfStops,
  opponentStops,
  getHandActions,
  onSelectHandAction,
  onToggleHandCard,
  onTapLand,
  onUntapLand,
  onTapLandAbility,
  onActivateBattlefieldCard,
  onInspectCard,
  onFocusCard,
  onBlurCard,
  onInspectPlayer,
  onTargetPlayer,
  onOpenStack,
  onTargetSpell,
  onToggleStack,
  onToggleSelfPhase,
  onToggleOpponentPhase,
}: GameBoardAccessibilityProps) {
  const playerNames = new Map(
    players.map((player) => [player.id, player.isSelf ? "you" : player.name]),
  );
  const selectable = new Set(selectableBattlefieldCardIds ?? []);
  const tappable = new Set(tappableCardIds ?? []);
  const untappable = new Set(untappableCardIds ?? []);
  const [focused, setFocused] = useState(false);
  const controlClass =
    "w-full rounded border border-border bg-background px-3 py-2 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <nav
      aria-label="Game board controls"
      className={
        focused
          ? "absolute top-2 left-2 z-[70] flex max-h-[calc(100%-1rem)] w-[min(28rem,calc(100%-1rem))] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-xl"
          : "sr-only"
      }
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <h2 className="text-base font-semibold text-foreground">Game board controls</h2>

      <section aria-labelledby="accessible-players-heading" className="space-y-1.5">
        <h3 id="accessible-players-heading" className="text-sm font-semibold text-muted-foreground">
          Players
        </h3>
        {players.map((player) => (
          <div key={player.id} className="flex gap-2">
            <button
              type="button"
              className={controlClass}
              onClick={() =>
                player.isTargetable ? onTargetPlayer(player.id) : onInspectPlayer(player.id)
              }
            >
              {player.isTargetable ? "Target" : "Inspect"} {player.isSelf ? "you" : player.name},{" "}
              {player.life} life
            </button>
            {player.isTargetable && (
              <button
                type="button"
                className={controlClass}
                onClick={() => onInspectPlayer(player.id)}
              >
                Inspect {player.isSelf ? "you" : player.name}
              </button>
            )}
          </div>
        ))}
      </section>

      <details className="space-y-1.5">
        <summary className={controlClass}>
          Your hand, {hand.length} card{hand.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-1.5 space-y-1.5">
          {hand.map((card) => {
            const actions = handSelectionMode ? [] : (getHandActions?.(card) ?? []);
            const selected = handSelectedIds?.has(card.id) ?? false;
            return (
              <div key={card.id} className="space-y-1">
                <button
                  type="button"
                  className={controlClass}
                  aria-pressed={handSelectionMode ? selected : undefined}
                  aria-label={`${cardLabel(card, "in your hand")}${playableIds.has(card.id) ? ", playable" : ""}${selected ? ", selected" : ""}`}
                  onFocus={(event) =>
                    onFocusCard(card, event.currentTarget.getBoundingClientRect())
                  }
                  onBlur={onBlurCard}
                  onClick={(event) => {
                    if (handSelectionMode) onToggleHandCard?.(card.id);
                    else onInspectCard(card, event.currentTarget.getBoundingClientRect());
                  }}
                >
                  {handSelectionMode ? (selected ? "Deselect" : "Select") : "Inspect"}{" "}
                  {card.isFaceDown ? "face-down card" : card.identity.name}
                </button>
                {actions.map((action, index) => (
                  <button
                    key={`${card.id}:${action.kind}:${index}`}
                    type="button"
                    className={controlClass}
                    onClick={() => onSelectHandAction?.(action)}
                  >
                    {action.label} {card.identity.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </details>

      <details className="space-y-1.5">
        <summary className={controlClass}>
          Battlefield, {battlefield.length} permanent{battlefield.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-1.5 space-y-1.5">
          {battlefield.map((card) => {
            const actionable = selectable.has(card.id);
            const manaActions = getDisplayedManaAbilities(card.id, manaAbilityOptions ?? []);
            const canTap = tappable.has(card.id);
            const canUntap = untappable.has(card.id);
            const name = card.isFaceDown ? "face-down card" : card.identity.name;
            return (
              <div key={card.id} className="space-y-1">
                <button
                  type="button"
                  className={controlClass}
                  aria-label={`${cardLabel(card, `controlled by ${playerNames.get(card.controllerId) ?? "a player"}`)}${actionable ? ", available action" : ""}`}
                  onFocus={(event) =>
                    onFocusCard(card, event.currentTarget.getBoundingClientRect())
                  }
                  onBlur={onBlurCard}
                  onClick={(event) => {
                    if (actionable) onActivateBattlefieldCard(card);
                    else onInspectCard(card, event.currentTarget.getBoundingClientRect());
                  }}
                >
                  {actionable ? "Activate" : "Inspect"} {name}
                </button>
                {manaActions.map((action, index) => (
                  <button
                    key={`${card.id}:mana:${action.actionId ?? index}`}
                    type="button"
                    className={controlClass}
                    onClick={() => {
                      if (action.actionId) onTapLandAbility?.(action.actionId);
                      else onTapLand?.(card);
                    }}
                  >
                    {action.description || "Add mana"} with {name}
                  </button>
                ))}
                {canTap && manaActions.length === 0 && (
                  <button type="button" className={controlClass} onClick={() => onTapLand?.(card)}>
                    Tap {name}
                  </button>
                )}
                {canUntap && (
                  <button
                    type="button"
                    className={controlClass}
                    onClick={() => onUntapLand?.(card)}
                  >
                    Untap {name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </details>

      <section aria-labelledby="accessible-stack-heading" className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="accessible-stack-heading" className="text-sm font-semibold text-muted-foreground">
            Stack, {stack.cards.length} object{stack.cards.length === 1 ? "" : "s"}
          </h3>
          <button type="button" className={controlClass} onClick={onToggleStack}>
            {stack.collapsed ? "Expand" : "Collapse"} stack
          </button>
        </div>
        {stack.cards.map((item, index) => {
          const name = item.card.isFaceDown ? "face-down card" : item.card.identity.name;
          const position = item.isTopOfStack
            ? "top of stack"
            : `stack position ${stack.cards.length - index}`;
          return (
            <button
              key={item.id}
              type="button"
              className={controlClass}
              aria-label={`${name}, ${position}${item.isValidTarget ? ", valid target" : ""}`}
              onClick={() => (item.isValidTarget ? onTargetSpell(item.id) : onOpenStack())}
            >
              {item.isValidTarget ? "Target" : "Inspect"} {name}
            </button>
          );
        })}
      </section>

      <section aria-labelledby="accessible-zones-heading" className="space-y-1.5">
        <h3 id="accessible-zones-heading" className="text-sm font-semibold text-muted-foreground">
          Zones
        </h3>
        {players.flatMap((player) =>
          (zonesByPlayer[player.id] ?? []).map((zone) => {
            const zoneName =
              zone.key === ZONE_TILE_KEY.command ? "Command zone" : ZONE_BADGES[zone.key]?.label;
            return zone.onOpen ? (
              <button
                key={`${player.id}:${zone.key}`}
                type="button"
                className={controlClass}
                onClick={zone.onOpen}
              >
                Open {player.isSelf ? "your" : `${player.name}'s`} {zoneName}, {zone.count} card
                {zone.count === 1 ? "" : "s"}
              </button>
            ) : (
              <p key={`${player.id}:${zone.key}`} className="text-sm text-muted-foreground">
                {player.isSelf ? "Your" : `${player.name}'s`} {zoneName}, {zone.count} card
                {zone.count === 1 ? "" : "s"}
              </p>
            );
          }),
        )}
      </section>

      <details className="space-y-1.5">
        <summary className={controlClass}>
          Turn stops, current step{" "}
          {PHASES.find((phase) => phase.id === currentStep)?.label ?? currentStep}
        </summary>
        <div className="mt-1.5 space-y-1.5">
          {PHASES.filter((phase) => phase.id !== UNCONFIGURABLE_PHASE_ID).map((phase) => (
            <button
              key={`self:${phase.id}`}
              type="button"
              className={controlClass}
              aria-pressed={selfStops.has(phase.id)}
              onClick={() => onToggleSelfPhase(phase.id)}
            >
              {selfStops.has(phase.id) ? "Disable" : "Enable"} your {phase.label} stop
            </button>
          ))}
          {players
            .filter((player) => !player.isSelf)
            .flatMap((player) =>
              PHASES.filter((phase) => phase.id !== UNCONFIGURABLE_PHASE_ID).map((phase) => {
                const enabled = (opponentStops.get(player.id) ?? DEFAULT_OPPONENT_STOPS).has(
                  phase.id,
                );
                return (
                  <button
                    key={`${player.id}:${phase.id}`}
                    type="button"
                    className={controlClass}
                    aria-pressed={enabled}
                    onClick={() => onToggleOpponentPhase(player.id, phase.id)}
                  >
                    {enabled ? "Disable" : "Enable"} {player.name} {phase.label} stop
                  </button>
                );
              }),
            )}
        </div>
      </details>
    </nav>
  );
}
