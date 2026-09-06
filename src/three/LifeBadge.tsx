import { useEffect, useRef, useState } from "react";
import { ManaSymbol } from "@/three/ManaSymbols";
export function LifeBadge({
  life,
  priority,
  self,
  symbol,
  onClick,
}: {
  life: number;
  priority: boolean;
  self: boolean;
  symbol: string;
  onClick: () => void;
}) {
  const previous = useRef(life);
  const [change, setChange] = useState<{ delta: number; key: number }>();
  useEffect(() => {
    const delta = life - previous.current;
    previous.current = life;
    if (!delta) return;
    const start = window.setTimeout(() => setChange({ delta, key: Date.now() }), 0);
    const end = window.setTimeout(() => setChange(undefined), 1100);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [life]);
  return (
    <button
      className="arena-avatar duel-life-badge"
      data-priority={priority}
      data-low={life <= 5}
      aria-label={`${self ? "Your" : "Opponent"} life: ${life}`}
      onClick={onClick}
    >
      <span className="duel-avatar-sigil">
        <ManaSymbol symbol={symbol} />
      </span>
      <strong>{life}</strong>
      {change && (
        <em key={change.key} className="duel-life-change" data-gain={change.delta > 0}>
          {change.delta > 0 ? "+" : ""}
          {change.delta}
        </em>
      )}
    </button>
  );
}
