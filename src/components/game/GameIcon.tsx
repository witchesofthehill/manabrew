import type { CSSProperties } from "react";
import { icons as gameIconsPack } from "@iconify-json/game-icons";
import { SVG as panelIconSvg } from "@/pixi/panelIcons";
import { cn } from "@/lib/utils";

/**
 * Inline SVG renderer backed by `@iconify-json/game-icons`. The icon
 * bodies already ship with the package so we don't duplicate the path
 * data — we look them up by name at render time. The `GameIconName`
 * union is a narrow whitelist: add a name here before using it in a
 * component, so every referenced icon is tracked in one place.
 * The hand-picked `panelIcons` registry wins over the iconify pack —
 * the same precedence as the Pixi `gameIconCache` — so zone icons
 * (deck/graveyard/exile) match the HUD capsule pills and the tiles.
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
  const panelBody = panelIconSvg[name];
  const icon = gameIconsPack.icons[name];
  if (!panelBody && !icon) return null;
  const width = panelBody ? 512 : (icon!.width ?? gameIconsPack.width ?? 512);
  const height = panelBody ? 512 : (icon!.height ?? gameIconsPack.height ?? 512);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      role={title ? "img" : "presentation"}
      aria-label={title}
      className={cn("shrink-0", className)}
      style={style}
      dangerouslySetInnerHTML={{ __html: panelBody ?? icon!.body }}
    />
  );
}
