/**
 * Shared Pixi text styles. Instantiated once and reused across the scene
 * so we don't allocate a new TextStyle per draw call.
 *
 * The `fill` values are seeded from the active theme at module load time
 * (Pixi's color parser refuses empty strings, so we can't defer all
 * resolution to the first `setPixiTextStyleTheme` call) and then
 * rewritten in place whenever the preset or overrides change.
 */

import { UI_FONT_FAMILY as SYSTEM_FONT_FAMILY } from "@/themes/typography";
import { TextStyle } from "pixi.js";
import { CARD_W } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";

// Resolve the current preset synchronously so the styles below have
// concrete fill values from construction — `new TextStyle({ fill: "" })`
// would otherwise fault Pixi's colour parser.
const initialTheme = getTheme().gameTheme;

export const OVERLAY_LABEL_STYLE = new TextStyle({
  fontFamily: SYSTEM_FONT_FAMILY,
  fontSize: 9,
  fontWeight: "bold",
  fill: initialTheme.textOnTinted,
});

export const GHOST_LABEL_STYLE = new TextStyle({
  fontFamily: SYSTEM_FONT_FAMILY,
  fontSize: 9,
  fill: initialTheme.textGhost,
  fontWeight: "500",
  wordWrap: true,
  wordWrapWidth: CARD_W - 8,
  align: "center",
});

export const EMPTY_LABEL_STYLE = new TextStyle({
  fontFamily: SYSTEM_FONT_FAMILY,
  fontSize: 12,
  fill: initialTheme.textMuted,
  fontStyle: "italic",
});

export const SELECTION_BADGE_STYLE = new TextStyle({
  fontFamily: SYSTEM_FONT_FAMILY,
  fontSize: 10,
  fill: initialTheme.textOnTinted,
});

/**
 * Rewrite the `fill` of every shared Pixi text style so it tracks the
 * active theme. Call on each theme-change tick.
 */
export function setPixiTextStyleTheme(theme: Theme): void {
  OVERLAY_LABEL_STYLE.fill = theme.gameTheme.textOnTinted;
  SELECTION_BADGE_STYLE.fill = theme.gameTheme.textOnTinted;
  GHOST_LABEL_STYLE.fill = theme.gameTheme.textGhost;
  EMPTY_LABEL_STYLE.fill = theme.gameTheme.textMuted;
}
