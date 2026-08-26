import type { CSSProperties } from "react";
import type { CardDto } from "@/protocol/game";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { cn } from "@/lib/utils";
import { firstChosenColor } from "./game.utils";

interface CardChoiceManaPinProps {
  card: Pick<CardDto, "choices">;
  className?: string;
  style?: CSSProperties;
}

export function CardChoiceManaPin({ card, className, style }: CardChoiceManaPinProps) {
  const color = firstChosenColor(card);
  if (!color) return null;

  return (
    <div
      title={`Produces {${color}}`}
      className={cn(
        "absolute bottom-[5.5%] left-[5.5%] z-10 rounded-full bg-canvas-shadow/80 p-[0.08em] text-[8cqw] shadow-md pointer-events-none",
        className,
      )}
      style={style}
    >
      <ManaSymbols cost={`{${color}}`} size="em" className="!m-0" />
    </div>
  );
}
