import { Heart } from "lucide-react";

import { ManaSymbols } from "@/components/game/ManaSymbols";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

interface DynamicTextRenderProps {
  text: string;
  className?: string;
}

// Splits on mana groups (`{2}{R}`) and power/toughness modifiers (`+2/+2`,
// `-1/-1`, `+0/-1`), keeping the delimiters so each renders specially.
const TOKEN = /(\{[^}]+\}(?:\{[^}]+\})*|[+-]\d+\/[+-]\d+)/g;
const PT_MODIFIER = /^[+-]\d+\/[+-]\d+$/;

/**
 * Renders a text string with inline mana symbols and styled power/toughness
 * modifiers. `{W}`, `{2}{R}` become Scryfall SVG symbols; `+2/+2` / `-1/-1`
 * become colored P/T pills; plain text is rendered as-is.
 */
export function DynamicTextRender({ text, className }: DynamicTextRenderProps) {
  const lifeColor = useTheme().gameTheme.life;
  const parts = text.split(TOKEN);
  return (
    <span className={cn("inline-flex items-center gap-0.5 flex-wrap", className)}>
      {parts.map((part, i) => {
        if (part === "{LIFE}") {
          return (
            <Heart
              key={i}
              className="inline h-[0.7em] w-[0.7em] shrink-0 mr-1"
              style={{ color: lifeColor, fill: lifeColor }}
            />
          );
        }
        if (part.startsWith("{")) {
          return <ManaSymbols key={i} cost={part} size="em" />;
        }
        if (PT_MODIFIER.test(part)) {
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded px-1 font-semibold tabular-nums",
                part.startsWith("-")
                  ? "text-pt-debuffed bg-pt-debuffed/15"
                  : "text-pt-buffed bg-pt-buffed/15",
              )}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
