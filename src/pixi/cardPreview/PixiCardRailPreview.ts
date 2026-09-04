import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardRailEffect, CardRailState } from "@/components/game/cardRailState";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";

export interface PixiCardRailPreviewInteraction {
  position: number;
  shortcut: number;
  label: string;
  onActivate: () => void;
}

export interface PixiCardRailInteractionRow {
  activate: () => void;
  container: Container;
  top: number;
  height: number;
  shortcut: number;
  setFocused: (focused: boolean) => void;
}

interface PixiCardRailPreviewOptions {
  state: CardRailState;
  effects: CardRailEffect[];
  interactions: PixiCardRailPreviewInteraction[];
  width: number;
  theme: Theme;
}

const HEADER_HEIGHT = 54;
const ROW_MIN_HEIGHT = 58;
const CONTENT_LEFT = 51;
const CONTENT_RIGHT = 10;
const NODE_X = 26;
const NODE_Y = 25;
const NODE_RADIUS = 13.5;
const ORACLE_FONT = "Cormorant Garamond, Georgia, serif";

function style(
  fill: string,
  fontSize: number,
  fontWeight: "400" | "500" | "600" | "700" = "400",
  fontFamily = "Inter, system-ui, sans-serif",
): TextStyle {
  return new TextStyle({
    fill,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight: fontSize * 1.3,
  });
}

export class PixiCardRailPreview extends Container {
  readonly interactionRows: PixiCardRailInteractionRow[] = [];
  readonly contentHeight: number;

  constructor({ state, effects, interactions, width, theme }: PixiCardRailPreviewOptions) {
    super();
    const { appTheme, gameTheme } = theme;
    const accent = state.kind === "saga" ? gameTheme.counter.lore : gameTheme.counter.level;
    const foreground = appTheme["popover-foreground"];
    const muted = appTheme["muted-foreground"];
    const effectByPosition = new Map(effects.map((effect) => [effect.position, effect]));
    const interactionByPosition = new Map(
      interactions.map((interaction) => [interaction.position, interaction]),
    );
    const background = new Graphics();
    this.addChild(background);

    const header = new Container();
    const iconBackground = new Graphics();
    iconBackground.circle(14, 14, 14);
    iconBackground.fill({ color: hexToNum(appTheme.background), alpha: 0.82 });
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

    const headerDivider = new Graphics();
    headerDivider.rect(0, HEADER_HEIGHT - 1, width, 1);
    headerDivider.fill({ color: hexToNum(appTheme.border), alpha: 0.7 });
    this.addChild(headerDivider);

    let y = HEADER_HEIGHT;
    state.notches.forEach((notch, index) => {
      const effect = effectByPosition.get(notch.position);
      const interaction = interactionByPosition.get(notch.position);
      const row = new Container();
      row.position.set(0, y);
      const rowBackground = new Graphics();
      row.addChild(rowBackground);

      let metaLeft = CONTENT_LEFT;
      if (interaction) {
        const keyBackground = new Graphics();
        keyBackground.roundRect(CONTENT_LEFT, 7, 20, 20, 5);
        keyBackground.fill({ color: hexToNum(appTheme.muted), alpha: 1 });
        keyBackground.stroke({ color: hexToNum(appTheme.border), width: 1, alpha: 0.9 });
        const key = new Text({
          text: String(interaction.shortcut),
          style: style(foreground, 10, "700"),
        });
        key.resolution = 2;
        key.anchor.set(0.5);
        key.position.set(CONTENT_LEFT + 10, 17);
        row.addChild(keyBackground, key);
        metaLeft += 27;
      }

      const meta = new Text({
        text: state.kind === "saga" ? `CHAPTER ${notch.label}` : `LEVEL ${notch.label}`,
        style: style(muted, 10, "700"),
      });
      meta.resolution = 2;
      meta.position.set(metaLeft, 9);
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
          style(foreground, 13, "600", ORACLE_FONT),
          width - CONTENT_LEFT - CONTENT_RIGHT,
          14,
          2,
        );
        label.position.set(CONTENT_LEFT, contentY);
        row.addChild(label);
        contentY += labelHeight + 2;
      }

      const effectText = new PixiRichText();
      const effectHeight = effectText.setContent(
        effect?.text || "Effect text unavailable",
        style(notch.reached || interaction ? foreground : muted, 13, "600", ORACLE_FONT),
        width - CONTENT_LEFT - CONTENT_RIGHT,
        14,
        2,
      );
      effectText.position.set(CONTENT_LEFT, contentY);
      row.addChild(effectText);
      const rowHeight = Math.max(ROW_MIN_HEIGHT, contentY + effectHeight + 10);

      const timeline = new Graphics();
      if (notch.position > 1) {
        timeline.rect(NODE_X - 1, 0, 2, NODE_Y);
        timeline.fill({
          color: hexToNum(notch.reached ? accent : appTheme.border),
          alpha: 0.92,
        });
      }
      if (notch.position < state.max) {
        timeline.rect(NODE_X - 1, NODE_Y, 2, rowHeight - NODE_Y);
        timeline.fill({
          color: hexToNum(notch.position < state.current ? accent : appTheme.border),
          alpha: 0.92,
        });
      }
      const node = new Graphics();
      node.circle(NODE_X, NODE_Y, NODE_RADIUS);
      node.fill({
        color: hexToNum(notch.active ? accent : appTheme.background),
        alpha: notch.active ? 1 : 0.94,
      });
      node.stroke({
        color: hexToNum(notch.active || notch.reached || interaction ? accent : appTheme.border),
        width: notch.active ? 2 : 1,
        alpha: 1,
      });
      const nodeLabel = new Text({
        text: notch.label,
        style: style(
          notch.active ? gameTheme.textOnTinted : notch.reached ? accent : muted,
          9,
          "700",
        ),
      });
      nodeLabel.resolution = 2;
      nodeLabel.anchor.set(0.5);
      nodeLabel.position.set(NODE_X, NODE_Y);
      row.addChildAt(timeline, 1);
      row.addChild(node, nodeLabel);

      const divider = new Graphics();
      if (index < state.notches.length - 1) {
        divider.rect(0, rowHeight - 1, width, 1);
        divider.fill({ color: hexToNum(appTheme.border), alpha: 0.5 });
        row.addChild(divider);
      }

      const drawBackground = (focused: boolean) => {
        rowBackground.clear();
        rowBackground.rect(0, 0, width, rowHeight);
        if (focused || interaction || notch.active) {
          rowBackground.fill({
            color: hexToNum(accent),
            alpha: focused ? 0.22 : notch.active ? 0.15 : 0.1,
          });
        } else {
          rowBackground.fill({ color: hexToNum(appTheme.popover), alpha: 0.01 });
        }
        if (focused) {
          rowBackground.stroke({ color: hexToNum(accent), width: 1.5, alpha: 0.9 });
        }
      };
      drawBackground(false);

      if (interaction) {
        row.eventMode = "static";
        row.cursor = "pointer";
        row.hitArea = new Rectangle(0, 0, width, rowHeight);
        this.interactionRows.push({
          activate: interaction.onActivate,
          container: row,
          top: y,
          height: rowHeight,
          shortcut: interaction.shortcut,
          setFocused: drawBackground,
        });
      }

      this.addChild(row);
      y += rowHeight;
    });

    this.contentHeight = y;
    background.roundRect(0, 0, width, this.contentHeight, 9);
    background.fill({ color: hexToNum(appTheme.popover), alpha: 0.97 });
    background.stroke({ color: hexToNum(appTheme.border), width: 1, alpha: 0.8 });
  }
}
