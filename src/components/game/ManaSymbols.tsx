import { cn } from "@/lib/utils";
import { manaSymbolUrl, normalizeManaCode } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import type { ManaCode } from "@/types/scryfall";

/**
 * Renders mana cost strings as inline Scryfall SVG symbols.
 *
 * Accepts two formats:
 *  - Braced: `{2}{W}{U}`, `{W/U}`, `{X}{R}`
 *  - Space-separated: `2 W U`, `W`, `W/U`
 */

const SIZE_CLASSES = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
  /** Scales with surrounding font size. */
  em: "h-[1em] w-[1em]",
} as const;

export type ManaSymbolSize = keyof typeof SIZE_CLASSES;

/** Parse a mana cost string into individual symbol tokens. */
function parseManaSymbols(cost: string): ManaCode[] {
  if (!cost || cost === "no cost") return [];
  if (cost.includes("{")) {
    const matches = cost.match(/\{[^}]+\}/g);
    if (!matches) return [];
    return matches
      .map((m) => m.slice(1, -1).trim())
      .map(normalizeManaCode)
      .filter((s): s is ManaCode => s != null);
  }
  return cost
    .split(/\s+/)
    .map(normalizeManaCode)
    .filter((s): s is ManaCode => s != null);
}

interface ManaSymbolsProps {
  cost: string;
  size?: ManaSymbolSize;
  className?: string;
}

export function ManaSymbols({ cost, size = "md", className }: ManaSymbolsProps) {
  const symbols = parseManaSymbols(cost);
  if (symbols.length === 0) return null;

  const sizeClass = SIZE_CLASSES[size];

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {symbols.map((sym, i) => (
        <ScryfallImg
          key={`${sym}-${i}`}
          src={manaSymbolUrl(sym)}
          alt={`{${sym}}`}
          title={`{${sym}}`}
          className={sizeClass}
          loading="lazy"
        />
      ))}
    </span>
  );
}
