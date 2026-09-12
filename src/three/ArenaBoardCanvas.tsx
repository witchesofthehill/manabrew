import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, CSSProperties } from "react";
import type { BoardCanvas } from "@/pixi/BoardCanvas";
import { useTheme } from "@/hooks/useTheme";
import { ArenaScene } from "@/three/ArenaScene";
import { ArenaCardImage } from "@/three/ArenaCardImage";
import type { ArenaCard } from "@/three/arena.types";
import { PHASES } from "@/components/game/game.constants";
import "@/three/arena.css";

export function ArenaBoardCanvas(props: ComponentProps<typeof BoardCanvas>) {
  const { regions, hand, callbacks, playerBars = [], zoneTiles, phaseStrip } = props;
  const { gameTheme: theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  const [images, setImages] = useState<Record<string, { face: string; art?: string }>>({});
  const [actionCardId, setActionCardId] = useState<string | null>(null);
  const imageLoaded = useCallback(
    (id: string, image: string, art?: string) =>
      setImages((old) =>
        old[id]?.face === image && old[id]?.art === art
          ? old
          : { ...old, [id]: { face: image, art } },
      ),
    [],
  );
  const allCards = [...regions.flatMap((r) => r.state.cards), ...hand.cards];
  const opponentIds = playerBars
    .filter((player) => !player.isSelf)
    .map((player) => player.playerId);
  const layoutPlayer = (id: string) =>
    opponentIds.length > 1 && opponentIds.includes(id)
      ? `player-${1 + (opponentIds.indexOf(id) * 2) / Math.max(1, opponentIds.length - 1)}`
      : undefined;
  const piles = Object.entries(zoneTiles ?? {}).flatMap(([owner, specs]) =>
    specs
      .filter((spec) => spec.key === "lib" || spec.key === "gy")
      .map((spec) => ({ owner, spec, id: `${owner}:${spec.key}` })),
  );
  const byId = new Map(allCards.map((card) => [card.id, card]));
  const colors = useMemo(
    () => ({
      background: theme.canvas.background,
      surface: theme.cardPlaceholder.fill,
      border: theme.cardPlaceholder.stroke,
      foreground: theme.textOnTinted,
      muted: theme.textMuted,
      accent: theme.activeAction.active,
      hostile: theme.arrow.attack,
      playable: theme.cardPlayable,
    }),
    [theme],
  );
  const cards: ArenaCard[] = allCards.map((card) => {
    const region = regions.find((r) => r.state.cards.some((c) => c.id === card.id));
    const frame =
      card.color.length > 1 ? "M" : ((card.color[0] || "C") as NonNullable<ArenaCard["frame"]>);
    return {
      id: card.id,
      playerId: region && !region.isLocal ? layoutPlayer(region.playerId) : undefined,
      attachedTo: card.attachedTo,
      keywords: card.isFaceDown ? [] : card.keywords,
      counters: card.counters,
      damage: card.damage,
      summoningSick: card.summoningSick,
      attackingPlayerId: card.attackingPlayerId,
      attackTargetId: card.attackTargetId,
      name: card.isFaceDown ? "Face-down card" : card.identity.name,
      type: card.isFaceDown ? "" : card.types.join(" "),
      cost: card.isFaceDown ? "" : card.manaCost,
      effectiveCost: card.isFaceDown ? undefined : card.effectiveManaCost,
      text: card.isFaceDown ? "" : card.text,
      stats: card.power != null ? `${card.power}/${card.toughness}` : undefined,
      statsChanged:
        card.basePower != null &&
        card.baseToughness != null &&
        (String(card.basePower) !== card.power || String(card.baseToughness) !== card.toughness),
      image: images[card.id]?.face,
      artImage: images[card.id]?.art,
      hidden: card.isFaceDown,
      frame,
      color: theme.mana[frame === "M" ? "W" : frame],
      side: !region ? "hand" : region.isLocal ? "self" : "opponent",
      tapped: card.tapped,
      attacking: card.isAttacking || region?.state.attackingCardIds?.includes(card.id),
      selected: hand.selectedIds?.has(card.id) || region?.state.pendingCardIds?.includes(card.id),
      playable: region
        ? region.state.selectableCardIds?.includes(card.id) ||
          region.state.tappableLandIds?.includes(card.id)
        : hand.playableIds?.has(card.id),
    };
  });
  for (const player of playerBars.filter((p) => !p.isSelf)) {
    const count = player.badges.find((b) => b.id === "hand")?.count ?? 0;
    for (let i = 0; i < count; i++) {
      cards.push({
        id: `opponent-hand-${player.playerId}-${i}`,
        playerId: layoutPlayer(player.playerId),
        name: "Opponent's card",
        type: "",
        cost: "",
        text: "",
        side: "opponentHand",
        hidden: true,
        color: colors.border,
      });
    }
  }
  useEffect(() => {
    const element = host.current!;
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      const self = latest.current.regions.find((r) => r.isLocal);
      latest.current.onLayout?.({
        self: self ? { x: 0, y: height / 2, width, height: height / 2 } : null,
        dividerY: height / 2,
        selfClusterMaxHeight: height * 0.25,
        opponents: latest.current.regions
          .filter((r) => !r.isLocal)
          .map((r) => ({
            playerId: r.playerId,
            rect: { x: 0, y: 0, width, height: height / 2 },
            orientation: "top" as const,
          })),
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const click = (id: string) => {
    const card = byId.get(id);
    if (!card) return;
    if (hand.cards.some((c) => c.id === id)) {
      if (hand.selectionMode) callbacks.onClickCard_Hand?.(card);
      else setActionCardId(id);
    } else callbacks.onClickCard?.(card);
  };
  const actionCard = actionCardId ? byId.get(actionCardId) : undefined;
  const actions = actionCard ? (props.getHandActions?.(actionCard) ?? []) : [];
  const style = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [`--arena-${key}`, value]),
  ) as CSSProperties;
  return (
    <div ref={host} className="arena-root" style={style}>
      {allCards.map((card) => (
        <ArenaCardImage key={card.id} card={card} onImage={imageLoaded} />
      ))}
      {piles
        .filter((p) => p.spec.key === "gy" && p.spec.topCard)
        .map((p) => (
          <ArenaCardImage key={p.id} card={p.spec.topCard!} onImage={imageLoaded} />
        ))}
      <ArenaScene
        colors={colors}
        cards={cards}
        combatStep={phaseStrip.currentStep}
        zones={piles.map((p) => ({
          id: p.id,
          zone: p.spec.key === "lib" ? "library" : "graveyard",
          side: regions.find((r) => r.playerId === p.owner)?.isLocal ? "self" : "opponent",
          count: p.spec.count,
          seat: layoutPlayer(p.owner) ? Number(layoutPlayer(p.owner)!.slice(7)) - 1 : undefined,
          topImage:
            p.spec.key === "gy" && p.spec.topCard ? images[p.spec.topCard.id]?.face : undefined,
        }))}
        onZone={(id) => piles.find((p) => p.id === id)?.spec.onOpen?.()}
        links={props.arrowSpecs.flatMap((a) =>
          a.from.kind === "card" && a.to.kind === "card"
            ? [
                {
                  from: a.from.id,
                  to: a.to.id,
                  color: a.type === "block" ? theme.arrow.block : theme.arrow.attack,
                },
              ]
            : [],
        )}
        onCard={click}
        onHover={(id, rect) =>
          callbacks.onHoverCard?.(
            id ? (byId.get(id) ?? null) : null,
            rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
          )
        }
        onDrop={(id, target) => {
          if (props.declareBlockers && target) callbacks.onAssignBlock?.(id, target);
          else if (props.declareAttackers) {
            const targets =
              props.attackerOptions?.find((a) => a.attackerId === id)?.validTargetIds ?? [];
            if (target && targets.includes(target)) callbacks.onAssignAttacker?.(id, target);
            else if (targets.length === 1) callbacks.onAssignAttacker?.(id, targets[0]);
          } else click(id);
        }}
      />
      {playerBars.map((player) => (
        <div
          key={player.playerId}
          style={
            !player.isSelf && opponentIds.length > 1
              ? {
                  left: `${15 + (opponentIds.indexOf(player.playerId) * 65) / Math.max(1, opponentIds.length - 1)}%`,
                  top: 65,
                  transform: "translateX(-50%)",
                  fontSize: 11,
                }
              : undefined
          }
          className={
            player.isSelf ? "arena-player arena-player-self" : "arena-player arena-player-opponent"
          }
        >
          <button
            className="arena-avatar"
            onClick={() =>
              player.isTargetable
                ? callbacks.onTargetPlayer?.(player.playerId)
                : callbacks.onShowPlayerSheet?.(player.playerId)
            }
            style={{ borderColor: player.isPriorityPlayer ? colors.accent : player.color }}
          >
            <span>{player.name.slice(0, 1).toUpperCase()}</span>
            <strong>{player.life}</strong>
          </button>
          <div>
            <small>{player.isActiveTurn ? "ACTIVE PLAYER" : "PLANESWALKER"}</small>
            <h3>{player.name}</h3>
            <div className="arena-zones">
              {(zoneTiles?.[player.playerId] ?? []).map((zone) => (
                <button key={zone.key} onClick={zone.onOpen} disabled={!zone.onOpen}>
                  {zone.label} {zone.count}
                </button>
              ))}
            </div>
            <small>
              {Object.entries(player.manaPool)
                .filter(([, n]) => n > 0)
                .map(([color, n]) => `${color}: ${n}`)
                .join(" · ")}
            </small>
          </div>
        </div>
      ))}
      <div className="arena-phase-strip">
        {PHASES.filter((p) => !p.combat || p.id === phaseStrip.currentStep).map((phase) => (
          <button
            key={phase.id}
            data-active={phase.id === phaseStrip.currentStep}
            title={`Toggle stop: ${phase.label}`}
            onClick={() => props.phaseStripCallbacks?.onToggleSelfPhase?.(phase.id)}
          >
            {phase.short}
            {phaseStrip.selfEnabledPhases.has(phase.id) ? " •" : ""}
          </button>
        ))}
      </div>
      <button className="arena-menu" onClick={callbacks.onShowBoardMenu}>
        Game menu
      </button>
      {actionCard && (
        <div className="arena-actions">
          <strong>{actionCard.identity.name}</strong>
          {actions.length === 0 && <p>No legal actions right now.</p>}
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => {
                props.onSelectHandAction?.(actionCard, action);
                setActionCardId(null);
              }}
            >
              {action.label}
            </button>
          ))}
          <button onClick={() => setActionCardId(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
