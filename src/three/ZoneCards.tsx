import { useState } from "react";
import type { CardDto } from "@manabrew/protocol";
import back from "@/three/assets/card-back.png";

export function ZoneCards({ cards }: { cards: CardDto[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(cards.length / 6));
  const current = Math.min(page, pages - 1);
  return (
    <>
      <div className="duel-zone-cards">
        {cards.slice(current * 6, current * 6 + 6).map((card) => (
          <figure key={card.id}>
            <img
              loading="lazy"
              src={
                card.isFaceDown
                  ? back
                  : `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.identity.name)}&format=image&version=large`
              }
              alt={card.isFaceDown ? "Face-down card" : card.identity.name}
            />
            <figcaption title={card.isFaceDown ? "Face-down card" : card.identity.name}>
              {card.isFaceDown ? "Face-down card" : card.identity.name}
            </figcaption>
          </figure>
        ))}
      </div>
      {pages > 1 && (
        <nav className="duel-zone-pages" aria-label="Zone pages">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span aria-live="polite">
            {current + 1} / {pages} - {cards.length} cards
          </span>
          <button disabled={current === pages - 1} onClick={() => setPage(current + 1)}>
            Next page
          </button>
        </nav>
      )}
    </>
  );
}
