import { FillGradient, Graphics, Text, TextStyle, type Container } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { cardFrameTints, readableTextColor } from "@/themes/gameTheme";
import { FLASH_CARD_SIZE } from "@/components/game/game.styles";
import type { CardStatPresentation } from "@/components/game/cardPresentation";

export const RULES_BODY_FONT = "Georgia, Cambria, Times New Roman, serif";
export const RULES_TITLE_FONT = "Cormorant Garamond, Georgia, serif";
export const RULES_TITLE_ART_RADIUS = 7;

export const RULES_CARD_CONSTRAINTS = {
  width: FLASH_CARD_SIZE.w,
  height: FLASH_CARD_SIZE.h,
  radius: 13,
} as const;

export function rulesCardRadius(width: number, height: number): number {
  return (
    (Math.min(width, height) * RULES_CARD_CONSTRAINTS.radius) /
    Math.min(RULES_CARD_CONSTRAINTS.width, RULES_CARD_CONSTRAINTS.height)
  );
}

const GRAIN_POINTS = (() => {
  const points = new Float32Array(1024);
  let seed = 17;
  for (let index = 0; index < points.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    points[index] = (seed >>> 0) / 4294967296;
  }
  return points;
})();

export interface RulesPreviewFrameStyle {
  paper: string;
  raised: string;
  ink: string;
  mutedInk: string;
  border: string;
  title: string;
  titleInk: string;
  titleGradient: FillGradient | null;
}

interface RulesPreviewFrameGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  artInset: number;
  artY: number;
  artHeight: number;
  typeY: number;
  typeHeight: number;
  footerHeight: number;
}

export function resolveRulesPreviewFrame(
  theme: Theme,
  colorIdentity?: string[],
): RulesPreviewFrameStyle {
  const { primary, secondary } = cardFrameTints(colorIdentity, theme.gameTheme.mana);
  const titleGradient = secondary
    ? new FillGradient({
        type: "linear",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        colorStops: [
          { offset: 0, color: primary },
          { offset: 0.42, color: primary },
          { offset: 0.58, color: secondary },
          { offset: 1, color: secondary },
        ],
        textureSpace: "local",
      })
    : null;
  return {
    paper: theme.appTheme.popover,
    raised: theme.appTheme.muted,
    ink: theme.appTheme["popover-foreground"],
    mutedInk: theme.appTheme["muted-foreground"],
    border: primary,
    title: primary,
    titleInk: readableTextColor(
      primary,
      theme.gameTheme.canvas.shadow,
      theme.gameTheme.textOnTinted,
    ),
    titleGradient,
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

export function drawRulesPreviewFrame(
  graphics: Graphics,
  style: RulesPreviewFrameStyle,
  geometry: RulesPreviewFrameGeometry,
): void {
  const {
    x,
    y,
    width,
    height,
    headerHeight,
    artInset,
    artY,
    artHeight,
    typeY,
    typeHeight,
    footerHeight,
  } = geometry;
  const insetX = x + artInset;
  const innerWidth = width - artInset * 2;
  const titleTopInset = 11;
  const titleY = y + titleTopInset;
  const titleHeight = headerHeight - titleTopInset - 4;
  const rulesY = y + typeY + typeHeight + 4;
  const rulesHeight = height - typeY - typeHeight - footerHeight - 4;
  const border = hexToNum(style.border);
  const surface = hexToNum(style.paper);
  const raised = hexToNum(style.raised);

  graphics
    .roundRect(x, y, width, height, rulesCardRadius(width, height))
    .fill(surface)
    .stroke({ color: border, width: 1.25 });
  graphics
    .roundRect(
      insetX,
      titleY,
      innerWidth,
      artHeight > 0 ? artY + artHeight - titleTopInset : titleHeight,
      RULES_TITLE_ART_RADIUS,
    )
    .fill(style.titleGradient ?? hexToNum(style.title));
  graphics.roundRect(insetX, y + typeY, innerWidth, typeHeight, 5).fill(raised);

  for (let index = 0; index < GRAIN_POINTS.length; index += 2) {
    graphics.circle(
      insetX + 4 + GRAIN_POINTS[index]! * (innerWidth - 8),
      rulesY + 4 + GRAIN_POINTS[index + 1]! * (rulesHeight - 8),
      index % 4 === 0 ? 0.35 : 0.55,
    );
  }
  graphics.fill({ color: hexToNum(style.ink), alpha: 0.025 });
}
