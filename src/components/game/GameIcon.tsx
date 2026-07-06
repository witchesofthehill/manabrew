import type { CSSProperties } from "react";
import { resolveIconBody } from "@/pixi/panelIcons";
import { cn } from "@/lib/utils";

/**
 * Inline SVG renderer backed by `panelIcons.resolveIconBody` (hand-picked
 * registry first, iconify game-icons pack second — the same precedence as
 * the Pixi `gameIconCache`, so zone icons match the HUD capsule pills).
 * The `GameIconName` union is a narrow whitelist: add a name here before
 * using it in a component, so every referenced icon is tracked in one place.
 */
export type GameIconName =
  | "crown"
  | "rolled-cloth"
  | "card-pickup"
  | "poison-bottle"
  | "lightning-trio"
  | "crossed-swords"
  | "radioactive"
  | "stone-tower"
  | "ring"
  | "speedometer"
  | "book-cover"
  | "book-aura"
  | "overlord-helm"
  | "muscle-up"
  | "skull-crack"
  | "shiny-omega"
  | "vibrating-shield"
  | "round-shield"
  | "scroll-quill"
  | "spell-book"
  | "hourglass"
  | "stopwatch"
  | "ghost"
  | "rank-3"
  | "stack"
  | "mining"
  | "brick-wall"
  | "battery-pack-alt"
  | "scroll-unfurled"
  | "anvil"
  | "beer-stein"
  | "deck"
  | "graveyard"
  | "exile";

interface GameIconProps {
  name: GameIconName;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function GameIcon({ name, className, style, title }: GameIconProps) {
  const icon = resolveIconBody(name);
  if (!icon) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${icon.width} ${icon.height}`}
      role={title ? "img" : "presentation"}
      aria-label={title}
      className={cn("shrink-0", className)}
      style={style}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
