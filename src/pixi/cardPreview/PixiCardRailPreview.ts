import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardRailEffect, CardRailState } from "@/components/game/cardRailState";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { readableTextColor } from "@/themes/gameTheme";
import { RULES_BODY_FONT, type RulesPreviewFrameStyle } from "./rulesPreviewFrame";

interface PixiCardRailPreviewOptions {
  state: CardRailState;
  effects: CardRailEffect[];
  width: number;
  theme: Theme;
  frame: RulesPreviewFrameStyle;
}

const HEADER_HEIGHT = 54;
const ROW_MIN_HEIGHT = 58;
const CONTENT_LEFT = 51;
const CONTENT_RIGHT = 10;
const NODE_X = 26;
const NODE_Y = 25;
const NODE_RADIUS = 13.5;

function style(
  fill: string,
  fontSize: number,
  fontWeight: "400" | "500" | "600" | "700" = "400",
): TextStyle {
  return new TextStyle({
    fill,
    fontFamily: RULES_BODY_FONT,
    fontSize,
    fontWeight,
    lineHeight: fontSize * 1.3,
  });
}

export class PixiCardRailPreview extends Container {
  readonly contentHeight: number;

  constructor({ state, effects, width, theme, frame }: PixiCardRailPreviewOptions) {
    super();
    const { gameTheme } = theme;
    const accent = state.kind === "saga" ? gameTheme.counter.lore : gameTheme.counter.level;
    const foreground = frame.ink;
    const muted = frame.mutedInk;
    const effectByPosition = new Map(effects.map((effect) => [effect.position, effect]));

    const header = new Container();
    const iconBackground = new Graphics();
    iconBackground.circle(14, 14, 14);
    iconBackground.fill({ color: hexToNum(frame.ink), alpha: 0.08 });
    const icon = new Sprite(Texture.EMPTY);
    icon.position.set(6, 6);
    icon.tint = hexToNum(accent);
    const iconName = state.kind === "saga" ? "spell-book" : "rank-3";
    void gameIconTexture(iconName)
      .then((texture) => {
        if (this.destroyed || icon.destroyed) return;
        icon.texture = texture;
        icon.setSize(16, 16);
      })
      .catch(() => undefined);
    const title = new Text({
      text: state.kind === "saga" ? "LORE CHAPTERS" : "CLASS LEVELS",
      style: style(muted, 10, "700"),
    });
    title.resolution = 2;
    title.position.set(39, 2);
    const summary = state.kind === "saga" ? "Chapter" : "Level";
    const summaryText = new Text({
      text:
        state.current > 0
          ? `${summary} ${state.current} of ${state.max}`
          : `Awaiting first ${summary.toLowerCase()}`,
      style: style(foreground, 12, "600"),
    });
    summaryText.resolution = 2;
    summaryText.position.set(39, 19);
    header.position.set(10, 8);
    header.addChild(iconBackground, icon, title, summaryText);
    this.addChild(header);

    let y = HEADER_HEIGHT;
    state.notches.forEach((notch) => {
      const effect = effectByPosition.get(notch.position);
      const row = new Container();
      row.position.set(0, y);
      const rowBackground = new Graphics();
      row.addChild(rowBackground);

      const meta = new Text({
        text: state.kind === "saga" ? `CHAPTER ${notch.label}` : `LEVEL ${notch.label}`,
        style: style(muted, 10, "700"),
      });
      meta.resolution = 2;
      meta.position.set(CONTENT_LEFT, 9);
      row.addChild(meta);

      if (effect?.cost) {
        const cost = new PixiRichText();
        cost.setContent(effect.cost, style(foreground, 11, "600"), 90, 14, 1);
        cost.position.set(width - CONTENT_RIGHT - cost.width, 7);
        row.addChild(cost);
      }

      let contentY = 29;
      if (effect?.label) {
        const label = new PixiRichText();
        const labelHeight = label.setContent(
          effect.label,
          style(foreground, 14, "700"),
          width - CONTENT_LEFT - CONTENT_RIGHT,
          16,
          2,
        );
        label.position.set(CONTENT_LEFT, contentY);
        row.addChild(label);
        contentY += labelHeight + 2;
      }

      const effectText = new PixiRichText();
      const reminderStyle = style(muted, 14);
      reminderStyle.fontStyle = "italic";
      const effectHeight = effectText.setContent(
        effect?.text || "Effect text unavailable",
        style(foreground, 14),
        width - CONTENT_LEFT - CONTENT_RIGHT,
        16,
        2,
        { parentheticalStyle: reminderStyle },
      );
      effectText.position.set(CONTENT_LEFT, contentY);
      row.addChild(effectText);
      const rowHeight = Math.max(ROW_MIN_HEIGHT, contentY + effectHeight + 10);

      const timeline = new Graphics();
      if (notch.position > 1) {
        timeline.rect(NODE_X - 1, 0, 2, NODE_Y);
        timeline.fill({
          color: hexToNum(notch.reached ? accent : frame.mutedInk),
          alpha: 0.92,
        });
      }
      if (notch.position < state.max) {
        timeline.rect(NODE_X - 1, NODE_Y, 2, rowHeight - NODE_Y);
        timeline.fill({
          color: hexToNum(notch.position < state.current ? accent : frame.mutedInk),
          alpha: 0.92,
        });
      }
      const node = new Graphics();
      node.circle(NODE_X, NODE_Y, NODE_RADIUS);
      node.fill({
        color: hexToNum(notch.active || notch.reached ? accent : frame.ink),
        alpha: notch.active ? 1 : notch.reached ? 0.2 : 0.08,
      });
      const nodeLabel = new Text({
        text: notch.label,
        style: style(
          notch.active
            ? readableTextColor(accent, gameTheme.canvas.shadow, gameTheme.textOnTinted)
            : foreground,
          9,
          "700",
        ),
      });
      nodeLabel.resolution = 2;
      nodeLabel.anchor.set(0.5);
      nodeLabel.position.set(NODE_X, NODE_Y);
      row.addChildAt(timeline, 1);
      row.addChild(node, nodeLabel);

      if (notch.active) {
        rowBackground.rect(0, 0, width, rowHeight);
        rowBackground.fill({ color: hexToNum(accent), alpha: 0.08 });
      }

      this.addChild(row);
      y += rowHeight;
    });

    this.contentHeight = y;
  }
}
