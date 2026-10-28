import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { RulesPreviewFrameStyle } from "./rulesPreviewFrame";
import { PixiRichText } from "./PixiRichText";
import {
  rulesEntryMatchesStackAbility,
  type StationRulesTier,
} from "./rulesCardPreviewPresentation";
import { hexToNum } from "@/pixi/colorUtils";

const TIER_INSET = 4;
const TIER_GAP = 8;
const BADGE_PADDING = 6;
const ACTIVE_TIER_ALPHA = 0.2;

export class PixiStationPreview extends Container {
  readonly contentHeight: number;
  readonly highlightedRows: Container[] = [];
  readonly highlightedRowTop: number | null;

  constructor({
    tiers,
    charge,
    width,
    fontSize,
    theme,
    frame,
    highlightedEffect,
  }: {
    tiers: StationRulesTier[];
    charge: number | null;
    width: number;
    fontSize: number;
    theme: Theme;
    frame: RulesPreviewFrameStyle;
    highlightedEffect?: string;
  }) {
    super();
    this.eventMode = "none";
    const bodyStyle = new TextStyle({
      fill: frame.ink,
      fontFamily: frame.bodyFont,
      fontSize,
      lineHeight: fontSize,
    });
    const reminderStyle = bodyStyle.clone();
    reminderStyle.fill = frame.mutedInk;
    reminderStyle.fontStyle = "italic";
    const badges = tiers.map(
      (tier) =>
        new Text({
          text: `${tier.threshold}+`,
          style: new TextStyle({
            fill:
              charge !== null && charge >= tier.threshold
                ? theme.gameTheme.textOnTinted
                : frame.ink,
            fontFamily: frame.bodyFont,
            fontSize,
            fontWeight: "700",
          }),
          resolution: 2,
        }),
    );
    const badgeWidth = Math.max(...badges.map((badge) => badge.width)) + BADGE_PADDING * 2;
    const textX = badgeWidth + TIER_GAP;
    let y = 0;
    let highlightedRowTop: number | null = null;
    for (const [index, tier] of tiers.entries()) {
      const active = charge !== null && charge >= tier.threshold;
      const highlighted =
        !!highlightedEffect &&
        (rulesEntryMatchesStackAbility(tier.canonicalText, highlightedEffect) ||
          rulesEntryMatchesStackAbility(tier.text, highlightedEffect));
      const row = new Container({ label: `station-tier-${tier.threshold}` });
      const rich = new PixiRichText();
      const textHeight = rich.setContent(
        tier.text,
        bodyStyle,
        Math.max(1, width - textX - TIER_INSET),
        fontSize,
        0,
        { parentheticalStyle: reminderStyle },
      );
      const badge = badges[index]!;
      const badgeHeight = badge.height + BADGE_PADDING * 2;
      const height = Math.max(badgeHeight, textHeight + TIER_INSET * 2);
      if (active || highlighted) {
        const tint = new Graphics().rect(0, 0, width, height).fill({
          color: hexToNum(
            highlighted ? theme.gameTheme.activeAction.active : theme.gameTheme.counter.charge,
          ),
          alpha: highlighted ? 0.28 : ACTIVE_TIER_ALPHA,
        });
        row.addChild(tint);
        this.highlightedRows.push(tint);
      }
      const plate = new Graphics()
        .roundRect(0, (height - badgeHeight) / 2, badgeWidth, badgeHeight, BADGE_PADDING)
        .fill(hexToNum(active ? theme.gameTheme.counter.charge : frame.raised))
        .stroke({ color: hexToNum(frame.border), width: 1, alpha: active ? 0.6 : 0.3 });
      badge.anchor.set(0.5);
      badge.position.set(badgeWidth / 2, height / 2);
      rich.position.set(textX, (height - textHeight) / 2);
      row.addChild(plate, badge, rich);
      row.position.set(0, y);
      this.addChild(row);
      if (highlighted) highlightedRowTop ??= y;
      y += height + TIER_GAP;
    }
    this.contentHeight = Math.max(0, y - TIER_GAP);
    this.highlightedRowTop = highlightedRowTop;
  }
}
