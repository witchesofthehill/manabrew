import type { Graphics } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";

export const RULES_BODY_FONT = "Georgia, Cambria, Times New Roman, serif";
export const RULES_TITLE_FONT = "Cormorant Garamond, Georgia, serif";

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

export function resolveRulesPreviewFrame(theme: Theme): RulesPreviewFrameStyle {
  return {
    paper: theme.appTheme.popover,
    raised: theme.appTheme.muted,
    ink: theme.appTheme["popover-foreground"],
    mutedInk: theme.appTheme["muted-foreground"],
    border: theme.appTheme.border,
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
  } = geometry;
  const insetX = x + artInset;
  const innerWidth = width - artInset * 2;
  const rulesY = y + typeY + typeHeight + 4;
  const rulesHeight = height - typeY - typeHeight - footerHeight - 4;
  const border = hexToNum(style.border);
  const surface = hexToNum(style.paper);
  const raised = hexToNum(style.raised);

  graphics.roundRect(x, y, width, height, 13).fill(surface).stroke({ color: border, width: 1.25 });
  graphics.roundRect(insetX, y + 8, innerWidth, headerHeight - 12, 7).fill(raised);
  graphics.roundRect(insetX, y + artY, innerWidth, artHeight, 8).fill(raised);
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
