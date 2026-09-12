import { ManaWheel } from "@/three/ManaWheel";
import { useEffect, useRef } from "react";
import type { AvailableAction } from "@manabrew/protocol";
import { ManaText } from "@/three/ManaSymbols";
import "@/three/CardActionPicker.css";

export function CardActionPicker({
  name,
  manaAnchor,
  actions,
  onChoose,
  onClose,
}: {
  name: string;
  manaAnchor?: DOMRect;
  actions: AvailableAction[];
  onChoose: (action: AvailableAction) => void;
  onClose: () => void;
}) {
  const sent = useRef(false);
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
      if (!/^[1-9]$/.test(event.key)) return;
      const action = actions[Number(event.key) - 1];
      if (!action || sent.current) return;
      event.preventDefault();
      sent.current = true;
      onChoose(action);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [actions, onChoose, onClose]);
  const manaActions = actions.filter(
    (a): a is Extract<AvailableAction, { type: "activateAbility" }> =>
      a.type === "activateAbility" && a.isManaAbility && Boolean(a.producedMana?.length),
  );
  if (
    manaAnchor &&
    manaActions.length === actions.length &&
    actions.length >= 2 &&
    actions.length <= 6 &&
    manaActions.every((a) => a.cost === manaActions[0].cost)
  )
    return (
      <ManaWheel
        name={name}
        actions={manaActions}
        anchor={manaAnchor}
        onChoose={select}
        onClose={onClose}
      />
    );
  return (
    <aside className="duel-card-actions" aria-label={`${name} available actions`}>
      <header>
        <small>Choose an action · {actions.length} available</small>
        <strong>{name}</strong>
      </header>
      <div className="duel-ability-options">
        {actions.map((action, index) => {
          const number = index + 1;
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
      <footer>
        <small>1–{Math.min(9, actions.length)} select · Esc close</small>
        <button onClick={onClose}>
          <kbd>Esc</kbd> Close
        </button>
      </footer>
    </aside>
  );
}
