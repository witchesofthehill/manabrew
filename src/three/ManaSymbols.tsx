import sprite from "@/three/assets/mana-sprite.svg";

import { manaCells } from "@/three/manaCells";

export function ManaSymbol({ symbol }: { symbol: string }) {
  const cell = manaCells[symbol.toUpperCase()];
  return cell ? (
    <span
      className="duel-mana-symbol"
      role="img"
      aria-label={`Mana ${symbol}`}
      title={symbol}
      style={{
        backgroundImage: `url(${sprite})`,
        backgroundPosition: `${-cell[0] * 21}px ${-cell[1] * 21}px`,
      }}
    />
  ) : (
    <span>{`{${symbol}}`}</span>
  );
}

export function ManaText({ text }: { text: string }) {
  return (
    <span className="duel-mana-text">
      {text
        .split(/(\{[^{}]+\})/g)
        .map((part, i) =>
          part.startsWith("{") ? <ManaSymbol key={i} symbol={part.slice(1, -1)} /> : part,
        )}
    </span>
  );
}
