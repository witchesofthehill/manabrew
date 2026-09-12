import type { CSSProperties } from "react";
import type { AvailableAction } from "@manabrew/protocol";
import { ManaSymbol, ManaText } from "@/three/ManaSymbols";
import "@/three/ManaWheel.css";

const manaTints: Record<string, string> = {
  W: "#e8d9aa",
  U: "#63a3cf",
  B: "#8f7e9d",
  R: "#cc6850",
  G: "#6c9d68",
  C: "#a4aaa7",
};
export function ManaWheel({
  name,
  actions,
  anchor,
  onChoose,
  onClose,
}: {
  name: string;
  actions: Extract<AvailableAction, { type: "activateAbility" }>[];
  anchor: DOMRect;
  onChoose: (action: AvailableAction) => void;
  onClose: () => void;
}) {
  return (
    <aside
      className="duel-mana-wheel"
      aria-label={`${name}: choose mana`}
      style={{
        left: Math.max(110, Math.min(window.innerWidth - 110, anchor.x + anchor.width / 2)),
        top: Math.max(70, Math.min(window.innerHeight - 200, anchor.y + anchor.height / 2 - 80)),
      }}
    >
      <strong>{name}</strong>
      <div className="duel-mana-wheel-disc">
        {actions.map((action, i) => {
          const start = -Math.PI / 2 + (i * Math.PI * 2) / actions.length;
          const end = start + (Math.PI * 2) / actions.length;
          const middle = (start + end) / 2;
          const points = [
            "50% 50%",
            ...Array.from({ length: 25 }, (_, j) => {
              const angle = start + ((end - start) * j) / 24;
              return `${50 + 50 * Math.cos(angle)}% ${50 + 50 * Math.sin(angle)}%`;
            }),
          ];
          return (
            <button
              key={action.id}
              className="duel-mana-wheel-segment"
              style={
                {
                  clipPath: `polygon(${points.join(",")})`,
                  "--mana-tint": manaTints[action.producedMana![0].color],
                } as CSSProperties
              }
              aria-label={`${i + 1}: ${action.description}${action.cost ? `; cost ${action.cost}` : ""}`}
              title={`${action.description}${action.cost ? ` — ${action.cost}` : ""}`}
              onClick={() => onChoose(action)}
            >
              <span
                style={{
                  left: `${50 + 29 * Math.cos(middle)}%`,
                  top: `${50 + 29 * Math.sin(middle)}%`,
                }}
              >
                {action.producedMana!.map((mana, j) => (
                  <span key={j}>
                    {mana.amount > 1 && <b>{mana.amount}×</b>}
                    <ManaSymbol symbol={mana.color} />
                  </span>
                ))}
                <small>{i + 1}</small>
              </span>
            </button>
          );
        })}
      </div>
      <span className="duel-mana-wheel-cost">
        Choose mana · <ManaText text={actions[0].cost ?? "{T}"} />
      </span>
      <button className="duel-mana-wheel-cancel" onClick={onClose}>
        Cancel · Esc
      </button>
    </aside>
  );
}
