import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { StackObjectDto } from "@manabrew/protocol";
import { DuelModal } from "@/three/DuelModal";

const art = (spell: StackObjectDto) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(spell.identity.name)}&format=image&version=large`;
export function SpellStack({
  stack,
  open,
  onOpen,
  onClose,
}: {
  stack: StackObjectDto[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(stack);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(stack.length / 2));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(stack), stack.length ? 0 : 260);
    return () => window.clearTimeout(timer);
  }, [stack]);
  const ordered = [...shown].reverse();
  const top = ordered[0];
  return (
    <>
      {top && (
        <aside className="duel-spell-stack" data-leaving={!stack.length} aria-label="Spell stack">
          <header>
            <strong>Stack</strong>
            <span>{stack.length} pending</span>
          </header>
          <button
            className="duel-stack-fan"
            onClick={onOpen}
            aria-label={`Inspect stack: ${top.identity.name} next to resolve`}
          >
            {ordered
              .slice(0, 4)
              .reverse()
              .map((spell, index, cards) => {
                const depth = cards.length - 1 - index;
                return (
                  <span
                    key={spell.id}
                    className="duel-stack-card"
                    style={{ "--depth": depth } as CSSProperties}
                  >
                    <img src={art(spell)} alt={spell.identity.name} />
                    <b>{depth === 0 ? "NEXT" : `+${depth}`}</b>
                  </span>
                );
              })}
          </button>
          <button className="duel-stack-caption" onClick={onOpen} aria-label="Inspect spell stack">
            <small>
              {top.isCasting ? "Casting" : "Next to resolve"} -{" "}
              {top.controllerId === "player-0" ? "You" : "Opponent"}
            </small>
            <strong>{top.identity.name}</strong>
            <span>{stack.length > 4 ? `+${stack.length - 4} more - ` : ""}Click to inspect</span>
          </button>
        </aside>
      )}
      {open && (
        <DuelModal title="Spell stack" onClose={onClose}>
          <h2>Spell stack</h2>
          <button onClick={onClose}>Return to battlefield</button>
          {!stack.length && <p>The stack is empty.</p>}
          {pages > 1 && (
            <nav className="duel-zone-pages" aria-label="Stack pages">
              <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                Previous
              </button>
              <span aria-live="polite">
                {currentPage + 1} / {pages}
              </span>
              <button disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>
                Next page
              </button>
            </nav>
          )}
          <div className="duel-stack-list">
            {[...stack]
              .reverse()
              .slice(currentPage * 2, currentPage * 2 + 2)
              .map((spell, index) => (
                <article key={spell.id}>
                  <img src={art(spell)} alt={spell.identity.name} />
                  <div>
                    <small>
                      {index + currentPage * 2 === 0
                        ? "NEXT TO RESOLVE"
                        : `RESOLVES ${index + currentPage * 2 + 1}`}{" "}
                      - {spell.controllerId === "player-0" ? "You" : "Opponent"}
                    </small>
                    <h3>{spell.identity.name}</h3>
                    <p>{spell.text}</p>
                  </div>
                </article>
              ))}
          </div>
        </DuelModal>
      )}
    </>
  );
}
