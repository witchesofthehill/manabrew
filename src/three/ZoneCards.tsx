import { ManaText } from "@/three/ManaSymbols";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AvailableAction, CardDto } from "@manabrew/protocol";
import back from "@/three/assets/card-back.png";
import { arenaCardImageUrl } from "@/three/arenaImageCache";
import "@/three/ZoneCards.css";

export function ZoneCards({
  cards,
  actions = [],
  onAction,
  inspectFaceDown = false,
}: {
  cards: CardDto[];
  actions?: AvailableAction[];
  onAction?: (action: AvailableAction) => void;
  inspectFaceDown?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, Math.max(0, cards.length - 1));
  const swipe = useRef<number | null>(null);
  const wheel = useRef(0);
  const move = (delta: number) =>
    setIndex(Math.max(0, Math.min(cards.length - 1, current + delta)));
  const concealed = (card: CardDto) =>
    card.isFaceDown &&
    !(
      inspectFaceDown &&
      card.identity.name &&
      !["Hidden Card", "Face-down card", "Face Down"].includes(card.identity.name)
    );
  const name = (card: CardDto) => (concealed(card) ? "Face-down card" : card.identity.name);
  if (!cards.length) return <p>This zone is empty.</p>;
  return (
    <section
      className="duel-zone-browser"
      aria-label="Browse cards"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).matches("input")) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          move(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      <div
        className="duel-zone-fan"
        tabIndex={0}
        aria-label="Card stack: use left and right arrow keys"
        onTouchStart={(event) => {
          swipe.current = event.touches[0].clientX;
        }}
        onTouchEnd={(event) => {
          if (swipe.current !== null) {
            const delta = swipe.current - event.changedTouches[0].clientX;
            if (Math.abs(delta) > 35) move(delta > 0 ? 1 : -1);
          }
          swipe.current = null;
        }}
        onWheel={(event) => {
          if (event.ctrlKey || Math.abs(event.deltaY) + Math.abs(event.deltaX) < 8) return;
          if (Date.now() - wheel.current < 200) return;
          wheel.current = Date.now();
          move(event.deltaY + event.deltaX > 0 ? 1 : -1);
        }}
      >
        {cards.map((card, i) => {
          const offset = i - current;
          if (Math.abs(offset) > 4) return null;
          return (
            <button
              key={card.id}
              className="duel-zone-leaf"
              type="button"
              tabIndex={-1}
              aria-label={`View ${name(card)}, card ${i + 1}`}
              aria-current={offset === 0 ? "true" : undefined}
              style={
                {
                  "--offset": offset,
                  "--distance": Math.abs(offset),
                  zIndex: 10 - Math.abs(offset),
                } as CSSProperties
              }
              onClick={() => setIndex(i)}
            >
              <img
                src={concealed(card) ? back : arenaCardImageUrl(card.identity.name, "large")}
                alt={name(card)}
                draggable={false}
                onError={(event) => {
                  if (event.currentTarget.src !== back) event.currentTarget.src = back;
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="duel-zone-caption" aria-live="polite">
        <strong>{name(cards[current])}</strong>
        <span>
          {current + 1} / {cards.length} cards
        </span>
      </div>
      {onAction && (
        <div className="duel-zone-actions" aria-label="Available card actions">
          {actions
            .filter((action) => action.cardId === cards[current].id)
            .map((action) => (
              <button key={action.id} onClick={() => onAction(action)}>
                <ManaText
                  text={
                    action.type === "cast"
                      ? action.label
                      : action.type === "activateAbility"
                        ? action.description
                        : "Undo mana"
                  }
                />
              </button>
            ))}
        </div>
      )}
      {cards.length > 1 && (
        <>
          <input
            className="duel-zone-scrubber"
            type="range"
            aria-label="Browse card position"
            min={0}
            max={cards.length - 1}
            value={current}
            onChange={(event) => setIndex(Number(event.target.value))}
          />
          <nav className="duel-zone-navigation" aria-label="Browse zone">
            <button disabled={current === 0} onClick={() => move(-1)}>
              ← Previous
            </button>
            <button disabled={current === cards.length - 1} onClick={() => move(1)}>
              Next →
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
