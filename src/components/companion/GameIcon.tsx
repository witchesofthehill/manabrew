import { cn } from "@/lib/utils";

import bleedingHeart from "~icons/game-icons/bleeding-heart";
import bookCover from "~icons/game-icons/book-cover";
import checkeredFlag from "~icons/game-icons/checkered-flag";
import crossedSwords from "~icons/game-icons/crossed-swords";
import crown from "~icons/game-icons/crown";
import d20 from "~icons/game-icons/dice-twenty-faces-one";
import dragonHead from "~icons/game-icons/dragon-head";
import fairyWand from "~icons/game-icons/fairy-wand";
import healing from "~icons/game-icons/healing";
import lightningTrio from "~icons/game-icons/lightning-trio";
import magicPortal from "~icons/game-icons/magic-portal";
import flame from "~icons/game-icons/flame";
import potionBall from "~icons/game-icons/potion-ball";
import radioactive from "~icons/game-icons/radioactive";
import sandsOfTime from "~icons/game-icons/sands-of-time";
import skullCrack from "~icons/game-icons/skull-crack";
import sparkles from "~icons/game-icons/sparkles";
import spellBook from "~icons/game-icons/spell-book";
import starMedal from "~icons/game-icons/star-medal";
import stormySea from "~icons/game-icons/wave-crest";
import sunPriest from "~icons/game-icons/sun-priest";
import sword from "~icons/game-icons/broadsword";
import tornado from "~icons/game-icons/tornado";
import trophyCup from "~icons/game-icons/trophy-cup";
import vortex from "~icons/game-icons/vortex";

const ICONS = {
  "bleeding-heart": bleedingHeart,
  "book-cover": bookCover,
  "checkered-flag": checkeredFlag,
  "crossed-swords": crossedSwords,
  crown,
  d20,
  "dragon-head": dragonHead,
  "fairy-wand": fairyWand,
  healing,
  "lightning-trio": lightningTrio,
  "magic-portal": magicPortal,
  flame,
  "potion-ball": potionBall,
  radioactive,
  "sands-of-time": sandsOfTime,
  "skull-crack": skullCrack,
  sparkles,
  "spell-book": spellBook,
  "star-medal": starMedal,
  "stormy-sea": stormySea,
  "sun-priest": sunPriest,
  sword,
  tornado,
  "trophy-cup": trophyCup,
  vortex,
} as const;

export type GameIconKey = keyof typeof ICONS;

/**
 * Game-Icons SVGs as shipped by `unplugin-icons` have `width="1.2em"`,
 * `height="1.2em"`, `fill="currentColor"` and no xmlns. The em-based
 * dimensions resolve to nothing in a detached data-URL context, the
 * missing xmlns blocks some browsers from decoding the SVG at all, and
 * `currentColor` only ever paints the mask layer (no DOM context), so
 * the source can't tint the painted icon. Normalise the raw string
 * before encoding so `mask-image: url(...)` renders the glyph as an
 * opaque black silhouette that the host element then colours via
 * `background-color: currentColor`.
 */
function svgToMaskUrl(svg: string): string {
  let patched = svg.replace(/\s(width|height)="[^"]*"/gi, "");
  patched = patched.replace(/fill="currentColor"/gi, 'fill="#000"');
  if (!/<svg[^>]*\bxmlns=/.test(patched)) {
    patched = patched.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}")`;
}

const ICON_URLS: Record<GameIconKey, string> = Object.fromEntries(
  Object.entries(ICONS).map(([key, svg]) => [key, svgToMaskUrl(svg)]),
) as Record<GameIconKey, string>;

interface GameIconProps {
  icon: GameIconKey;
  className?: string;
  title?: string;
}

export function GameIcon({ icon, className, title }: GameIconProps) {
  const dataUrl = ICON_URLS[icon];
  return (
    <span
      aria-hidden
      title={title}
      className={cn("inline-block bg-current", className)}
      style={{
        maskImage: dataUrl,
        WebkitMaskImage: dataUrl,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
