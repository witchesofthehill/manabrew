import { Graphics, Text, TextStyle, type Container } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { CARD_RADIUS, CARD_W } from "@/components/game/game.constants";
import { hexToNum } from "@/pixi/colorUtils";
import { ensureTextContrast } from "@/themes/gameTheme";
import type { CardStatPresentation } from "@/components/game/cardPresentation";
import type { CardRenderRegion } from "@/lib/cardRenderGeometry";
import { UI_FONT_FAMILY } from "@/themes/typography";

export const RULES_BODY_FONT = "Georgia, Cambria, Times New Roman, serif";
export const RULES_TITLE_FONT = UI_FONT_FAMILY;

export const RULES_CARD_CONSTRAINTS = {
  width: 360,
  height: 504,
  radius: 13,
} as const;
const RULES_TEXT_MIN_CONTRAST = 4.5;

export function rulesCardRadius(width: number, height: number): number {
  return (Math.min(width, height) * CARD_RADIUS) / CARD_W;
}

export interface RulesPreviewFrameStyle {
  paper: string;
  raised: string;
  ink: string;
  mutedInk: string;
  border: string;
  bodyFont: string;
  textured: boolean;
}

export function resolveRulesPreviewFrame(
  theme: Theme,
  native?: CardRenderRegion,
  scanOverlay = false,
): RulesPreviewFrameStyle {
  if (scanOverlay) {
    const game = theme.gameTheme;
    const paper = game.cardPlaceholder.fill;
    const ink = game.canvas.neutral;
    return {
      paper,
      raised: game.canvas.background,
      ink,
      mutedInk: ensureTextContrast(game.textMuted, paper, ink, RULES_TEXT_MIN_CONTRAST),
      border: game.cardPlaceholder.stroke,
      bodyFont: RULES_BODY_FONT,
      textured: false,
    };
  }
  const palette = theme.gameTheme.cardPaper;
  const paper = palette.background;
  const ink = native?.inkTone === "light" ? theme.gameTheme.canvas.neutral : palette.ink;
  const mutedInk = native
    ? ink
    : ensureTextContrast(palette.mutedInk, paper, ink, RULES_TEXT_MIN_CONTRAST);
  return {
    paper,
    raised: palette.raised,
    ink,
    mutedInk,
    border: palette.border,
    bodyFont: native?.fontFamily ?? RULES_BODY_FONT,
    textured: native !== undefined,
  };
}

export function drawRulesStatBadge(
  target: Container,
  stats: CardStatPresentation,
  right: number,
  top: number,
  style: RulesPreviewFrameStyle,
  theme: Theme,
): number {
  const value = new Text({
    text: `${stats.power}/${stats.toughness}`,
    style: new TextStyle({
      fill: stats.state === "neutral" ? style.ink : theme.gameTheme.textOnTinted,
      fontFamily: RULES_TITLE_FONT,
      fontSize: 20,
      fontWeight: "700",
      lineHeight: 26,
    }),
  });
  value.resolution = 2;
  const width = value.width + 24;
  const badge = new Graphics();
  badge.roundRect(right - width, top, width, 30, 7);
  badge.fill(hexToNum(stats.state === "neutral" ? style.raised : theme.gameTheme.pt[stats.state]));
  badge.stroke({ color: hexToNum(style.border), width: 1 });
  value.position.set(right - width / 2, top + 15);
  value.anchor.set(0.5);
  target.addChild(badge, value);
  right -= width + 10;
  if (stats.basePower != null && stats.baseToughness != null && stats.state !== "neutral") {
    const base = new Text({
      text: `${stats.basePower}/${stats.baseToughness}`,
      style: new TextStyle({
        fill: style.mutedInk,
        fontFamily: RULES_BODY_FONT,
        fontSize: 11,
        fontWeight: "400",
        lineHeight: 14,
      }),
    });
    base.resolution = 2;
    base.anchor.set(1, 0.5);
    base.position.set(right, top + 15);
    target.addChild(base);
    right -= base.width + 10;
  }
  return right;
}
