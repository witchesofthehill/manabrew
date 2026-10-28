import { Heart } from "lucide-react";

import { ManaSymbols } from "@/components/game/ManaSymbols";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { DYNAMIC_TEXT_TOKEN, ptModifierTone } from "@/lib/dynamicText";

interface DynamicTextRenderProps {
  text: string;
  className?: string;
}

/**
 * Renders a text string with inline mana symbols and styled power/toughness
 * modifiers. `{W}`, `{2}{R}` become Scryfall SVG symbols; `+2/+2` / `-1/-1`
 * become colored P/T pills; plain text is rendered as-is. Everything flows as
 * normal inline content, so long text wraps word-by-word after a symbol group.
 */
export function DynamicTextRender({ text, className }: DynamicTextRenderProps) {
  const lifeColor = useTheme().gameTheme.life;
  const parts = text.split(DYNAMIC_TEXT_TOKEN);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part === "{LIFE}") {
          return (
            <Heart
              key={i}
              className="inline h-[0.7em] w-[0.7em] shrink-0 mr-1 align-[-0.05em]"
              style={{ color: lifeColor, fill: lifeColor }}
            />
          );
        }
        if (part.startsWith("{")) {
          return <ManaSymbols key={i} cost={part} size="em" className="mx-0 align-[-0.125em]" />;
        }
        const modifierTone = ptModifierTone(part);
        if (modifierTone) {
          return (
            <span
              key={i}
              className={cn(
                "inline-flex items-center rounded px-1 font-semibold tabular-nums",
                modifierTone === "debuffed"
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
