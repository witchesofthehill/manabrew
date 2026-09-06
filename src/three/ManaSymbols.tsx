import sprite from "@/three/assets/mana-sprite.svg";

const cells: Record<string, [number, number]> = {};
for (let n = 0; n < 20; n++) cells[String(n)] = [n % 10, Math.floor(n / 10)];
["20", "X", "Y", "Z", "W", "U", "B", "R", "G", "S"].forEach((s, i) => {
  cells[s] = [i, 2];
});
["W/U", "W/B", "U/B", "U/R", "B/R", "B/G", "R/W", "R/G", "G/W", "G/U"].forEach((s, i) => {
  cells[s] = [i, 3];
  cells[s.split("/").reverse().join("/")] = [i, 3];
});
["2/W", "2/U", "2/B", "2/R", "2/G", "W/P", "U/P", "B/P", "R/P", "G/P"].forEach((s, i) => {
  cells[s] = [i, 4];
});
["T", "Q", "INF", "HALF", "TAP", "UNTAP", "C"].forEach((s, i) => {
  cells[s] = [i, 5];
});

export function ManaSymbol({ symbol }: { symbol: string }) {
  const cell = cells[symbol.toUpperCase()];
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
