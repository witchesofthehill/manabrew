import { useEffect, useRef, useState } from "react";
import type { AvailableAction } from "@manabrew/protocol";
import { ManaText } from "@/three/ManaSymbols";
import "@/three/CardActionPicker.css";

export function CardActionPicker({
  name,
  actions,
  onChoose,
  onClose,
}: {
  name: string;
  actions: AvailableAction[];
  onChoose: (action: AvailableAction) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() =>
    matchMedia("(max-width: 800px), (max-height: 620px)").matches ? 2 : 3,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 800px), (max-height: 620px)");
    const update = () => setPageSize(media.matches ? 2 : 3);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const sent = useRef(false);
  const pages = Math.max(1, Math.ceil(actions.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = actions.slice(current * pageSize, current * pageSize + pageSize);
  const select = (action: AvailableAction) => {
    if (sent.current) return;
    sent.current = true;
    onChoose(action);
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight" && current < pages - 1) {
        event.preventDefault();
        setPage(current + 1);
        return;
      }
      if (event.key === "ArrowLeft" && current > 0) {
        event.preventDefault();
        setPage(current - 1);
        return;
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const action = actions[Number(event.key) - 1];
      if (!action || sent.current) return;
      event.preventDefault();
      sent.current = true;
      onChoose(action);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [actions, onChoose, onClose, current, pages]);
  return (
    <aside className="duel-card-actions" aria-label={`${name} available actions`}>
      <header>
        <small>Choose an action · {actions.length} available</small>
        <strong>{name}</strong>
      </header>
      <div className="duel-ability-options">
        {visible.map((action, index) => {
          const number = current * pageSize + index + 1;
          return (
            <button key={action.id} onClick={() => select(action)}>
              <span className="duel-ability-heading">
                <kbd>{number <= 9 ? number : "•"}</kbd>
                <small>
                  {action.type === "cast"
                    ? "Cast / play"
                    : action.type === "undoMana"
                      ? "Undo mana"
                      : action.isManaAbility
                        ? "Mana ability"
                        : action.isClassLevelUp
                          ? "Level up"
                          : "Activated ability"}
                </small>
              </span>
              {action.type === "activateAbility" && action.cost && (
                <span className="duel-ability-cost">
                  <ManaText text={action.cost} />
                </span>
              )}
              <span>
                <ManaText
                  text={
                    action.type === "cast"
                      ? action.label
                      : action.type === "activateAbility"
                        ? action.description
                        : "Undo this mana activation"
                  }
                />
              </span>
            </button>
          );
        })}
      </div>
      {pages > 1 && (
        <nav className="duel-choice-pages">
          <button
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            aria-label="Previous abilities"
          >
            ←
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
            aria-label="Next abilities"
          >
            →
          </button>
        </nav>
      )}
      <footer>
        <small>
          1–{Math.min(9, actions.length)} select{pages > 1 ? " · ← → pages" : ""}
        </small>
        <button onClick={onClose}>
          <kbd>Esc</kbd> Close
        </button>
      </footer>
    </aside>
  );
}
