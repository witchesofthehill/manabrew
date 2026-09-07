import { arenaCardImageUrl } from "@/three/arenaImageCache";
import { CardActionPicker } from "@/three/CardActionPicker";
import { arenaSurface } from "@/themes/arenaSurface";
import { GameIcon } from "@/three/GameIcon";
import { constrainSelection } from "@/three/duelSelection";
import { LifeBadge } from "@/three/LifeBadge";
import { SpellStack } from "@/three/SpellStack";
import { ZoneCards } from "@/three/ZoneCards";
import { DuelModal } from "@/three/DuelModal";
import { ManaSymbol } from "@/three/ManaSymbols";
import { DuelFlowBar } from "@/three/DuelFlowBar";
import { nextStepLabel } from "@/three/duelFlow";
import { CardPreview } from "@/three/CardPreview";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DuelMatch } from "@/three/duelMatch";
import type { CardDto } from "@manabrew/protocol";
import { ArenaScene } from "@/three/ArenaScene";
import { DuelPrompt } from "@/three/DuelPrompt";
import { useForgeDuel } from "@/three/useForgeDuel";
import type { DuelSession } from "@/three/useForgeDuel";
import { duelDecks } from "@/three/duelDecks";
import type { ArenaCard, ArenaColors, ArenaZonePile } from "@/three/arena.types";
import preset from "@/themes/kanagawa";
import "@/three/arena.css";
import "@/three/duel.css";

const colors: ArenaColors = arenaSurface;
const style = Object.fromEntries(
  Object.entries(colors).map(([key, value]) => [`--arena-${key}`, value]),
) as CSSProperties;
const imageUrl = (card: CardDto, variant: string) =>
  card.isFaceDown ? undefined : arenaCardImageUrl(card.identity.name, variant);

export function ForgeDuel({
  renderSetup,
  onExit,
  session,
}: {
  renderSetup?: (start: (match: DuelMatch) => void, loading: boolean) => ReactNode;
  onExit?: () => void;
  session?: DuelSession;
} = {}) {
  const game = useForgeDuel(session);
  const [localPlayerCount, setPlayerCount] = useState(2);
  const playerCount = session?.view?.players.length ?? localPlayerCount;
  const { view, prompt } = game;
  const [priorityDisplay, setPriorityDisplay] = useState<{
    prompt: NonNullable<typeof prompt>;
    label: string;
  } | null>(null);
  if (prompt?.input.type === "chooseAction" && view) {
    const label = game.autoPassing
      ? (priorityDisplay?.label ?? "Continue")
      : nextStepLabel(view.step, view.stack.length, game.fullControl);
    if (priorityDisplay?.prompt !== prompt || priorityDisplay.label !== label) {
      setPriorityDisplay({ prompt, label });
    }
  } else if (priorityDisplay && ((prompt && prompt.input.type !== "chooseAction") || !view)) {
    setPriorityDisplay(null);
  }
  const displayedPrompt = prompt ?? priorityDisplay?.prompt;
  const priorityBusy = game.autoPassing || !prompt;
  const activeName = view?.players.find((p) => p.id === view.activePlayerId)?.name ?? "Opponent";
  const [abilityChoice, setAbilityChoice] = useState<{
    cardId: string;
    prompt: NonNullable<typeof prompt>;
  } | null>(null);
  const activeAbilityChoice = abilityChoice?.prompt === prompt ? abilityChoice : null;
  const [selection, setSelection] = useState<{
    promptId?: string;
    ids: string[];
    blocks: Record<string, string>;
  }>({ ids: [], blocks: {} });
  const [drag, setDrag] = useState<{ id: string; canPlay: boolean } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [stackOpen, setStackOpen] = useState(false);
  const [castFlights, setCastFlights] = useState(0);
  const [zone, setZone] = useState<string | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);
  const { setPaused } = game;
  useEffect(() => {
    setPaused(
      Boolean(zone || confirmConcede || drag || activeAbilityChoice || stackOpen || castFlights),
    );
  }, [zone, confirmConcede, drag, activeAbilityChoice, stackOpen, castFlights, setPaused]);
  const selected = selection.promptId === prompt?.promptId ? selection.ids : [];
  const blocks = selection.promptId === prompt?.promptId ? selection.blocks : {};
  const onSelected = (ids: string[]) =>
    setSelection((old) => ({
      promptId: prompt?.promptId,
      ids: constrainSelection(prompt?.input, ids),
      blocks: old.promptId === prompt?.promptId ? old.blocks : {},
    }));
  const onBlocks = (next: Record<string, string>) =>
    setSelection((old) => ({
      promptId: prompt?.promptId,
      ids: old.promptId === prompt?.promptId ? old.ids : [],
      blocks: next,
    }));
  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || zone || stackOpen || confirmConcede)
        return;
      setAbilityChoice(null);
      setSelection({ promptId: prompt?.promptId, ids: [], blocks: {} });
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [prompt?.promptId, zone, stackOpen, confirmConcede]);
  const allCards =
    view?.zones.flatMap((z) =>
      z.cards.filter((c): c is CardDto & { visibility: "visible" } => c.visibility === "visible"),
    ) ?? [];
  const cards: ArenaCard[] = (view?.zones ?? []).flatMap((z) => {
    if (z.zone !== "battlefield" && !(z.zone === "hand" && z.ownerId === "player-0")) return [];
    return z.cards
      .filter((c): c is CardDto & { visibility: "visible" } => c.visibility === "visible")
      .map((card) => {
        const legal =
          prompt?.input.type === "chooseAction"
            ? prompt.input.actions.some(
                (a) =>
                  a.cardId === card.id &&
                  (game.fullControl ||
                    a.type === "cast" ||
                    (a.type === "activateAbility" && !a.isManaAbility)),
              )
            : prompt?.input.type === "chooseBlockers"
              ? prompt.input.availableBlockerIds.includes(card.id) ||
                prompt.input.attackers.some(
                  (a) =>
                    a.attackerId === card.id &&
                    a.validBlockerIds.includes(drag?.id ?? selected[0] ?? ""),
                )
              : prompt?.input.type === "chooseAttackers"
                ? prompt.input.attackers.some((a) => a.attackerId === card.id)
                : prompt?.input.type === "chooseBoardTargets"
                  ? prompt.input.candidates.some((t) => t.id === card.id)
                  : false;
        const mana = (card.color[0] ||
          (card.subtypes.includes("Forest")
            ? "G"
            : card.subtypes.includes("Plains")
              ? "W"
              : "C")) as "W" | "U" | "B" | "R" | "G" | "C";
        return {
          id: card.id,
          attachedTo: card.attachedTo,
          actionCount:
            prompt?.input.type === "chooseAction"
              ? prompt.input.actions.filter((a) => a.cardId === card.id).length
              : 0,
          playerId: playerCount === 4 ? card.controllerId : undefined,
          name: card.isFaceDown ? "Face-down card" : card.identity.name,
          type: card.types.join(" "),
          text: card.text,
          keywords: card.isFaceDown ? [] : card.keywords,
          counters: card.counters,
          damage: card.damage,
          summoningSick: card.summoningSick,
          attackTargetId: card.attackTargetId,
          cost: card.manaCost,
          stats:
            card.power != null && card.toughness != null
              ? `${card.power}/${card.toughness}`
              : undefined,
          statsChanged:
            card.basePower != null &&
            (Number(card.power) !== card.basePower ||
              Number(card.toughness) !== card.baseToughness),
          side:
            z.zone === "hand"
              ? ("hand" as const)
              : card.controllerId === "player-0"
                ? ("self" as const)
                : ("opponent" as const),
          frame: card.color.length > 1 ? ("M" as const) : mana,
          color: preset.gameColors[`mana.${mana}`],
          image: imageUrl(card, "large"),
          artImage: imageUrl(card, "art_crop"),
          tapped: card.tapped,
          hidden: card.isFaceDown,
          attacking: card.isAttacking,
          attackingPlayerId: playerCount === 4 ? card.attackingPlayerId : undefined,
          selected:
            selected.includes(card.id) ||
            (prompt?.input.type === "chooseBlockers" && Boolean(blocks[card.id])),
          playable: legal,
        };
      });
  });
  for (const zone of view?.zones.filter((z) => z.zone === "hand" && z.ownerId !== "player-0") ??
    []) {
    for (let i = 0; i < zone.count; i++)
      cards.push({
        id: `${zone.ownerId}-hand-${i}`,
        playerId: playerCount === 4 ? zone.ownerId : undefined,
        name: "Opponent's card",
        type: "",
        cost: "",
        text: "",
        side: "opponentHand",
        hidden: true,
        color: colors.border,
      });
  }
  const choose = (id: string) => {
    if (!prompt) return;
    const input = prompt.input;
    if (input.type === "chooseAction") {
      const actions = input.actions.filter((a) => a.cardId === id);
      if (actions.length === 1)
        game.respond(prompt.promptId, {
          type: input.type,
          output: { type: "act", actionId: actions[0].id },
        });
      else if (actions.length > 1) setAbilityChoice({ cardId: id, prompt });
    } else if (input.type === "chooseBlockers") {
      if (input.availableBlockerIds.includes(id)) {
        if (selected[0] === id) {
          const next = { ...blocks };
          delete next[id];
          setSelection({ promptId: prompt.promptId, ids: [], blocks: next });
        } else onSelected([id]);
      } else if (
        selected[0] &&
        input.attackers.some((a) => a.attackerId === id && a.validBlockerIds.includes(selected[0]))
      ) {
        setSelection({
          promptId: prompt.promptId,
          ids: [],
          blocks: { ...blocks, [selected[0]]: id },
        });
      }
    } else if (
      (input.type === "chooseAttackers" && input.attackers.some((a) => a.attackerId === id)) ||
      (input.type === "chooseBoardTargets" && input.candidates.some((a) => a.id === id)) ||
      ((input.type === "mulliganPutBack" || input.type === "chooseCards") &&
        input.cards.some((c) => c.id === id))
    ) {
      onSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    }
  };
  const hintCard = cards.find((c) => c.id === (drag?.id ?? hoverId));
  const hovered = allCards.find((c) => c.id === (activeAbilityChoice?.cardId ?? hoverId));
  const hoveredSpell =
    !activeAbilityChoice && !stackOpen
      ? view?.stack.find((spell) => `stack:${spell.id}` === hoverId)
      : undefined;
  const zoneCards = zone
    ? allCards.filter((c) =>
        view?.zones.some(
          (z) => `${z.ownerId}:${z.zone}` === zone && z.cards.some((v) => v.id === c.id),
        ),
      )
    : [];
  return (
    <main className="arena-root duel-root" data-players={playerCount} style={style}>
      <ArenaScene
        colors={colors}
        cards={cards}
        targeting={
          prompt?.input.type === "chooseBoardTargets"
            ? {
                stackId: (view?.stack.find((spell) => spell.isCasting) ?? view?.stack.at(-1))?.id,
                sourceId: (view?.stack.find((spell) => spell.isCasting) ?? view?.stack.at(-1))
                  ?.sourceId,
                candidates: prompt.input.candidates.map((target) => target.id),
                maxTargets: prompt.input.maxTargets,
                selected,
              }
            : undefined
        }
        combatStep={view?.step}
        combatTurn={view?.turn}
        zones={(view?.zones ?? [])
          .filter((z) => z.zone === "library" || z.zone === "graveyard" || z.zone === "exile")
          .map((z) => {
            const top = z.zone === "graveyard" ? z.cards.at(-1) : undefined;
            return {
              id: `${z.ownerId}:${z.zone}`,
              zone: z.zone as ArenaZonePile["zone"],
              side: z.ownerId === "player-0" ? "self" : "opponent",
              count: z.count,
              seat:
                playerCount === 4 && z.ownerId !== "player-0"
                  ? Number(z.ownerId.split("-").at(-1)) - 1
                  : undefined,
              topImage: top?.visibility === "visible" ? imageUrl(top, "large") : undefined,
              topName: top?.visibility === "visible" ? top.identity.name : undefined,
            };
          })}
        onZone={setZone}
        onCard={choose}
        onHover={setHoverId}
        onDrag={setDrag}
        blockTargets={
          prompt?.input.type === "chooseBlockers"
            ? Object.fromEntries(
                cards
                  .filter((c) => c.side === "self")
                  .map((c) => [
                    c.id,
                    prompt.input.type === "chooseBlockers"
                      ? prompt.input.attackers
                          .filter((a) => a.validBlockerIds.includes(c.id))
                          .map((a) => a.attackerId)
                      : [],
                  ]),
              )
            : undefined
        }
        links={[
          ...(view?.combatAssignments ?? []).map((a) => ({
            from: a.blockerId,
            to: a.attackerId,
            color: colors.accent,
          })),
          ...Object.entries(blocks)
            .filter(([, id]) => id)
            .map(([from, to]) => ({ from, to, color: colors.accent })),
        ]}
        onDrop={(id, target) => {
          if (
            prompt?.input.type === "chooseBlockers" &&
            target &&
            prompt.input.attackers.some(
              (a) => a.attackerId === target && a.validBlockerIds.includes(id),
            )
          )
            onBlocks({ ...blocks, [id]: target });
          else if (prompt?.input.type !== "chooseBlockers") choose(id);
        }}
      />
      <div className="duel-hand-aura" aria-hidden="true" />
      {hintCard?.side === "hand" && prompt?.input.type === "chooseAction" && (
        <div
          className="duel-play-hint"
          data-valid={hintCard.playable}
          data-ready={Boolean(drag?.canPlay)}
          role="status"
        >
          <span className="duel-hint-emblem">
            <GameIcon name={drag?.canPlay ? "confirm" : hintCard.playable ? "hand" : "control"} />
          </span>
          <div>
            <strong>
              {drag
                ? drag.canPlay
                  ? `Release to ${hintCard.type.includes("Land") ? "play land" : "cast spell"}`
                  : hintCard.playable
                    ? "Drag onto the battlefield"
                    : "Not playable right now"
                : hintCard.playable
                  ? `Click or drag to ${hintCard.type.includes("Land") ? "play" : "cast"}`
                  : "Not playable right now"}
            </strong>
            <small>
              {drag
                ? "Esc or return to hand to cancel"
                : hintCard.playable
                  ? hintCard.name
                  : "Available cards have a cyan outline"}
            </small>
          </div>
        </div>
      )}
      <header className="arena-brand">
        <h1>MANABREW</h1>
        <small>LOCAL DUEL · FORGE RULES</small>
      </header>
      {!view && (
        <section className="duel-start">
          {renderSetup ? (
            renderSetup((match) => {
              setPlayerCount(match.opponents.length + 1);
              void game.start(0, match.opponents.length + 1, match);
            }, game.loading)
          ) : (
            <>
              <small>CHOOSE YOUR DECK</small>
              <h2>A real duel. Your next move.</h2>
              <p>Play a 60-card match against Forge AI.</p>
              <div className="duel-table-size" role="group" aria-label="Table size">
                <button
                  aria-pressed={playerCount === 2}
                  disabled={game.loading}
                  onClick={() => setPlayerCount(2)}
                >
                  Duel · 2 players
                </button>
                <button
                  aria-pressed={playerCount === 4}
                  disabled={game.loading}
                  onClick={() => setPlayerCount(4)}
                >
                  Free-for-all · 4 players
                </button>
              </div>
              {duelDecks.map((deck, i) => (
                <button
                  key={deck.name}
                  disabled={game.loading}
                  onClick={() => void game.start(i, playerCount)}
                >
                  {deck.colorIdentity.map((symbol) => (
                    <ManaSymbol key={symbol} symbol={symbol} />
                  ))}{" "}
                  {deck.name} · {i === 0 ? "White creatures" : "Green creatures"}
                </button>
              ))}
            </>
          )}
          {(!renderSetup || game.loading) && <p role="status">{game.status}</p>}
          {game.error && <p role="alert">{game.error}</p>}
          {onExit ? (
            <button disabled={game.loading} onClick={onExit}>
              Back to Play
            </button>
          ) : (
            <a href="/arena.html">Visual playground</a>
          )}
        </section>
      )}
      {view && (
        <>
          {view.turn > 0 && (
            <div key={`turn-${view.turn}`} className="duel-turn-notice" aria-live="polite">
              <small>Turn {view.turn}</small>
              <strong>
                {view.activePlayerId === "player-0" ? "Your turn" : `${activeName} turn`}
              </strong>
            </div>
          )}
          {view.players.map((player) => (
            <div
              key={player.id}
              data-seat={player.id}
              data-eliminated={player.status !== "playing"}
              data-active-turn={player.id === view.activePlayerId && player.status === "playing"}
              className={`arena-player arena-player-${player.id === "player-0" ? "self" : "opponent"}`}
            >
              <LifeBadge
                playerId={player.id}
                life={player.life}
                priority={player.id === view.priorityPlayerId}
                self={player.id === "player-0"}
                symbols={game.playerColors[player.id]}
                onClick={() => choose(player.id)}
              />
              <div>
                <small>
                  {player.status !== "playing"
                    ? "ELIMINATED"
                    : player.id === view.activePlayerId
                      ? "TAKING TURN"
                      : player.id === view.priorityPlayerId
                        ? "HAS PRIORITY"
                        : "WAITING"}
                </small>
                <h3 className="duel-player-name">
                  <span className="duel-turn-marker" aria-hidden="true">
                    ◆
                  </span>
                  {player.name}
                </h3>
                <small>
                  {Object.entries(player.manaPool)
                    .filter(([, n]) => n)
                    .map(([key, n]) => (
                      <span className="duel-mana-pool" key={key}>
                        <ManaSymbol symbol={key} />
                        {n}
                      </span>
                    ))}
                </small>
              </div>
            </div>
          ))}
          <button className="arena-menu" onClick={() => setConfirmConcede(true)}>
            <GameIcon name="menu" /> Match menu
          </button>
          <div className="duel-decision-dock">
            {!view.gameOver && (
              <DuelFlowBar
                step={view.step}
                turn={view.turn}
                ownTurn={view.activePlayerId === "player-0"}
                activeName={activeName}
                fullControl={game.fullControl}
                onControl={game.toggleControl}
                stops={game.stops}
                onStop={game.toggleStop}
              />
            )}
            {displayedPrompt &&
              (!game.autoPassing || displayedPrompt.input.type === "chooseAction") &&
              !game.autoPaying &&
              !view.gameOver && (
                <DuelPrompt
                  key={
                    displayedPrompt.input.type === "chooseAction"
                      ? "priority"
                      : displayedPrompt.promptId
                  }
                  prompt={displayedPrompt}
                  onAutoPay={game.payAutomatically}
                  nextLabel={
                    priorityBusy
                      ? (priorityDisplay?.label ?? "Continue")
                      : nextStepLabel(view.step, view.stack.length, game.fullControl)
                  }
                  autoPassing={priorityBusy}
                  autoPassCountdown={game.autoPassCountdown}
                  onHoldPriority={game.toggleControl}
                  cards={allCards}
                  selected={selected}
                  onSelected={onSelected}
                  blocks={blocks}
                  onBlocks={onBlocks}
                  send={(action) => {
                    if (prompt) game.respond(prompt.promptId, action);
                  }}
                />
              )}
            {(!displayedPrompt ||
              (game.autoPassing && displayedPrompt.input.type !== "chooseAction") ||
              game.autoPaying) &&
              !view.gameOver && (
                <div className="arena-actions duel-auto-status">
                  <strong>
                    {game.autoPaying
                      ? "Paying mana…"
                      : view.activePlayerId === "player-0"
                        ? "Continuing your turn"
                        : `${activeName} turn`}
                  </strong>
                  <small>
                    {game.autoPaying
                      ? "Tapping sources and completing payment"
                      : "Automatic priority · Full control to pause"}
                  </small>
                </div>
              )}
          </div>
          {game.error && (
            <div className="duel-error" role="alert">
              {game.error}
            </div>
          )}
          <SpellStack
            targeting={prompt?.input.type === "chooseBoardTargets"}
            onMotion={(active) => setCastFlights((count) => Math.max(0, count + (active ? 1 : -1)))}
            stack={view.stack}
            open={stackOpen}
            onHover={(id) => setHoverId(id ? `stack:${id}` : null)}
            onOpen={() => {
              if (prompt?.input.type === "chooseBoardTargets") return;
              setHoverId(null);
              setStackOpen(true);
            }}
            onClose={() => setStackOpen(false)}
          />
          {activeAbilityChoice &&
            prompt?.input.type === "chooseAction" &&
            !zone &&
            !stackOpen &&
            !confirmConcede && (
              <CardActionPicker
                key={`${prompt.promptId}:${activeAbilityChoice.cardId}`}
                name={
                  allCards.find((c) => c.id === activeAbilityChoice.cardId)?.identity.name ?? "Card"
                }
                actions={prompt.input.actions.filter(
                  (a) => a.cardId === activeAbilityChoice.cardId,
                )}
                onChoose={(action) => {
                  game.respond(prompt.promptId, {
                    type: "chooseAction",
                    output: { type: "act", actionId: action.id },
                  });
                  setAbilityChoice(null);
                }}
                onClose={() => setAbilityChoice(null)}
              />
            )}{" "}
          <CardPreview
            hideDetails={Boolean(activeAbilityChoice)}
            onInspect={setHoverId}
            card={
              hovered && !hovered.isFaceDown
                ? {
                    id: hovered.id,
                    name: hovered.identity.name,
                    attachedToName: allCards.find((card) => card.id === hovered.attachedTo)
                      ?.identity.name,
                    attachmentNames: allCards
                      .filter((card) => card.attachedTo === hovered.id)
                      .map((card) => card.identity.name),
                    image: imageUrl(hovered, "large"),
                    keywords: hovered.keywords,
                    counters: hovered.counters,
                    damage: hovered.damage,
                    text: hovered.text,
                    stats:
                      hovered.power != null ? `${hovered.power}/${hovered.toughness}` : undefined,
                    summoningSick:
                      hovered.summoningSick &&
                      hovered.types.includes("Creature") &&
                      view.zones.some(
                        (z) => z.zone === "battlefield" && z.cards.some((c) => c.id === hovered.id),
                      ),
                    tapped: hovered.tapped,
                  }
                : hoveredSpell
                  ? {
                      id: `stack:${hoveredSpell.id}`,
                      name: hoveredSpell.identity.name,
                      image: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(hoveredSpell.identity.name)}&format=image&version=large`,
                      text: hoveredSpell.text,
                    }
                  : undefined
            }
          />
          {zone && (
            <DuelModal title={zone.split(":")[1]} onClose={() => setZone(null)}>
              <h2>
                {zone.startsWith("player-0:") ? "Your" : "Opponent"} {zone.split(":")[1]}
              </h2>
              <button onClick={() => setZone(null)}>Close zone</button>
              {zone.endsWith(":library") && (
                <p>
                  {view.zones.find((z) => `${z.ownerId}:${z.zone}` === zone)?.count ?? 0} cards
                  remaining. Library order is hidden.
                </p>
              )}
              {zone.endsWith(":graveyard") && zoneCards.length === 0 && (
                <p>No cards in this graveyard yet.</p>
              )}
              {zone.endsWith(":exile") && zoneCards.length === 0 && (
                <p>No visible cards in exile.</p>
              )}
              <ZoneCards
                key={zone}
                cards={zoneCards}
                inspectFaceDown={zone === "player-0:exile"}
                actions={prompt?.input.type === "chooseAction" ? prompt.input.actions : []}
                onAction={(action) => {
                  if (prompt?.input.type !== "chooseAction") return;
                  setZone(null);
                  void game.respond(prompt.promptId, {
                    type: "chooseAction",
                    output: { type: "act", actionId: action.id },
                  });
                }}
              />
            </DuelModal>
          )}
          {confirmConcede && (
            <DuelModal title="Match menu" onClose={() => setConfirmConcede(false)}>
              <h2>Match menu</h2>
              <p>Your deck: {game.deckName}</p>
              <button onClick={() => setConfirmConcede(false)}>Return to match</button>
              {onExit && <button onClick={onExit}>Leave match and return to Play</button>}
              <button
                onClick={() => {
                  game.concede();
                  setConfirmConcede(false);
                }}
              >
                Concede this match
              </button>
            </DuelModal>
          )}
          {view.gameOver && (
            <section className="duel-start">
              <small>MATCH COMPLETE</small>
              <h2>
                {view.winnerId === "player-0" ? "Victory" : view.winnerId ? "Defeat" : "Draw"}
              </h2>
              <p>The Forge engine has ended the game.</p>
              <button onClick={() => void game.restart()}>Play again</button>
              {onExit && <button onClick={onExit}>Back to Play</button>}
            </section>
          )}
        </>
      )}
    </main>
  );
}
