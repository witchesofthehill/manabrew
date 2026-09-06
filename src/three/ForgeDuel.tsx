import { constrainSelection } from "@/three/duelSelection";
import { LifeBadge } from "@/three/LifeBadge";
import { SpellStack } from "@/three/SpellStack";
import { ZoneCards } from "@/three/ZoneCards";
import { DuelModal } from "@/three/DuelModal";
import { ManaSymbol, ManaText } from "@/three/ManaSymbols";
import { DuelFlowBar } from "@/three/DuelFlowBar";
import { nextStepLabel, stepNames } from "@/three/duelFlow";
import { CardPreview } from "@/three/CardPreview";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { CardDto } from "@manabrew/protocol";
import { ArenaScene } from "@/three/ArenaScene";
import { DuelPrompt } from "@/three/DuelPrompt";
import { useForgeDuel } from "@/three/useForgeDuel";
import { duelDecks } from "@/three/duelDecks";
import type { ArenaCard, ArenaColors, ArenaZonePile } from "@/three/arena.types";
import preset from "@/themes/kanagawa";
import "@/three/arena.css";
import "@/three/duel.css";

const colors: ArenaColors = {
  background: preset.dark.background,
  surface: preset.dark.card,
  border: preset.dark.border,
  foreground: preset.dark.foreground,
  muted: preset.dark["muted-foreground"],
  accent: preset.gameColors["mana.U"],
  hostile: preset.gameColors["arrow.attack"],
  playable: preset.gameColors.cardPlayable,
};
const style = Object.fromEntries(
  Object.entries(colors).map(([key, value]) => [`--arena-${key}`, value]),
) as CSSProperties;
const imageUrl = (card: CardDto, variant: string) =>
  card.isFaceDown
    ? undefined
    : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.identity.name)}&format=image&version=${variant}`;

export function ForgeDuel() {
  const game = useForgeDuel();
  const { view, prompt } = game;
  const [abilityChoice, setAbilityChoice] = useState<{ cardId: string; promptId?: string } | null>(
    null,
  );
  const [selection, setSelection] = useState<{
    promptId?: string;
    ids: string[];
    blocks: Record<string, string>;
  }>({ ids: [], blocks: {} });
  const [drag, setDrag] = useState<{ id: string; canPlay: boolean } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [stackOpen, setStackOpen] = useState(false);
  const [zone, setZone] = useState<string | null>(null);
  const [confirmConcede, setConfirmConcede] = useState(false);
  const { setPaused } = game;
  useEffect(() => {
    setPaused(Boolean(zone || confirmConcede || drag || abilityChoice || stackOpen));
  }, [zone, confirmConcede, drag, abilityChoice, stackOpen, setPaused]);
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
          name: card.isFaceDown ? "Face-down card" : card.identity.name,
          type: card.types.join(" "),
          text: card.text,
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
          selected:
            selected.includes(card.id) ||
            (prompt?.input.type === "chooseBlockers" && Boolean(blocks[card.id])),
          playable: legal,
        };
      });
  });
  const opponentHandCount =
    view?.zones.find((z) => z.zone === "hand" && z.ownerId !== "player-0")?.count ?? 0;
  for (let i = 0; i < opponentHandCount; i++) {
    cards.push({
      id: `opponent-hand-${i}`,
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
      else if (actions.length > 1) setAbilityChoice({ cardId: id, promptId: prompt.promptId });
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
  const hovered = allCards.find((c) => c.id === hoverId);
  const zoneCards = zone
    ? allCards.filter((c) =>
        view?.zones.some(
          (z) => `${z.ownerId}:${z.zone}` === zone && z.cards.some((v) => v.id === c.id),
        ),
      )
    : [];
  return (
    <main className="arena-root duel-root" style={style}>
      <ArenaScene
        colors={colors}
        cards={cards}
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
              topImage: top?.visibility === "visible" ? imageUrl(top, "large") : undefined,
              topName: top?.visibility === "visible" ? top.identity.name : undefined,
            };
          })}
        onZone={setZone}
        onCard={choose}
        onHover={setHoverId}
        onDrag={setDrag}
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
          else choose(id);
        }}
      />
      <div className="duel-hand-aura" aria-hidden="true" />
      {hintCard?.side === "hand" && prompt?.input.type === "chooseAction" && (
        <div className="duel-play-hint" data-valid={hintCard.playable} role="status">
          <strong>
            {drag
              ? drag.canPlay
                ? `Release to ${hintCard.type.includes("Land") ? "play" : "cast"} ${hintCard.name}`
                : hintCard.playable
                  ? "Move onto the glowing battlefield"
                  : "Not playable right now"
              : hintCard.playable
                ? `Click or drag to ${hintCard.type.includes("Land") ? "play" : "cast"}`
                : "Not playable right now"}
          </strong>
          <small>
            {drag
              ? "Return to hand or press Esc to cancel"
              : hintCard.playable
                ? "Release inside the border to confirm"
                : "Available cards have a cyan outline"}
          </small>
        </div>
      )}
      <header className="arena-brand">
        <h1>MANABREW</h1>
        <small>LOCAL DUEL · FORGE RULES</small>
      </header>
      {!view && (
        <section className="duel-start">
          <small>CHOOSE YOUR DECK</small>
          <h2>A real duel. Your next move.</h2>
          <p>Play a complete 60-card match against Forge AI.</p>
          {duelDecks.map((deck, i) => (
            <button key={deck.name} disabled={game.loading} onClick={() => void game.start(i)}>
              <ManaSymbol symbol={i === 0 ? "W" : "G"} /> {deck.name} ·{" "}
              {i === 0 ? "White creatures" : "Green creatures"}
            </button>
          ))}
          <p role="status">{game.status}</p>
          {game.error && <p role="alert">{game.error}</p>}
          <a href="/arena.html">Visual playground</a>
        </section>
      )}
      {view && (
        <>
          <div className="arena-status">
            <small>
              TURN {view.turn} ·{" "}
              {view.activePlayerId === "player-0" ? "YOUR TURN" : "OPPONENT'S TURN"}
            </small>
            <h2>{stepNames[view.step] ?? view.step}</h2>
            <p>
              {duelDecks[game.deckIndex].name} vs {duelDecks[1 - game.deckIndex].name}
            </p>
          </div>
          {view.turn > 0 && (
            <div key={`turn-${view.turn}`} className="duel-turn-notice" aria-live="polite">
              <small>Turn {view.turn}</small>
              <strong>{view.activePlayerId === "player-0" ? "Your turn" : "Opponent turn"}</strong>
            </div>
          )}
          {view.players.map((player) => (
            <div
              key={player.id}
              className={`arena-player arena-player-${player.id === "player-0" ? "self" : "opponent"}`}
            >
              <LifeBadge
                life={player.life}
                priority={player.id === view.priorityPlayerId}
                self={player.id === "player-0"}
                symbol={
                  (player.id === "player-0" ? game.deckIndex : 1 - game.deckIndex) === 0 ? "W" : "G"
                }
                onClick={() => choose(player.id)}
              />
              <div>
                <small>{player.id === view.priorityPlayerId ? "PRIORITY" : "PLANESWALKER"}</small>
                <h3>{player.name}</h3>
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
            Match menu
          </button>
          <div className="duel-decision-dock">
            {!view.gameOver && (
              <DuelFlowBar
                step={view.step}
                turn={view.turn}
                ownTurn={view.activePlayerId === "player-0"}
                fullControl={game.fullControl}
                onControl={game.toggleControl}
                stops={game.stops}
                onStop={game.toggleStop}
              />
            )}
            {prompt && !game.autoPassing && !game.autoPaying && !view.gameOver && (
              <DuelPrompt
                key={prompt.promptId}
                prompt={prompt}
                onAutoPay={game.payAutomatically}
                nextLabel={nextStepLabel(view.step, view.stack.length, game.fullControl)}
                autoPassing={game.autoPassing}
                cards={allCards}
                selected={selected}
                onSelected={onSelected}
                blocks={blocks}
                onBlocks={onBlocks}
                send={(action) => game.respond(prompt.promptId, action)}
              />
            )}
            {(!prompt || game.autoPassing || game.autoPaying) && !view.gameOver && (
              <div className="arena-actions duel-auto-status">
                <strong>
                  {game.autoPaying
                    ? "Paying mana…"
                    : view.activePlayerId === "player-0"
                      ? "Continuing your turn"
                      : "Opponent’s turn"}
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
            stack={view.stack}
            open={stackOpen}
            onOpen={() => setStackOpen(true)}
            onClose={() => setStackOpen(false)}
          />
          {abilityChoice &&
            abilityChoice.promptId === prompt?.promptId &&
            prompt?.input.type === "chooseAction" && (
              <aside className="duel-card-actions">
                <strong>
                  {allCards.find((c) => c.id === abilityChoice.cardId)?.identity.name}
                </strong>
                {prompt.input.actions
                  .filter((a) => a.cardId === abilityChoice.cardId)
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        game.respond(prompt.promptId, {
                          type: "chooseAction",
                          output: { type: "act", actionId: a.id },
                        });
                        setAbilityChoice(null);
                      }}
                    >
                      <ManaText
                        text={
                          a.type === "cast"
                            ? a.label
                            : a.type === "activateAbility"
                              ? a.description
                              : "Undo mana"
                        }
                      />
                    </button>
                  ))}
                <button onClick={() => setAbilityChoice(null)}>Cancel</button>
              </aside>
            )}
          <CardPreview
            card={
              hovered && !hovered.isFaceDown
                ? { id: hovered.id, name: hovered.identity.name, image: imageUrl(hovered, "large") }
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
              <ZoneCards key={zone} cards={zoneCards} />
            </DuelModal>
          )}
          {confirmConcede && (
            <DuelModal title="Match menu" onClose={() => setConfirmConcede(false)}>
              <h2>Match menu</h2>
              <button onClick={() => setConfirmConcede(false)}>Return to match</button>
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
              <button onClick={() => void game.start(game.deckIndex)}>Play again</button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
