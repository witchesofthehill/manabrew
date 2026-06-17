import { Container, Sprite, Texture, Graphics, Text, TextStyle } from "pixi.js";
import type { GameCard } from "@/types/manabrew";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { isHorizontalCard } from "@/lib/cardLayout";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import { DOOMED_FILL_ALPHA } from "./constants";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore, type BattlefieldCardStyle } from "@/stores/usePreferencesStore";
import { battlefieldKeywords } from "@/lib/battlefieldKeywords";
import { applyManaSymbol, parseManaCost } from "./manaSymbols";
import { asDeckCard } from "@/lib/decks";
import { DEBUG_KEYWORD_CARD_ID, useGameDevStore } from "@/stores/useGameDevStore";
import { applyIcon } from "./panelIcons";

/**
 * Shared, mutable theme reference used by every `CardSprite` instance.
 * `BoardScene.setTheme` calls `setCardSpriteTheme` so every sprite
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

/** Active battlefield render style, seeded from the persisted preference and
 *  kept in sync by `setCardSpriteStyle`. Every sprite reads it on load and on
 *  `restyle()`. */
let activeStyle: BattlefieldCardStyle = usePreferencesStore.getState().battlefieldCardStyle;

export function setCardSpriteStyle(style: BattlefieldCardStyle): void {
  activeStyle = style;
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

const FRAME_NAME_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 7,
    fontWeight: "600",
    fill: tintedTextFill(),
    wordWrap: true,
    wordWrapWidth: CARD_W - 6,
    lineHeight: 8,
  }),
);

const FRAME_TYPE_STYLE = registerTintedTextStyle(
  new TextStyle({
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: 5.5,
    fill: tintedTextFill(),
    wordWrap: true,
    wordWrapWidth: CARD_W - 6,
    lineHeight: 6.5,
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
const MANA_PIP_SIZE = 9;
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

const WUBRG = new Set(["W", "U", "B", "R", "G"]);

/** Primary identity color for the frame tint. First WUBRG identity color, or
 *  colorless. Multicolor cards use their first color — gradients are out of
 *  scope for the battlefield tile. */
function cardTintHex(card: GameCard): string {
  const mana = activeTheme.gameTheme.mana;
  const first = (card.colorIdentity ?? []).find((c) => WUBRG.has(c));
  return first ? mana[first as keyof typeof mana] : mana.C;
}

function frameTypeLine(card: GameCard): string {
  return [...(card.supertypes ?? []), ...(card.types ?? [])].join(" ");
}

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
  private frameContainer: Container;
  private frameMask: Graphics;
  private frameGfx: Graphics;
  private frameNameText: Text;
  private frameTypeText: Text;
  private manaContainer: Container;
  private doomedGfx: Graphics;
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
  private orderBadgeContainer: Container;
  private orderBadgeBg: Graphics;
  private orderBadgeText: Text;
  private etbGlow: Graphics;
  private hoverDebugGfx: Graphics;
  private devUnsub: (() => void) | null = null;
  private _imageLoaded = false;
  /** Custom battlefield styles (art / mini-frame) apply only to battlefield
   *  sprites. Hand cards always render the full printed image. */
  private readonly isBattlefield: boolean;
  /** View-only face override for the in-hand flip button. `null` = follow the
   *  card's real face (front, or back when transformed). */
  private previewFace: 0 | 1 | null = null;

  constructor(card: GameCard, kind: "battlefield" | "hand" = "battlefield") {
    super();
    this.card = card;
    this.isBattlefield = kind === "battlefield";
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

    // Custom-frame chrome (name/type bars + colored border) for the art /
    // mini-frame styles. Hidden in realistic mode. Masked to the rounded card
    // shape so the opaque bars don't poke past the corners.
    this.frameContainer = new Container();
    this.frameContainer.visible = false;
    this.frameMask = new Graphics();
    this.frameMask.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
    this.frameMask.fill(hexToNum(activeTheme.gameTheme.canvas.neutral));
    this.frameContainer.addChild(this.frameMask);
    this.frameContainer.mask = this.frameMask;
    this.frameGfx = new Graphics();
    this.frameContainer.addChild(this.frameGfx);
    this.frameNameText = new Text({ text: "", style: FRAME_NAME_STYLE });
    this.frameNameText.resolution = TEXT_RASTER_RESOLUTION;
    this.frameTypeText = new Text({ text: "", style: FRAME_TYPE_STYLE });
    this.frameTypeText.resolution = TEXT_RASTER_RESOLUTION;
    this.frameContainer.addChild(this.frameNameText);
    this.frameContainer.addChild(this.frameTypeText);
    this.addChild(this.frameContainer);

    this.manaContainer = new Container();
    this.addChild(this.manaContainer);

    // Red death wash; sits above the art (so it reads) but below P/T and badges.
    this.doomedGfx = new Graphics();
    this.doomedGfx.visible = false;
    this.addChild(this.doomedGfx);

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

    this.orderBadgeContainer = new Container();
    this.orderBadgeBg = new Graphics();
    this.orderBadgeText = new Text({ text: "", style: COUNTER_STYLE });
    this.orderBadgeText.resolution = TEXT_RASTER_RESOLUTION;
    this.orderBadgeContainer.addChild(this.orderBadgeBg);
    this.orderBadgeContainer.addChild(this.orderBadgeText);
    this.orderBadgeContainer.visible = false;
    this.addChild(this.orderBadgeContainer);

    this.etbGlow = new Graphics();
    this.etbGlow.visible = false;
    this.addChild(this.etbGlow);

    this.hoverDebugGfx = new Graphics();
    this.hoverDebugGfx.eventMode = "none";
    this.addChild(this.hoverDebugGfx);
    this.drawHoverDebug(useGameDevStore.getState().showHoverAreas);
    this.devUnsub = useGameDevStore.subscribe(() =>
      this.drawHoverDebug(useGameDevStore.getState().showHoverAreas),
    );

    this.hitArea = {
      contains: (x: number, y: number) => x >= 0 && x <= CARD_W && y >= 0 && y <= CARD_H,
    };

    this.pivot.set(CARD_W / 2, CARD_H / 2);
    this.loadImage();
  }

  /** Dev overlay tinting the card's hit area (the whole card rect). Hand cards
   *  are excluded — their true hover region is the axis-aligned hit zone drawn
   *  by HandController, not this rotated per-sprite rect. */
  private drawHoverDebug(on: boolean): void {
    this.hoverDebugGfx.clear();
    if (!on || !this.isBattlefield) return;
    this.hoverDebugGfx.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
    this.hoverDebugGfx.fill({ color: hexToNum(activeTheme.gameTheme.success), alpha: 0.28 });
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.devUnsub?.();
    this.devUnsub = null;
    super.destroy(options);
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
    const custom = this.isBattlefield && activeStyle !== "realistic";
    const faceIndex = this.previewFace ?? (this.card.isTransformed ? 1 : 0);
    const tex = await useScryfallStore
      .getState()
      .getCardTexture(deckCard, custom ? "art" : "full", faceIndex);
    if (this.destroyed) return;
    if (tex !== Texture.EMPTY) {
      this.imageSpr.texture = tex;
      if (custom) this.fitArtCover();
      else this.fitImageToSlot();
      this.placeholderGfx.visible = false;
      this.nameText.visible = false;
      this._imageLoaded = true;
    }
    this.renderFrame();
  }

  /** Show a specific face's image (view-only flip for hand cards). `null`
   *  restores the card's real face. Reloads the texture only when it changes. */
  setPreviewFace(face: 0 | 1 | null): void {
    if (this.previewFace === face) return;
    this.previewFace = face;
    this.loadImage();
  }

  /** Scales the art-crop texture to cover the whole card slot (crop to fill),
   *  centered. Used by the art / mini-frame styles where the printed frame is
   *  replaced by our own chrome. */
  private fitArtCover(): void {
    const tex = this.imageSpr.texture;
    if (tex.width === 0 || tex.height === 0) return;
    this.imageSpr.anchor.set(0.5, 0.5);
    this.imageSpr.rotation = 0;
    this.imageSpr.x = CARD_W / 2;
    this.imageSpr.y = CARD_H / 2;
    const ar = tex.width / tex.height;
    const cardAR = CARD_W / CARD_H;
    if (ar > cardAR) this.imageSpr.setSize(CARD_H * ar, CARD_H);
    else this.imageSpr.setSize(CARD_W, CARD_W / ar);
  }

  /** Re-applies the active battlefield style: swaps the texture variant
   *  (art-crop vs full image) and repaints the frame chrome + keyword strip. */
  restyle(): void {
    this.loadImage();
    this.updateKeywords();
    this.updateMana();
  }

  /** Mana-cost pips, top-right. Custom-style battlefield only — the realistic
   *  image already shows the printed cost. */
  private updateMana(): void {
    this.manaContainer.removeChildren().forEach((c) => c.destroy());
    if (!this.isBattlefield || activeStyle === "realistic") return;
    const codes = parseManaCost(this.card.manaCost);
    if (codes.length === 0) return;

    const size = MANA_PIP_SIZE;
    const gap = 1;
    const totalW = codes.length * size + (codes.length - 1) * gap;
    let x = CARD_W - totalW - 3;
    const y = 3;
    for (const code of codes) {
      const spr = new Sprite(Texture.EMPTY);
      applyManaSymbol(spr, code, size);
      spr.x = x;
      spr.y = y;
      this.manaContainer.addChild(spr);
      x += size + gap;
    }
  }

  /** Draws the name/type bars + colored border for the art / mini-frame
   *  styles. No-op (hidden) in realistic mode. */
  private renderFrame(): void {
    if (!this.isBattlefield || activeStyle === "realistic") {
      this.frameContainer.visible = false;
      return;
    }
    this.frameContainer.visible = true;
    const tintNum = hexToNum(cardTintHex(this.card));
    const shadowNum = hexToNum(activeTheme.gameTheme.canvas.shadow);

    this.frameGfx.clear();
    this.frameNameText.text = this.card.name;
    this.frameTypeText.text = frameTypeLine(this.card);

    if (activeStyle === "art") {
      this.frameTypeText.anchor.set(0, 1);
      this.frameTypeText.alpha = 0.78;
      this.frameTypeText.x = 3;
      this.frameTypeText.y = CARD_H - 2;
      this.frameNameText.anchor.set(0, 1);
      this.frameNameText.alpha = 1;
      this.frameNameText.x = 3;
      this.frameNameText.y = this.frameTypeText.y - this.frameTypeText.height - 1;
      const scrimTop = this.frameNameText.y - this.frameNameText.height - 3;
      this.frameGfx.rect(0, scrimTop, CARD_W, CARD_H - scrimTop);
      this.frameGfx.fill({ color: shadowNum, alpha: 0.72 });
    } else {
      this.frameNameText.anchor.set(0, 0);
      this.frameNameText.alpha = 1;
      this.frameNameText.x = 3;
      this.frameNameText.y = 2;
      const nameBandH = this.frameNameText.height + 4;
      this.frameTypeText.anchor.set(0, 1);
      this.frameTypeText.alpha = 0.85;
      this.frameTypeText.x = 3;
      this.frameTypeText.y = CARD_H - 2;
      const typeBandH = this.frameTypeText.height + 4;
      this.frameGfx.rect(0, 0, CARD_W, nameBandH);
      this.frameGfx.fill({ color: tintNum, alpha: 0.92 });
      this.frameGfx.rect(0, CARD_H - typeBandH, CARD_W, typeBandH);
      this.frameGfx.fill({ color: tintNum, alpha: 0.85 });
    }

    this.frameGfx.roundRect(0.75, 0.75, CARD_W - 1.5, CARD_H - 1.5, CARD_RADIUS);
    this.frameGfx.stroke({ color: tintNum, width: 1.5, alpha: 0.95 });
  }

  get imageLoaded(): boolean {
    return this._imageLoaded;
  }

  /**
   * Updates the card's visible content (art, P/T, badges, counters, keywords)
   * but does NOT touch `rotation` or `alpha` — the board/hand animation ticks
   * own those (the hand lerps rotation to the fan angle; the battlefield owns
   * alpha for combat dim / phased-out / exit fade). Writing them here would snap
   * them back to defaults on every state update, causing a re-lerp flicker.
   */
  updateCardContent(card: GameCard): void {
    const nameChanged =
      card.name !== this.card.name ||
      card.setCode !== this.card.setCode ||
      card.cardNumber !== this.card.cardNumber ||
      card.isFaceDown !== this.card.isFaceDown ||
      card.isTransformed !== this.card.isTransformed;
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
    this.renderFrame();
    this.updateMana();
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
    // The realistic style keeps the printed keywords in the card art, so the
    // strip is battlefield custom-style only (plus the dev-preview card).
    const custom = this.isBattlefield && activeStyle !== "realistic";
    if (!custom && this.card.id !== DEBUG_KEYWORD_CARD_ID) return;

    const { shown, hidden } = battlefieldKeywords(this.card.keywords, MAX_VISIBLE_KEYWORDS);
    if (shown.length === 0) return;

    const rowH = KEYWORD_ROW_H;
    let offsetY = Math.round(CARD_H * 0.3);
    const shadowNum = hexToNum(activeTheme.gameTheme.canvas.shadow);

    const addChip = (text: string) => {
      const chip = new Container();
      const bg = new Graphics();
      const txt = new Text({ text, style: KEYWORD_CHIP_STYLE });
      txt.resolution = TEXT_RASTER_RESOLUTION;
      txt.anchor.set(0, 0.5);
      txt.x = 3;
      txt.y = rowH / 2;

      const cw = Math.min(txt.width + 6, CARD_W - 6);
      bg.roundRect(0, 0, cw, rowH, CHIP_RADIUS);
      bg.fill({ color: shadowNum, alpha: 0.7 });

      chip.addChild(bg);
      chip.addChild(txt);
      chip.x = 3;
      chip.y = offsetY;
      this.keywordsContainer.addChild(chip);
      offsetY += rowH + 2;
    };

    shown.forEach((kw) => addChip(truncateChipLabel(kw)));
    if (hidden > 0) addChip(`+${hidden}`);
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

  /** Damage-assignment order badge (1-based). null hides it. */
  setOrderBadge(n: number | null): void {
    if (n == null) {
      this.orderBadgeContainer.visible = false;
      return;
    }
    this.orderBadgeContainer.visible = true;
    this.orderBadgeText.text = String(n);
    const d = Math.max(this.orderBadgeText.width, this.orderBadgeText.height) + 10;
    this.orderBadgeBg.clear();
    this.orderBadgeBg.circle(d / 2, d / 2, d / 2);
    this.orderBadgeBg.fill({
      color: hexToNum(activeTheme.gameTheme.promptAction.attackAction),
      alpha: 0.95,
    });
    this.orderBadgeBg.stroke({
      color: hexToNum(activeTheme.gameTheme.canvas.shadow),
      width: 1.5,
      alpha: 0.9,
    });
    this.orderBadgeText.x = (d - this.orderBadgeText.width) / 2;
    this.orderBadgeText.y = (d - this.orderBadgeText.height) / 2;
    this.orderBadgeContainer.x = (CARD_W - d) / 2;
    this.orderBadgeContainer.y = 4;
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

  setDoomed(active: boolean): void {
    if (this.doomedGfx.visible === active) return;
    this.doomedGfx.visible = active;
    this.doomedGfx.clear();
    if (!active) return;
    this.doomedGfx.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
    this.doomedGfx.fill({
      color: hexToNum(activeTheme.gameTheme.pt.lethal),
      alpha: DOOMED_FILL_ALPHA,
    });
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
