import { useEffect, useRef, useState } from "react";
import type { PromptInput, PromptOutput } from "@manabrew/protocol";
import { arenaCardImageUrl, watchArenaImage } from "@/three/arenaImageCache";
import "@/three/CardArrangement.css";

type Arrangement = Extract<PromptInput, { type: "scry" | "reorder" }>;
const destinations: Record<string, string> = {
  libraryTop: "Top of library",
  libraryBottom: "Bottom of library",
  graveyard: "Graveyard",
  exile: "Exile",
  hand: "Hand",
  order: "Card order",
};
function Artwork({ name }: { name: string }) {
  const [source, setSource] = useState<string>();
  useEffect(
    () => watchArenaImage(arenaCardImageUrl(name, "large"), (image) => setSource(image.src)),
    [name],
  );
  return source ? (
    <img src={source} alt={name} />
  ) : (
    <span className="duel-arrangement-placeholder">{name}</span>
  );
}
export function CardArrangement({
  input,
  send,
}: {
  input: Arrangement;
  send: (output: PromptOutput) => void;
}) {
  const entries =
    input.type === "scry" ? input.cards.map((card) => ({ id: card.id, card })) : input.items;
  const zones = input.type === "scry" ? input.zones : ["order"];
  const [groups, setGroups] = useState<string[][]>(() =>
    zones.map((_, i) => (i === 0 ? entries.map((entry) => entry.id) : [])),
  );
  const [selected, setSelected] = useState(entries[0]?.id);
  const sent = useRef(false);
  const focused = entries.find((entry) => entry.id === selected);
  const move = (id: string, zone: number) =>
    setGroups((old) =>
      old.map((ids, i) =>
        i === zone
          ? [...ids.filter((value) => value !== id), id]
          : ids.filter((value) => value !== id),
      ),
    );
  const reorder = (zone: number, index: number, delta: number) =>
    setGroups((old) =>
      old.map((ids, i) => {
        if (i !== zone) return ids;
        const next = [...ids];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        return next;
      }),
    );
  return (
    <div className="duel-arrangement">
      <p>
        {input.type === "scry"
          ? "Choose where each card goes. Order each group from first to last."
          : "Arrange the cards from first to last."}
      </p>
      <div className="duel-arrangement-workspace">
        {focused && (
          <div className="duel-arrangement-preview">
            <Artwork key={focused.id} name={focused.card.identity.name} />
            <strong>{focused.card.identity.name}</strong>
          </div>
        )}
        <div className="duel-arrangement-zones">
          {zones.map((zone, zoneIndex) => (
            <section className="duel-arrangement-zone" key={zone} data-zone={zone}>
              <header>
                <strong>
                  {zone === "libraryTop" ? "↑ " : zone === "libraryBottom" ? "↓ " : ""}
                  {destinations[zone]}
                </strong>
                <span>{groups[zoneIndex].length} cards</span>
              </header>
              {zone === "libraryTop" && <small>First card here is drawn next</small>}
              {zone === "libraryBottom" && (
                <small>These cards go beneath the rest of your library</small>
              )}
              <div className="duel-arrangement-cards">
                {groups[zoneIndex].map((id, index) => {
                  const entry = entries.find((entry) => entry.id === id)!;
                  return (
                    <div className="duel-arrangement-card" key={id}>
                      <button
                        className="duel-arrangement-thumbnail"
                        aria-label={`Inspect ${entry.card.identity.name}`}
                        aria-pressed={selected === id}
                        onClick={() => setSelected(id)}
                        onMouseEnter={() => setSelected(id)}
                        onFocus={() => setSelected(id)}
                      >
                        <Artwork name={entry.card.identity.name} />
                        <span>
                          {index + 1}. {entry.card.identity.name}
                        </span>
                      </button>
                      <div className="duel-arrangement-order">
                        <button
                          disabled={index === 0}
                          aria-label={`Move ${entry.card.identity.name} earlier`}
                          onClick={() => reorder(zoneIndex, index, -1)}
                        >
                          ←
                        </button>
                        <button
                          disabled={index === groups[zoneIndex].length - 1}
                          aria-label={`Move ${entry.card.identity.name} later`}
                          onClick={() => reorder(zoneIndex, index, 1)}
                        >
                          →
                        </button>
                      </div>
                      {zones.map(
                        (target, targetIndex) =>
                          targetIndex !== zoneIndex && (
                            <button key={target} onClick={() => move(id, targetIndex)}>
                              Move to {destinations[target].toLowerCase()}
                            </button>
                          ),
                      )}
                    </div>
                  );
                })}
                {!groups[zoneIndex].length && (
                  <span className="duel-arrangement-empty">No cards here</span>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      <footer>
        <span>
          {groups
            .map((ids, i) => `${ids.length} ${destinations[zones[i]].toLowerCase()}`)
            .join(" · ")}
        </span>
        <button
          className="duel-primary"
          onClick={() => {
            if (sent.current) return;
            sent.current = true;
            send(
              input.type === "scry"
                ? { type: "scry", output: { type: "scryDecision", zoneCardIds: groups } }
                : { type: "reorder", output: { type: "reorderDecision", orderedIds: groups[0] } },
            );
          }}
        >
          Confirm arrangement
        </button>
      </footer>
    </div>
  );
}
