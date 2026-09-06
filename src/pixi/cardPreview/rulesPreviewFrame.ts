import { FillGradient, type Graphics } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { cardFrameTints, readableTextColor } from "@/themes/gameTheme";

export const RULES_BODY_FONT = "Georgia, Cambria, Times New Roman, serif";
export const RULES_TITLE_FONT = "Cormorant Garamond, Georgia, serif";
export const RULES_TITLE_ART_RADIUS = 7;

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
  radius?: number;
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
    radius = 13,
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
    .roundRect(x, y, width, height, radius)
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
  graphics
    .moveTo(insetX + 8, rulesY)
    .lineTo(insetX + innerWidth - 8, rulesY)
    .stroke({ color: border, width: 1, alpha: 0.45 });

  for (let index = 0; index < GRAIN_POINTS.length; index += 2) {
    graphics.circle(
      insetX + 4 + GRAIN_POINTS[index]! * (innerWidth - 8),
      rulesY + 4 + GRAIN_POINTS[index + 1]! * (rulesHeight - 8),
      index % 4 === 0 ? 0.35 : 0.55,
    );
  }
  graphics.fill({ color: hexToNum(style.ink), alpha: 0.025 });
}
