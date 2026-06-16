import { Container, Sprite, Texture, Graphics, Text, TextStyle } from "pixi.js";
import type { GameCard } from "@/types/manabrew";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { isHorizontalCard } from "@/lib/cardLayout";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { asDeckCard } from "@/lib/decks";
import { DEBUG_KEYWORD_CARD_ID } from "@/stores/useGameDevStore";
import { applyIcon } from "./panelIcons";

/**
 * Shared, mutable theme reference used by every `CardSprite` instance.
 * `PixiGameScene.setTheme` calls `setCardSpriteTheme` so every sprite
 * repaints against the active preset without needing to thread the
 * theme through the Container constructor.
 */
// Seeded from the active preset so every sprite can draw correctly from
// construction time; `setCardSpriteTheme` then keeps it in sync with live
// preset / overrides changes.
let activeTheme: Theme = getTheme();

/** TextStyle instances whose `fill` tracks the theme's `textOnTinted` colour.
 *  Each call to `setCardSpriteTheme` updates them in place so already-rendered
 *  Text objects repaint without needing to be replaced. */
const TINTED_TEXT_STYLES: TextStyle[] = [];

export function setCardSpriteTheme(theme: Theme): void {
  activeTheme = theme;
  for (const style of TINTED_TEXT_STYLES) {
    style.fill = theme.gameTheme.textOnTinted;
  }
}

function registerTintedTextStyle(style: TextStyle): TextStyle {
  TINTED_TEXT_STYLES.push(style);
  return style;
}

// Hand cards render at up to ~3.25× base scale (medium hover) and ~4.3× (large
// hover). Rasterize text textures high enough that they remain sharp across
// that range on top of the 3× canvas backing.
const TEXT_RASTER_RESOLUTION = 5;

// `tintedTextFill` is recomputed whenever the active theme changes; each
// registered TextStyle has its `fill` rewritten in place so already-
// rendered Text objects re-tint without being replaced.
const tintedTextFill = (): string => activeTheme.gameTheme.textOnTinted;

const PT_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 10,
    fontWeight: "bold",
    fill: tintedTextFill(),
  }),
);

const BADGE_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 6,
    fontWeight: "bold",
    fill: tintedTextFill(),
  }),
);

const COUNTER_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 8,
    fontWeight: "bold",
    fill: tintedTextFill(),
  }),
);

const DAMAGE_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 9,
    fontWeight: "bold",
    fill: tintedTextFill(),
  }),
);

const NAME_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 8,
    fill: tintedTextFill(),
    wordWrap: true,
    wordWrapWidth: CARD_W - 8,
    align: "center",
  }),
);

const FOIL_STAR_STYLE = new TextStyle({
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontSize: 10,
  fontWeight: "bold",
  fill: 0xffe27a,
});

/** Iridescent gold used for the foil ring + sparkle icon. Hard-coded
 *  rather than themed because foil treatment reads "metallic gold"
 *  across every preset; the surrounding card art carries the theme. */
const FOIL_RING_COLOR = 0xffd87a;

// ── Geometry ─────────────────────────────────────────────────────
const CARD_RADIUS = 6;
const RING_RADIUS = 8;
const RING_INSET = 2;
const CHIP_RADIUS = 3;
const COUNTER_HEIGHT = 16;
const COUNTER_RADIUS = 8;
const KEYWORD_ROW_H = 12;
const MAX_VISIBLE_KEYWORDS = 4;
const KEYWORD_LABEL_MAX_LEN = 14;

function truncateChipLabel(text: string): string {
  if (text.length <= KEYWORD_LABEL_MAX_LEN) return text;
  return `${text.slice(0, KEYWORD_LABEL_MAX_LEN - 1)}…`;
}

const KEYWORD_CHIP_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 7,
    fontWeight: "bold",
    fill: tintedTextFill(),
  }),
);
// Fraction of the card height occupied by the title line (card name +
// mana cost). Badges sit just below this band so the mana cost stays
// unobstructed regardless of hover scale.
const BADGE_TITLE_BAND_FRAC = 0.1;

const ON_FIELD_COUNTER_TYPES = new Set(["Loyalty", "Charge"]);

type CardStatusKey = keyof Theme["gameTheme"]["cardStatus"];

interface BadgeRule {
  label: string;
  test: (card: GameCard) => boolean;
  colorKey: CardStatusKey;
}

const BADGE_RULES: BadgeRule[] = [
  { label: "MORPH", test: (c) => !!c.isFaceDown, colorKey: "morph" },
  { label: "EXERTED", test: (c) => !!c.exerted, colorKey: "exerted" },
  { label: "BESTOW", test: (c) => !!c.isBestowed, colorKey: "bestow" },
  { label: "TRANSFORMED", test: (c) => !!c.isTransformed, colorKey: "transformed" },
  { label: "PLOTTED", test: (c) => !!c.isPlotted, colorKey: "plotted" },
  { label: "MADNESS", test: (c) => !!c.isMadnessExiled, colorKey: "madness" },
  { label: "WARPED", test: (c) => !!c.isWarpExiled, colorKey: "warped" },
  { label: "COPY", test: (c) => !!c.isCopy, colorKey: "copy" },
  { label: "TOKEN", test: (c) => !!c.isToken, colorKey: "token" },
];

function badgeColor(key: CardStatusKey): number {
  return hexToNum(activeTheme.gameTheme.cardStatus[key]);
}

/** Static mapping from counter-type string (as it appears on the card
 *  state) to the `Theme.gameTheme.counter` key. Any type not listed here
 *  falls through to `counter.default`. */
const COUNTER_TYPE_KEYS: Record<string, keyof Theme["gameTheme"]["counter"]> = {
  P1P1: "p1p1",
  M1M1: "m1m1",
  Loyalty: "loyalty",
  Charge: "charge",
  Quest: "quest",
  Study: "study",
  Lore: "lore",
  Age: "age",
  Time: "time",
  Fade: "fade",
  Level: "level",
  Storage: "storage",
  Mining: "mining",
  Brick: "brick",
  Depletion: "depletion",
  Page: "page",
};

function getCounterColor(type: string): number {
  const palette = activeTheme.gameTheme.counter;
  const key = COUNTER_TYPE_KEYS[type];
  return hexToNum(key ? palette[key] : palette.default);
}

const COUNTER_TEXT_LABELS: Record<string, string> = {
  P1P1: "+1/+1",
  M1M1: "−1/−1",
};

const COUNTER_ICON_NAMES: Record<string, string> = {
  Loyalty: "vibrating-shield",
  Charge: "lightning-trio",
  Quest: "scroll-quill",
  Study: "book-aura",
  Lore: "spell-book",
  Age: "hourglass",
  Time: "stopwatch",
  Fade: "ghost",
  Level: "rank-3",
  Storage: "stack",
  Mining: "mining",
  Brick: "brick-wall",
  Depletion: "battery-pack-alt",
  Page: "scroll-unfurled",
};

const parseStat = (value: string | undefined): number => {
  if (!value) return 0;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
};

const resolvePTBgColor = (card: GameCard): number => {
  const pt = activeTheme.gameTheme.pt;
  const toughness = parseStat(card.toughness);
  if (card.damage != null && card.damage >= toughness) return hexToNum(pt.lethal);
  if (card.basePower == null) return hexToNum(pt.neutral);

  const curP = parseStat(card.power);
  const curT = toughness;
  const buffed = curP > card.basePower || curT > (card.baseToughness ?? 0);
  const debuffed = curP < card.basePower || curT < (card.baseToughness ?? 0);
  if (buffed) return hexToNum(pt.buffed);
  if (debuffed) return hexToNum(pt.debuffed);
  return hexToNum(pt.neutral);
};

export class CardSprite extends Container {
  card: GameCard;

  private imageSpr: Sprite;
  private imageMask: Graphics;
  private ringGfx: Graphics;
  private ptContainer: Container;
  private ptBg: Graphics;
  private ptText: Text;
  private damageContainer: Container;
  private damageBg: Graphics;
  private damageText: Text;
  private badgeContainer: Container;
  private badgeBg: Graphics;
  private badgeText: Text;
  private counterContainer: Container;
  private keywordsContainer: Container;
  private placeholderGfx: Graphics;
  private nameText: Text;
  private foilRing: Graphics;
  private foilStar: Text;
  private ringBearerGfx: Graphics;
  private ringBearerIcon: Sprite;
  private stackCountContainer: Container;
  private stackCountBg: Graphics;
  private stackCountText: Text;
  private etbGlow: Graphics;
  private _imageLoaded = false;

  constructor(card: GameCard) {
    super();
    this.card = card;
    this.eventMode = "static";
    this.cursor = "pointer";

    this.ringGfx = new Graphics();
    this.addChild(this.ringGfx);

    this.placeholderGfx = new Graphics();
    this.placeholderGfx.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
    this.placeholderGfx.fill({
      color: hexToNum(activeTheme.gameTheme.cardPlaceholder.fill),
      alpha: 0.8,
    });
    this.placeholderGfx.stroke({
      color: hexToNum(activeTheme.gameTheme.cardPlaceholder.stroke),
      width: 1,
    });
    this.addChild(this.placeholderGfx);

    this.nameText = new Text({ text: card.name, style: NAME_STYLE });
    this.nameText.resolution = TEXT_RASTER_RESOLUTION;
    this.nameText.anchor.set(0.5);
    this.nameText.x = CARD_W / 2;
    this.nameText.y = CARD_H / 2;
    this.addChild(this.nameText);

    this.imageMask = new Graphics();
    this.imageMask.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
    this.imageMask.fill(hexToNum(activeTheme.gameTheme.canvas.neutral));
    this.addChild(this.imageMask);

    this.imageSpr = new Sprite(Texture.EMPTY);
    this.imageSpr.setSize(CARD_W, CARD_H);
    this.imageSpr.mask = this.imageMask;
    this.addChild(this.imageSpr);
    this.fitImageToSlot();

    this.badgeContainer = new Container();
    this.badgeBg = new Graphics();
    this.badgeText = new Text({ text: "", style: BADGE_STYLE });
    this.badgeText.resolution = TEXT_RASTER_RESOLUTION;
    this.badgeContainer.addChild(this.badgeBg);
    this.badgeContainer.addChild(this.badgeText);
    this.badgeContainer.visible = false;
    this.addChild(this.badgeContainer);

    this.counterContainer = new Container();
    this.addChild(this.counterContainer);

    this.keywordsContainer = new Container();
    this.addChild(this.keywordsContainer);

    this.ptContainer = new Container();
    this.ptBg = new Graphics();
    this.ptText = new Text({ text: "", style: PT_STYLE });
    this.ptText.resolution = TEXT_RASTER_RESOLUTION;
    this.ptContainer.addChild(this.ptBg);
    this.ptContainer.addChild(this.ptText);
    this.ptContainer.visible = false;
    this.addChild(this.ptContainer);

    this.damageContainer = new Container();
    this.damageBg = new Graphics();
    this.damageText = new Text({ text: "", style: DAMAGE_STYLE });
    this.damageText.resolution = TEXT_RASTER_RESOLUTION;
    this.damageContainer.addChild(this.damageBg);
    this.damageContainer.addChild(this.damageText);
    this.damageContainer.visible = false;
    this.addChild(this.damageContainer);

    this.foilRing = new Graphics();
    this.foilRing.visible = false;
    this.addChild(this.foilRing);

    this.foilStar = new Text({ text: "✦", style: FOIL_STAR_STYLE });
    this.foilStar.resolution = TEXT_RASTER_RESOLUTION;
    this.foilStar.anchor.set(1, 0);
    this.foilStar.x = CARD_W - 3;
    this.foilStar.y = 2;
    this.foilStar.visible = false;
    this.addChild(this.foilStar);

    this.ringBearerGfx = new Graphics();
    this.ringBearerGfx.visible = false;
    this.addChild(this.ringBearerGfx);

    this.ringBearerIcon = new Sprite(Texture.EMPTY);
    this.ringBearerIcon.anchor.set(0.5, 0.5);
    this.ringBearerIcon.visible = false;
    this.addChild(this.ringBearerIcon);

    this.stackCountContainer = new Container();
    this.stackCountBg = new Graphics();
    this.stackCountText = new Text({ text: "", style: COUNTER_STYLE });
    this.stackCountText.resolution = TEXT_RASTER_RESOLUTION;
    this.stackCountContainer.addChild(this.stackCountBg);
    this.stackCountContainer.addChild(this.stackCountText);
    this.stackCountContainer.visible = false;
    this.addChild(this.stackCountContainer);

    this.etbGlow = new Graphics();
    this.etbGlow.visible = false;
    this.addChild(this.etbGlow);

    this.hitArea = {
      contains: (x: number, y: number) => x >= 0 && x <= CARD_W && y >= 0 && y <= CARD_H,
    };

    this.pivot.set(CARD_W / 2, CARD_H / 2);
    this.loadImage();
  }

  // Scryfall serves horizontal-frame cards as upright 5:7 PNGs — rotate
  // the sprite 90° so the printed art reads in landscape inside the slot.
  private isHorizontal(): boolean {
    const key = `name:${this.card.name.toLowerCase()}`;
    const sf = useScryfallStore.getState().cards[key]?.card?.info;
    return isHorizontalCard({
      layout: this.card.layout ?? sf?.layout,
      types: this.card.types,
      typeLine: sf?.type_line,
    });
  }

  private fitImageToSlot(): void {
    if (this.isHorizontal()) {
      this.imageSpr.anchor.set(0.5, 0.5);
      this.imageSpr.x = CARD_W / 2;
      this.imageSpr.y = CARD_H / 2;
      this.imageSpr.rotation = -Math.PI / 2;
      const preHeight = CARD_W;
      const preWidth = Math.round((preHeight * 5) / 7);
      this.imageSpr.setSize(preWidth, preHeight);
    } else {
      this.imageSpr.anchor.set(0, 0);
      this.imageSpr.rotation = 0;
      this.imageSpr.x = 0;
      this.imageSpr.y = 0;
      this.imageSpr.setSize(CARD_W, CARD_H);
    }
  }

  private async loadImage(): Promise<void> {
    const deck = useGameStore.getState().gameDecks[this.card.ownerId];
    const deckCard = asDeckCard(deck, this.card);
    const tex = await useScryfallStore.getState().getCardTexture(deckCard);
    if (this.destroyed) return;
    if (tex !== Texture.EMPTY) {
      this.imageSpr.texture = tex;
      this.fitImageToSlot();
      this.placeholderGfx.visible = false;
      this.nameText.visible = false;
      this._imageLoaded = true;
    }
  }

  get imageLoaded(): boolean {
    return this._imageLoaded;
  }

  /**
   * Full update including tapped rotation + phased-out alpha. Use this on the
   * battlefield, where `tapped` is what drives the 90° rotation.
   */
  updateCard(card: GameCard): void {
    this.updateCardContent(card);
    this.alpha = card.phasedOut ? 0.3 : 1;
  }

  /**
   * Updates the card's visible content (art, P/T, badges, counters, keywords)
   * but does NOT touch `rotation` or `alpha`. Use this when an external
   * animation owns those properties — e.g. the hand layout lerps rotation
   * to the arc-fan angle and sets alpha based on dragging/casting state.
   * Calling the full `updateCard` there would reset the rotation to 0 on
   * every state update, causing a bumpy re-lerp back to the fan angle.
   */
  updateCardContent(card: GameCard): void {
    const nameChanged =
      card.name !== this.card.name ||
      card.setCode !== this.card.setCode ||
      card.cardNumber !== this.card.cardNumber ||
      card.isFaceDown !== this.card.isFaceDown;
    this.card = card;

    if (nameChanged) {
      this._imageLoaded = false;
      this.placeholderGfx.visible = true;
      this.nameText.visible = true;
      this.nameText.text = card.name;
      this.loadImage();
    }

    this.updatePT();
    this.updateDamage();
    this.updateBadge();
    this.updateCounters();
    this.updateKeywords();
    this.updateFoil();
    this.updateRingBearer();
  }

  private updateRingBearer(): void {
    const isBearer = !!this.card.isRingBearer;
    this.ringBearerGfx.visible = isBearer;
    this.ringBearerIcon.visible = isBearer;
    if (!isBearer) {
      this.ringBearerGfx.clear();
      return;
    }
    const ringHex = activeTheme.gameTheme.badges.ring;
    const fgHex = activeTheme.gameTheme.textOnTinted;
    const discRadius = 13;
    const cx = discRadius + 2;
    const cy = discRadius + 2;
    this.ringBearerGfx.clear();
    this.ringBearerGfx.circle(cx, cy, discRadius);
    this.ringBearerGfx.fill({ color: hexToNum(ringHex), alpha: 0.95 });
    this.ringBearerGfx.circle(cx, cy, discRadius);
    this.ringBearerGfx.stroke({ color: hexToNum(fgHex), width: 1.5, alpha: 0.6 });
    const iconSize = 20;
    this.ringBearerIcon.x = cx;
    this.ringBearerIcon.y = cy;
    this.ringBearerIcon.width = iconSize;
    this.ringBearerIcon.height = iconSize;
    applyIcon(this.ringBearerIcon, "ring", fgHex, 64, iconSize, iconSize);
  }

  private updateKeywords(): void {
    this.keywordsContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (this.card.id !== DEBUG_KEYWORD_CARD_ID) return;
    const keywords = this.card.keywords;
    if (!keywords || keywords.length === 0) return;

    const visible = keywords.slice(0, MAX_VISIBLE_KEYWORDS);
    const hiddenCount = keywords.length - visible.length;

    let offsetX = 3;
    let offsetY = Math.round(CARD_H * BADGE_TITLE_BAND_FRAC);
    const rowH = KEYWORD_ROW_H;

    const addChip = (text: string) => {
      const chip = new Container();
      const bg = new Graphics();
      const truncated = truncateChipLabel(text);
      const txt = new Text({ text: truncated, style: KEYWORD_CHIP_STYLE });
      txt.resolution = TEXT_RASTER_RESOLUTION;
      txt.anchor.set(0, 0.5);
      txt.x = 3;
      txt.y = rowH / 2;

      const maxChipW = CARD_W - 6;
      const cw = Math.min(txt.width + 6, maxChipW);
      if (offsetX + cw > CARD_W - 6) {
        offsetX = 3;
        offsetY += rowH + 2;
      }

      bg.roundRect(0, 0, cw, rowH, CHIP_RADIUS);
      bg.fill({ color: hexToNum(activeTheme.gameTheme.canvas.shadow), alpha: 0.6 });

      chip.addChild(bg);
      chip.addChild(txt);
      chip.x = offsetX;
      chip.y = offsetY;
      this.keywordsContainer.addChild(chip);
      offsetX += cw + 2;
    };

    visible.forEach((kw) => addChip(kw.split(":")[0]!));
    if (hiddenCount > 0) addChip(`+${hiddenCount}`);
  }

  setEntryGlowAlpha(alpha: number): void {
    if (alpha <= 0) {
      if (this.etbGlow.visible) {
        this.etbGlow.visible = false;
        this.etbGlow.clear();
      }
      return;
    }
    this.etbGlow.visible = true;
    this.etbGlow.clear();
    this.etbGlow.roundRect(-2, -2, CARD_W + 4, CARD_H + 4, CARD_RADIUS + 2);
    this.etbGlow.stroke({
      color: hexToNum(activeTheme.gameTheme.cardRing),
      width: 3,
      alpha,
    });
  }

  setStackCount(count: number): void {
    if (count <= 1) {
      this.stackCountContainer.visible = false;
      return;
    }
    this.stackCountContainer.visible = true;
    this.stackCountText.text = `×${count}`;
    const tw = this.stackCountText.width + 6;
    const th = this.stackCountText.height + 3;
    this.stackCountBg.clear();
    this.stackCountBg.roundRect(0, 0, tw, th, CHIP_RADIUS);
    this.stackCountBg.fill({
      color: hexToNum(activeTheme.gameTheme.canvas.shadow),
      alpha: 0.85,
    });
    this.stackCountText.x = 3;
    this.stackCountText.y = 1;
    this.stackCountContainer.x = 3;
    this.stackCountContainer.y = 2;
  }

  private updateFoil(): void {
    const isFoil = !!this.card.foil;
    this.foilStar.visible = isFoil;
    this.foilRing.clear();
    if (!isFoil) {
      this.foilRing.visible = false;
      return;
    }
    this.foilRing.visible = true;
    this.foilRing.roundRect(1, 1, CARD_W - 2, CARD_H - 2, CARD_RADIUS - 1);
    this.foilRing.stroke({ color: FOIL_RING_COLOR, width: 1.5, alpha: 0.85 });
  }

  private updatePT(): void {
    const card = this.card;
    const isCreature = card.types?.some((t) => t.toLowerCase() === "creature");
    if (!isCreature || !card.power || !card.toughness) {
      this.ptContainer.visible = false;
      return;
    }

    this.ptContainer.visible = true;
    this.ptText.text = `${card.power}/${card.toughness}`;
    const bgColor = resolvePTBgColor(card);

    const tw = this.ptText.width + 6;
    const th = this.ptText.height + 4;
    this.ptBg.clear();
    this.ptBg.roundRect(0, 0, tw, th, CHIP_RADIUS);
    this.ptBg.fill({ color: bgColor, alpha: 0.85 });

    this.ptText.x = 3;
    this.ptText.y = 2;
    this.ptContainer.x = CARD_W - tw - 3;
    this.ptContainer.y = CARD_H - th - 3;
  }

  private updateBadge(): void {
    const rule = BADGE_RULES.find((r) => r.test(this.card));
    if (!rule) {
      this.badgeContainer.visible = false;
      return;
    }

    this.badgeContainer.visible = true;
    this.badgeText.text = rule.label;

    const bw = this.badgeText.width + 5;
    const bh = this.badgeText.height + 2;
    this.badgeBg.clear();
    this.badgeBg.roundRect(0, 0, bw, bh, CHIP_RADIUS);
    this.badgeBg.fill({ color: badgeColor(rule.colorKey), alpha: 0.9 });

    this.badgeText.x = 2.5;
    this.badgeText.y = 1;
    // Sit the badge just below the MTG title line instead of on top of it.
    // A top-centered badge would otherwise cover the mana cost pip cluster
    // (top-right of the card frame) when the hand hover scales the card up,
    // and the mana cost is the piece of information the player most needs
    // to read at a glance.
    const titleBandY = Math.round(CARD_H * BADGE_TITLE_BAND_FRAC);
    this.badgeContainer.x = (CARD_W - bw) / 2;
    this.badgeContainer.y = titleBandY;
  }

  private updateCounters(): void {
    this.counterContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const counters = this.card.counters;
    if (!counters) return;

    const entries = Object.entries(counters).filter(
      ([type, n]) => n > 0 && ON_FIELD_COUNTER_TYPES.has(type),
    );
    const hiddenTypeCount = Object.entries(counters).filter(
      ([type, n]) => n > 0 && !ON_FIELD_COUNTER_TYPES.has(type),
    ).length;
    if (entries.length === 0 && hiddenTypeCount === 0) return;

    const iconSize = COUNTER_HEIGHT - 4;
    const fgHex = activeTheme.gameTheme.textOnTinted;

    let offsetX = 3;
    for (const [type, count] of entries) {
      const color = getCounterColor(type);
      const iconName = COUNTER_ICON_NAMES[type];
      const textLabel = COUNTER_TEXT_LABELS[type] ?? type.slice(0, 3);

      const badge = new Container();
      const bg = new Graphics();

      let contentWidth = 0;
      let glyph: Sprite | Text;
      if (iconName) {
        const sprite = new Sprite(Texture.EMPTY);
        applyIcon(sprite, iconName, fgHex, 64, iconSize, iconSize);
        sprite.x = 4;
        sprite.y = (COUNTER_HEIGHT - iconSize) / 2;
        glyph = sprite;
        contentWidth = iconSize;
      } else {
        glyph = new Text({ text: textLabel, style: COUNTER_STYLE });
        glyph.resolution = TEXT_RASTER_RESOLUTION;
        glyph.anchor.set(0, 0.5);
        glyph.x = 4;
        glyph.y = COUNTER_HEIGHT / 2;
        contentWidth = glyph.width;
      }

      let countText: Text | null = null;
      let countWidth = 0;
      if (count > 1) {
        countText = new Text({ text: ` ${count}`, style: COUNTER_STYLE });
        countText.resolution = TEXT_RASTER_RESOLUTION;
        countText.anchor.set(0, 0.5);
        countText.x = 4 + contentWidth;
        countText.y = COUNTER_HEIGHT / 2;
        countWidth = countText.width;
      }

      const bw = 4 + contentWidth + countWidth + 4;
      bg.roundRect(0, 0, bw, COUNTER_HEIGHT, COUNTER_RADIUS);
      bg.fill({ color, alpha: 0.9 });
      bg.stroke({ color: hexToNum(activeTheme.gameTheme.canvas.shadow), width: 1, alpha: 0.2 });

      badge.addChild(bg);
      badge.addChild(glyph);
      if (countText) badge.addChild(countText);
      badge.x = offsetX;
      badge.y = CARD_H - COUNTER_HEIGHT - 3;
      this.counterContainer.addChild(badge);
      offsetX += bw + 2;
    }

    if (hiddenTypeCount > 0) {
      const badge = new Container();
      const bg = new Graphics();
      const label = new Text({ text: `+${hiddenTypeCount}`, style: COUNTER_STYLE });
      label.resolution = TEXT_RASTER_RESOLUTION;
      label.anchor.set(0, 0.5);
      label.x = 4;
      label.y = COUNTER_HEIGHT / 2;
      const bw = 4 + label.width + 4;
      bg.roundRect(0, 0, bw, COUNTER_HEIGHT, COUNTER_RADIUS);
      bg.fill({ color: hexToNum(activeTheme.gameTheme.counter.default), alpha: 0.9 });
      bg.stroke({ color: hexToNum(activeTheme.gameTheme.canvas.shadow), width: 1, alpha: 0.2 });
      badge.addChild(bg);
      badge.addChild(label);
      badge.x = offsetX;
      badge.y = CARD_H - COUNTER_HEIGHT - 3;
      this.counterContainer.addChild(badge);
    }
  }

  private updateDamage(): void {
    const card = this.card;
    const dmg = card.damage ?? 0;
    if (dmg <= 0) {
      this.damageContainer.visible = false;
      return;
    }
    this.damageContainer.visible = true;
    this.damageText.text = `⚔${dmg}`;

    const tw = this.damageText.width + 6;
    const th = this.damageText.height + 3;
    this.damageBg.clear();
    this.damageBg.roundRect(0, 0, tw, th, CHIP_RADIUS);
    this.damageBg.fill({
      color: hexToNum(activeTheme.gameTheme.promptAction.attackAction),
      alpha: 0.92,
    });

    this.damageText.x = 3;
    this.damageText.y = 1.5;
    const ptH = this.ptText.height + 4;
    this.damageContainer.x = CARD_W - tw - 3;
    this.damageContainer.y = CARD_H - ptH - th - 5;
  }

  setRing(color: number | null, alpha = 1): void {
    this.ringGfx.clear();
    if (color == null) return;
    this.drawRingStroke(color, alpha);
  }

  setHighlight(
    active: boolean,
    color = hexToNum(activeTheme.gameTheme.cardRing),
    alpha = 0.3,
  ): void {
    this.ringGfx.clear();
    if (!active) return;
    this.drawRingStroke(color, 1);
    this.ringGfx.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
    this.ringGfx.fill({ color, alpha });
  }

  private drawRingStroke(color: number, alpha: number): void {
    this.ringGfx.roundRect(
      -RING_INSET,
      -RING_INSET,
      CARD_W + RING_INSET * 2,
      CARD_H + RING_INSET * 2,
      RING_RADIUS,
    );
    this.ringGfx.stroke({ color, width: 2, alpha });
  }
}
