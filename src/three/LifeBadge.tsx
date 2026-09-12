import { useEffect, useRef, useState } from "react";
import { ManaSymbol } from "@/three/ManaSymbols";
import { MANA_LETTERS } from "@/themes/manaLetters";
export function LifeBadge({
  life,
  priority,
  self,
  symbols,
  onClick,
  playerId,
}: {
  life: number;
  priority: boolean;
  self: boolean;
  symbols: string[];
  onClick: () => void;
  playerId?: string;
}) {
  const identity = MANA_LETTERS.filter((symbol) => symbol !== "C" && symbols.includes(symbol));
  const ring = identity.length >= 4;
  const displayed = ring
    ? MANA_LETTERS.filter((symbol) => symbol !== "C")
    : identity.length
      ? identity
      : ["C"];
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
      data-player-side={self ? "self" : "opponent"}
      data-player-id={playerId}
      aria-label={`${self ? "Your" : "Opponent"} life: ${life}`}
      onClick={onClick}
    >
      <span className="duel-avatar-sigil" data-ring={ring} data-count={displayed.length}>
        {displayed.map((symbol) => (
          <span
            key={symbol}
            className="duel-identity-pip"
            data-dim={ring && !identity.includes(symbol as (typeof identity)[number])}
          >
            <ManaSymbol symbol={symbol} />
          </span>
        ))}
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
