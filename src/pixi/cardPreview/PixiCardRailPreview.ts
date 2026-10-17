import { Container, Graphics, ImageSource, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardRailEffect, CardRailState } from "@/components/game/cardRailState";
import type { CardInteractionPanel } from "@/lib/cardRenderGeometry";
import type { SagaChapterDto } from "@/protocol/game";
import { cardImageLoader } from "@/lib/cardRenderArtwork";
import { RULES_PREVIEW_FONT_SIZE } from "./RulesPreviewBody";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "@/pixi/cardPreview/PixiRichText";
import { readableTextColor } from "@/themes/gameTheme";
import { RULES_BODY_FONT, type RulesPreviewFrameStyle } from "./rulesPreviewFrame";
import { rulesEntryMatchesStackAbility } from "./rulesCardPreviewPresentation";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

interface PixiCardRailPreviewOptions {
  state: CardRailState;
  effects: CardRailEffect[];
  width: number;
  theme: Theme;
  frame: RulesPreviewFrameStyle;
  highlightedEffect?: string;
  sagaRail?: CardInteractionPanel["sagaRail"];
  classLevelBand?: CardInteractionPanel["classLevelBand"];
  sagaChapters?: SagaChapterDto[];
  onChange: () => void;
}

const CLASS_TEXT_INSET = 4;
const CLASS_SECTION_GAP = 8;
const CLASS_ACTIVE_BAND_ALPHA = 0.22;
const ACTIVE_ABILITY_ALPHA = 0.2;

function style(
  fill: string,
  fontSize: number,
  fontWeight: "400" | "500" | "600" | "700" = "400",
  fontFamily = RULES_BODY_FONT,
): TextStyle {
  return new TextStyle({
    fill,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight: fontSize * 1.3,
  });
}

const progressionTextures = new Map<string, Promise<Texture>>();

function progressionTexture(url: string): Promise<Texture> {
  const cached = progressionTextures.get(url);
  if (cached) return cached;
  const loading = cardImageLoader([])([url], new AbortController().signal)
    .then((lease) => {
      const texture = new Texture({
        source: new ImageSource({ resource: lease.images.get(url)!, autoGarbageCollect: false }),
      });
      texture.once("destroy", () => {
        lease.dispose();
        progressionTextures.delete(url);
      });
      return texture;
    })
    .catch((error: unknown) => {
      progressionTextures.delete(url);
      throw error;
    });
  progressionTextures.set(url, loading);
  return loading;
}

export class PixiCardRailPreview extends Container {
  readonly contentHeight: number;
  readonly markers = new Container();
  readonly highlightedRows: Container[] = [];
  readonly highlightedRowTop: number | null;
  constructor(options: PixiCardRailPreviewOptions) {
    super();
    const result =
      options.state.kind === "saga" ? this.addSagaRows(options) : this.addClassRows(options);
    this.contentHeight = result.height;
    this.highlightedRowTop = result.highlightedRowTop;
  }

  private addClassRows({
    state,
    effects,
    width,
    theme,
    frame,
    highlightedEffect,
    classLevelBand,
    onChange,
  }: PixiCardRailPreviewOptions): { height: number; highlightedRowTop: number | null } {
    const effectByPosition = new Map(effects.map((effect) => [effect.position, effect]));
    const bodyStyle = style(frame.ink, RULES_PREVIEW_FONT_SIZE, "400", frame.bodyFont);
    bodyStyle.lineHeight = RULES_PREVIEW_FONT_SIZE;
    const reminderStyle = bodyStyle.clone();
    reminderStyle.fill = frame.mutedInk;
    reminderStyle.fontStyle = "italic";
    const headerFontSize = classLevelBand?.fontSize ?? RULES_PREVIEW_FONT_SIZE;
    let y = 0;
    let highlightedRowTop: number | null = null;
    for (const notch of state.notches) {
      const effect = effectByPosition.get(notch.position);
      const highlighted =
        !!effect &&
        !!highlightedEffect &&
        rulesEntryMatchesStackAbility(effect.text, highlightedEffect);
      const row = new Container();
      row.position.set(0, y);
      let headerHeight = 0;
      if (notch.position > 1) {
        const label = new Text({
          text: i18n._(msg`Level ${notch.label}`),
          style: style(frame.ink, headerFontSize, "400", frame.bodyFont),
          resolution: 2,
        });
        const cost = new PixiRichText();
        const costHeight = effect?.cost
          ? cost.setContent(
              `${effect.cost}:`,
              style(frame.ink, headerFontSize, "400", frame.bodyFont),
              Math.max(1, width - label.width - CLASS_TEXT_INSET * 3),
              headerFontSize,
              0,
            )
          : 0;
        headerHeight = Math.max(
          classLevelBand?.height ?? RULES_PREVIEW_FONT_SIZE * 1.5,
          label.height + CLASS_TEXT_INSET,
          costHeight + CLASS_TEXT_INSET,
        );
        const band = new Graphics()
          .rect(0, 0, width, headerHeight)
          .fill({ color: hexToNum(frame.ink), alpha: 0.08 });
        row.addChild(band);
        if (classLevelBand) {
          const plate = new Sprite(Texture.EMPTY);
          plate.setSize(width, headerHeight);
          row.addChild(plate);
          void progressionTexture(classLevelBand.assetUrl)
            .then((texture) => {
              if (this.destroyed || plate.destroyed) return;
              plate.texture = texture;
              plate.setSize(width, headerHeight);
              onChange();
            })
            .catch(() => undefined);
        }
        if (notch.active || highlighted) {
          const tint = new Graphics().rect(0, 0, width, headerHeight).fill({
            color: hexToNum(
              highlighted ? theme.gameTheme.activeAction.active : theme.gameTheme.counter.level,
            ),
            alpha: highlighted ? 0.28 : CLASS_ACTIVE_BAND_ALPHA,
          });
          row.addChild(tint);
          if (!highlighted) this.highlightedRows.push(tint);
        }
        label.anchor.set(1, 0.5);
        label.position.set(width - CLASS_TEXT_INSET, headerHeight / 2);
        cost.position.set(CLASS_TEXT_INSET, (headerHeight - costHeight) / 2);
        row.addChild(cost, label);
      }
      const rich = new PixiRichText();
      const textHeight = rich.setContent(
        effect?.text || i18n._(msg`Effect text unavailable`),
        bodyStyle,
        Math.max(1, width - CLASS_TEXT_INSET * 2),
        RULES_PREVIEW_FONT_SIZE,
        0,
        { parentheticalStyle: reminderStyle },
      );
      rich.position.set(CLASS_TEXT_INSET, headerHeight + CLASS_SECTION_GAP);
      row.addChild(rich);
      const rowHeight = headerHeight + CLASS_SECTION_GAP + textHeight + CLASS_SECTION_GAP;
      if (notch.active || highlighted) {
        const tint = new Graphics().rect(0, 0, width, rowHeight).fill({
          color: hexToNum(
            highlighted ? theme.gameTheme.activeAction.active : theme.gameTheme.counter.level,
          ),
          alpha: highlighted ? 0.28 : ACTIVE_ABILITY_ALPHA,
        });
        row.addChildAt(tint, 0);
        if (!highlighted) this.highlightedRows.push(tint);
      }
      if (highlighted) {
        this.highlightedRows.push(row);
        highlightedRowTop ??= y;
      }
      this.addChild(row);
      y += rowHeight;
    }
    return { height: y, highlightedRowTop };
  }

  private addSagaRows({
    state,
    effects,
    width,
    theme,
    frame,
    highlightedEffect,
    sagaRail,
    sagaChapters,
    onChange,
  }: PixiCardRailPreviewOptions): { height: number; highlightedRowTop: number | null } {
    const effectByPosition = new Map(effects.map((effect) => [effect.position, effect]));
    const groups = sagaChapters?.length
      ? sagaChapters.map((chapter) => ({ positions: chapter.chapters, text: chapter.oracle }))
      : state.notches.map((notch) => ({
          positions: [notch.position],
          text: effectByPosition.get(notch.position)?.text ?? "",
        }));
    const groupedPositions = new Set(groups.flatMap((group) => group.positions));
    for (const notch of state.notches) {
      if (!groupedPositions.has(notch.position)) {
        groups.push({
          positions: [notch.position],
          text: effectByPosition.get(notch.position)?.text ?? "",
        });
      }
    }
    const textX = sagaRail?.text.x ?? 0;
    const textWidth = sagaRail?.text.width ?? width;
    const accent = theme.gameTheme.counter.lore;
    let y = 0;
    let highlightedRowTop: number | null = null;
    for (const { positions, text } of groups) {
      const notches = state.notches.filter((notch) => positions.includes(notch.position));
      if (notches.length === 0) continue;
      const row = new Container();
      const rich = new PixiRichText();
      const bodyStyle = style(frame.ink, RULES_PREVIEW_FONT_SIZE, "400", frame.bodyFont);
      bodyStyle.lineHeight = RULES_PREVIEW_FONT_SIZE;
      const reminderStyle = bodyStyle.clone();
      reminderStyle.fill = frame.mutedInk;
      reminderStyle.fontStyle = "italic";
      const effectText = text || i18n._(msg`Effect text unavailable`);
      const textHeight = rich.setContent(
        sagaRail ? effectText : `${notches.map((notch) => notch.label).join(", ")} — ${effectText}`,
        bodyStyle,
        textWidth,
        RULES_PREVIEW_FONT_SIZE,
        0,
        { parentheticalStyle: reminderStyle },
      );
      const marker = sagaRail?.marker;
      const rowHeight = Math.max(
        textHeight,
        marker ? marker.minimumRowHeight + (notches.length - 1) * marker.gap : 0,
      );
      const active = notches.some((notch) => notch.active);
      const highlighted =
        !!text && !!highlightedEffect && rulesEntryMatchesStackAbility(text, highlightedEffect);
      row.position.set(textX, y);
      if (active || highlighted) {
        const tint = new Graphics().rect(0, 0, textWidth, rowHeight).fill({
          color: hexToNum(highlighted ? theme.gameTheme.activeAction.active : accent),
          alpha: highlighted ? 0.28 : ACTIVE_ABILITY_ALPHA,
        });
        row.addChild(tint);
        if (!highlighted) this.highlightedRows.push(tint);
      }
      rich.position.set(0, (rowHeight - textHeight) / 2);
      row.addChild(rich);
      this.addChild(row);
      if (highlighted) {
        this.highlightedRows.push(row);
        highlightedRowTop ??= y;
      }
      if (marker) {
        notches.forEach((notch, index) => {
          const centerY = y + rowHeight / 2 + (index - (notches.length - 1) / 2) * marker.gap;
          const badge = new Sprite(Texture.EMPTY);
          badge.position.set(marker.x, centerY - marker.height / 2);
          badge.setSize(marker.width, marker.height);
          badge.tint = hexToNum(notch.active || notch.reached ? accent : frame.paper);
          void progressionTexture(marker.assetUrl)
            .then((texture) => {
              if (this.destroyed || badge.destroyed) return;
              badge.texture = texture;
              badge.setSize(marker.width, marker.height);
              onChange();
            })
            .catch(() => undefined);
          const numeral = new Text({
            text: notch.label,
            style: style(
              notch.active || notch.reached
                ? readableTextColor(
                    accent,
                    theme.gameTheme.canvas.shadow,
                    theme.gameTheme.textOnTinted,
                  )
                : frame.ink,
              marker.fontSize,
              "600",
              marker.fontFamily,
            ),
          });
          numeral.resolution = 2;
          numeral.anchor.set(0.5);
          numeral.position.set(marker.centerX, centerY + marker.numeralOffsetY);
          const markerRow = new Container();
          markerRow.addChild(badge, numeral);
          if (notch.reached && !notch.active) markerRow.alpha = 0.65;
          this.markers.addChild(markerRow);
          if (highlighted) this.highlightedRows.push(markerRow);
        });
      }
      y += rowHeight + 8;
    }
    return { height: Math.max(0, y - 8), highlightedRowTop };
  }
}
