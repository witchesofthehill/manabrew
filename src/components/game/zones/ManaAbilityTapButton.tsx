import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { extractManaLetters } from "@/components/game/manaUtils";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { TouchHintPopover } from "@/components/game/TouchHintPopover";
import { withAlpha, type ManaLetter } from "@/themes/gameTheme";
import { useTheme } from "@/hooks/useTheme";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { manaSymbolUrl } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";

/** Alpha applied to the mana-letter tint when used as the tap-button fill. */
const MANA_BUTTON_ALPHA = 0.45;
/** Background used when the ability doesn't map to a single mana letter. */
const MANA_BUTTON_FALLBACK_ALPHA = 0.4;

/** A button with a mana symbol for tapping a dual land for a specific color, styled to fill card sections. */
export const ManaAbilityTapButton = memo(function ManaAbilityTapButton({
  description,
  onClick,
  small = false,
  className,
}: {
  description: string;
  onClick: () => void;
  small?: boolean;
  className?: string;
}) {
  const letters = extractManaLetters(description);
  const letter = (letters[0] ?? null) as ManaLetter | null;
  const themeColors = useTheme().gameTheme;
  const bgColor = letter
    ? withAlpha(themeColors.mana[letter], MANA_BUTTON_ALPHA)
    : withAlpha(themeColors.promptAction.cancel, MANA_BUTTON_FALLBACK_ALPHA);

  const [hintRect, setHintRect] = useState<DOMRect | null>(null);
  const longPress = useLongPressPreview<string>({
    resolve: (e) => ({ item: description, anchor: e.currentTarget as HTMLElement }),
    show: (_item, anchorRect) => setHintRect(anchorRect),
    hide: () => setHintRect(null),
  });

  return (
    <button
      className={cn(
        "group/mana flex h-full w-full items-center justify-center transition-all hover:brightness-125",
        className,
      )}
      style={{ backgroundColor: bgColor }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.preventDefault()}
      title={`Tap: ${description}`}
      {...longPress}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-black/40 shadow-lg transition-transform group-hover/mana:scale-110",
          small ? "h-6 w-6 p-0.5" : "h-8 w-8 p-1",
        )}
      >
        {letter ? (
          <ScryfallImg
            src={manaSymbolUrl(letter)}
            alt={`{${letter}}`}
            className="h-full w-full drop-shadow-md"
            loading="lazy"
          />
        ) : (
          <span className={cn("font-bold text-white", small ? "text-[7px]" : "text-[9px]")}>
            TAP
          </span>
        )}
      </div>
      {hintRect && (
        <TouchHintPopover anchorRect={hintRect} className="whitespace-nowrap text-[11px]">
          <DynamicTextRender className="align-middle" text={`Tap: ${description}`} />
        </TouchHintPopover>
      )}
    </button>
  );
});
