import { cn } from "@/lib/utils";
import { withAlpha } from "@/themes/gameTheme";
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { useTheme } from "@/hooks/useTheme";
import { ScryfallImg } from "@/components/ScryfallImg";

interface LibraryZoneTileProps {
  count: number;
  onClick?: () => void;
  label?: string;
}

export function LibraryZoneTile({ count, onClick, label = "Lib" }: LibraryZoneTileProps) {
  const themeColors = useTheme().gameTheme;
  const fontSizes = useTheme().gameTheme.fontSizes;
  const ringColor = themeColors.activeAction.active;
  const empty = count === 0;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        className={cn(
          "relative h-[100px] w-[72px] overflow-hidden rounded-md transition-colors",
          "border-2",
          onClick ? "hover:brightness-110 cursor-pointer" : "opacity-95",
        )}
        style={{
          borderColor: ringColor,
          boxShadow: `0 1px 4px ${withAlpha(ringColor, 0.25)}`,
        }}
        onClick={onClick}
        disabled={!onClick}
        title="Library"
      >
        {!empty && (
          <ScryfallImg
            src={CARD_BACK_IMAGE_URL}
            alt=""
            loading="eager"
            className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none"
            draggable={false}
          />
        )}
        <span
          className="absolute bottom-0 left-0 right-0 flex justify-center py-0.5 font-extrabold leading-none tabular-nums text-white"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.62)", fontSize: fontSizes.zoneCount }}
        >
          {count}
        </span>
      </button>
      <span
        className="uppercase tracking-wide text-muted-foreground"
        style={{ fontSize: fontSizes.zoneLabel }}
      >
        {label}
      </span>
    </div>
  );
}
