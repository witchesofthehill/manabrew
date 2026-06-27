import { TargetingIntent } from "@/types/promptType";
import { VORTEX_PATH } from "@/components/icons/VortexCircleIcon";

// Game-Icons (https://game-icons.net/) glyphs imported through the
// `unplugin-icons` Vite plugin (raw compiler → SVG string). Shared by the
// Pixi `PointerLayer` (rasterised into textures) and the DOM `TargetingCursor`
// (rendered inline). Icons © Lorc, Delapouite & contributors, CC-BY 3.0.

import damageUrl from "~icons/game-icons/lightning-trio";
import destroyUrl from "~icons/game-icons/broken-shield";
import sacrificeUrl from "~icons/game-icons/sacrificial-dagger";
import bounceUrl from "~icons/game-icons/return-arrow";
import millUrl from "~icons/game-icons/book-pile";
import discardUrl from "~icons/game-icons/card-discard";
import counterUrl from "~icons/game-icons/cancel";
import tapUrl from "~icons/game-icons/clockwise-rotation";
import untapUrl from "~icons/game-icons/anticlockwise-rotation";
import copyUrl from "~icons/game-icons/mirror-mirror";
import buffUrl from "~icons/game-icons/muscle-up";
import debuffUrl from "~icons/game-icons/broken-heart";
import healUrl from "~icons/game-icons/healing";
import loseLifeUrl from "~icons/game-icons/bleeding-heart";
import revealUrl from "~icons/game-icons/eye-target";
import drawUrl from "~icons/game-icons/card-draw";
import gainControlUrl from "~icons/game-icons/handcuffs";
import fightUrl from "~icons/game-icons/crossed-swords";
import hostileUrl from "~icons/game-icons/crosshair";
import friendlyUrl from "~icons/game-icons/shield-reflect";
import arrowCursorUrl from "~icons/game-icons/arrow-cursor";

// Exile uses the game-icons "vortex" clipped to a circle (matching the scry
// prompt and exile zone) rather than the raw square glyph — see `VortexCircleIcon`.
const exileUrl = `<svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 512 512"><clipPath id="mb-exile-cursor-clip"><circle cx="256" cy="256" r="256"/></clipPath><path fill="currentColor" clip-path="url(#mb-exile-cursor-clip)" d="${VORTEX_PATH}"/></svg>`;

/** Raw SVG source for hostile intents (coloured with `pointer.hostile`).
 *  Keep in sync with `intentIsHostile` in `src/types/promptType.ts`. */
export const HOSTILE_INTENT_GLYPHS: Partial<Record<TargetingIntent, string>> = {
  damage: damageUrl,
  destroy: destroyUrl,
  sacrifice: sacrificeUrl,
  exile: exileUrl,
  bounce: bounceUrl,
  mill: millUrl,
  discard: discardUrl,
  counter: counterUrl,
  tap: tapUrl,
  debuff: debuffUrl,
  loseLife: loseLifeUrl,
  gainControl: gainControlUrl,
  fight: fightUrl,
  hostile: hostileUrl,
};

/** Raw SVG source for friendly intents (coloured with `pointer.friendly`). */
export const FRIENDLY_INTENT_GLYPHS: Partial<Record<TargetingIntent, string>> = {
  untap: untapUrl,
  copy: copyUrl,
  buff: buffUrl,
  heal: healUrl,
  reveal: revealUrl,
  draw: drawUrl,
  friendly: friendlyUrl,
};

/** Combined lookup. `null` entries are combat intents rendered as arrows. */
export const INTENT_GLYPH_SVG: Record<TargetingIntent, string | null> = {
  ...HOSTILE_INTENT_GLYPHS,
  ...FRIENDLY_INTENT_GLYPHS,
  attack: null,
  block: null,
  attach: null,
} as Record<TargetingIntent, string | null>;

/** The main pointer glyph (arrow), used as the DOM targeting cursor. */
export const ARROW_CURSOR_GLYPH: string = arrowCursorUrl;
