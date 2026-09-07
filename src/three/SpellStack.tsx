import { useEffect, useState } from "react";
import { StackCard } from "@/three/StackCard";
import type { StackObjectDto } from "@manabrew/protocol";
import { DuelModal } from "@/three/DuelModal";

const art = (spell: StackObjectDto) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(spell.identity.name)}&format=image&version=large`;
export function SpellStack({
  stack,
  open,
  onOpen,
  onClose,
  onMotion,
  onHover,
  targeting = false,
}: {
  stack: StackObjectDto[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onMotion: (active: boolean) => void;
  onHover: (id: string | null) => void;
  targeting?: boolean;
}) {
  const [shown, setShown] = useState(stack);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(stack.length / 2));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(stack), stack.length ? 0 : 260);
    return () => window.clearTimeout(timer);
  }, [stack]);
  const ordered = [...(stack.length ? stack : shown)].reverse();
  const top = ordered[0];
  return (
    <>
      {top && (
        <aside
          className="duel-spell-stack"
          data-leaving={!stack.length}
          aria-label="Spell stack"
          onMouseLeave={() => onHover(null)}
        >
          <header>
            <strong>Stack</strong>
            <span>{stack.length} pending</span>
          </header>
          <button
            className="duel-stack-fan"
            onClick={onOpen}
            onMouseEnter={() => onHover(top.id)}
            onFocus={() => onHover(top.id)}
            onBlur={() => onHover(null)}
            aria-label={
              targeting
                ? `Aim ${top.identity.name} at a target`
                : `Inspect stack: ${top.identity.name} next to resolve`
            }
          >
            {ordered
              .slice(0, 4)
              .reverse()
              .map((spell, index, cards) => {
                const depth = cards.length - 1 - index;
                return (
                  <StackCard
                    key={spell.id}
                    spell={spell}
                    depth={depth}
                    image={art(spell)}
                    onMotion={onMotion}
                    onHover={onHover}
                  />
                );
              })}
          </button>
          <button
            className="duel-stack-caption"
            onClick={onOpen}
            aria-label="Inspect spell stack"
            onMouseEnter={() => onHover(top.id)}
            onFocus={() => onHover(top.id)}
            onBlur={() => onHover(null)}
          >
            <small>
              {top.isCasting ? "Casting" : "Next to resolve"} -{" "}
              {top.controllerId === "player-0" ? "You" : "Opponent"}
            </small>
            <strong>{top.identity.name}</strong>
            <span>
              {targeting
                ? "Drag to a glowing target"
                : `${stack.length > 4 ? `+${stack.length - 4} more - ` : ""}Click to inspect`}
            </span>
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
