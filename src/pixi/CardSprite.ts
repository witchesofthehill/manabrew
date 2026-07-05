import {
  Container,
  Sprite,
  Texture,
  Graphics,
  Text,
  TextStyle,
  FillGradient,
  ColorMatrixFilter,
  type DestroyOptions,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { isHorizontalGameCard } from "@/lib/horizontalGameCard";
import type { Theme } from "@/hooks/useTheme";
import {
  FRAME_TINT_COLORLESS_MAX_LUMINANCE,
  frameTint,
  readableTextColor,
  withAlpha,
} from "@/themes/gameTheme";
import { getTheme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import { DOOMED_FILL_ALPHA } from "./constants";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore, type BattlefieldCardStyle } from "@/stores/usePreferencesStore";
import { battlefieldKeywords } from "@/lib/battlefieldKeywords";
import { applyManaSymbol, parseManaCost } from "./manaSymbols";
import { asDeckCard } from "@/lib/decks";
import { DEBUG_KEYWORD_CARD_ID } from "@/stores/useGameDevStore";
import { applyIcon } from "./panelIcons";
import { type OneShot, oneShot, oneShotProgress, pulse } from "./effects/animation";
import { gsap } from "./effects/gsap";
import { bump } from "./effects/easing";
import { animationsEnabled } from "./effects/enabled";
import { DAMAGE_HIT, EDGE_GLOW, STAT_POP, SUMMONING_FILTER } from "./effects/config";

let activeTheme: Theme = getTheme();

const TINTED_TEXT_STYLES: TextStyle[] = [];

export function setCardSpriteTheme(theme: Theme): void {
  activeTheme = theme;
  for (const style of TINTED_TEXT_STYLES) {
    style.fill = theme.gameTheme.textOnTinted;
  }
}

let activeStyle: BattlefieldCardStyle = usePreferencesStore.getState().battlefieldCardStyle;

export function setCardSpriteStyle(style: BattlefieldCardStyle): void {
  activeStyle = style;
}

let activeHoverDebug = false;

export function setCardSpriteHoverDebug(on: boolean): void {
  activeHoverDebug = on;
}

function registerTintedTextStyle(style: TextStyle): TextStyle {
  TINTED_TEXT_STYLES.push(style);
  return style;
}

const TEXT_RASTER_RESOLUTION = 5;

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

// Not registered as a tinted style: the frame text color is contrast-aware
// (dark on light tint bars, light on the dark art scrim) and set per-card in
// `renderFrame`, so each frame Text gets its own cloned style instance.
const FRAME_NAME_STYLE = new TextStyle({
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontSize: 7,
  fontWeight: "600",
  fill: tintedTextFill(),
  wordWrap: true,
  wordWrapWidth: CARD_W - 6,
  lineHeight: 8,
});

const FRAME_TYPE_STYLE = new TextStyle({
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontSize: 5.5,
  fill: tintedTextFill(),
  wordWrap: true,
  wordWrapWidth: CARD_W - 6,
  lineHeight: 6.5,
});

const FOIL_STAR_STYLE = new TextStyle({
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  fontSize: 10,
  fontWeight: "bold",
  fill: 0xffe27a,
});

/** Hard-coded rather than themed because foil treatment reads "metallic gold"
 *  across every preset; the surrounding card art carries the theme. */
const FOIL_RING_COLOR = 0xffd87a;

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
const BADGE_TITLE_BAND_FRAC = 0.1;

const MAX_VISIBLE_COUNTERS = 4;

const WUBRG = new Set(["W", "U", "B", "R", "G"]);

function cardTintHex(colorIdentity: string[] | undefined): string {
  const mana = activeTheme.gameTheme.mana;
  const first = (colorIdentity ?? []).find((c) => WUBRG.has(c));
  return first ? mana[first as keyof typeof mana] : mana.C;
}

function frameTypeLine(card: CardDto): string {
  const left = [...(card.supertypes ?? []), ...(card.types ?? [])].join(" ");
  const subtypes = card.subtypes ?? [];
  return subtypes.length > 0 ? `${left} - ${subtypes.join(" ")}` : left;
}

type CardStatusKey = keyof Theme["gameTheme"]["cardStatus"];

interface BadgeRule {
  label: string;
  test: (card: CardDto) => boolean;
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
  { label: "TOKEN", test: (c) => !!c.identity.isToken, colorKey: "token" },
];

function badgeColor(key: CardStatusKey): number {
  return hexToNum(activeTheme.gameTheme.cardStatus[key]);
}

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

const parseStat = (value: string | null | undefined): number => {
  if (!value) return 0;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
};

const resolvePTBgColor = (card: CardDto): number => {
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
  card: CardDto;

  private imageSpr: Sprite;
  private imageMask: Graphics;
  private frameContainer: Container;
  private frameMask: Graphics;
  private frameGfx: Graphics;
  private frameNameText: Text;
  private frameTypeText: Text;
  private frameScrimGrad: FillGradient | null = null;
  private frameScrimKey = "";
  private sickFilter: ColorMatrixFilter | null = null;
  private lastFilterKey = "";
  private frameTypeBandH = 0;
  private frameNameBandH = 0;
  private frameCounterReserve = 0;
  private manaContainer: Container;
  private doomedGfx: Graphics;
  private edgeGlowGfx: Graphics;
  private edgeGlowMask: Graphics;
  private glowPulsing = false;
  private hitFlashGfx: Graphics;
  private statPopFx: OneShot | null = null;
  private hitFlashFx: OneShot | null = null;
  /** Squash multiplier driven by GSAP (entrance stomp); the region multiplies
   *  it into the base/hover scale each frame so the two don't fight. */
  readonly fxScale = { x: 1, y: 1 };
  private ringGfx: Graphics;
  private hitPad = 0;
  private chromeScale = 1;
  private lastRing: { color: number; alpha: number } | null = null;
  private lastOwnerRing: number | null = null;
  private ownerRingGfx: Graphics;
  private contentContainer: Container;
  private ptContainer: Container;
  private ptBg: Graphics;
  private ptText: Text;
  private damageGfx: Graphics;
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
  private mustAttackGfx: Graphics;
  private mustAttackIcon: Sprite;
  private mustAttackActive = false;
  private stackCountContainer: Container;
  private stackCountBg: Graphics;
  private stackCountText: Text;
  private orderBadgeContainer: Container;
  private orderBadgeBg: Graphics;
  private orderBadgeText: Text;
  private etbGlow: Graphics;
  private hoverDebugGfx: Graphics;
  private _imageLoaded = false;
  private readonly isBattlefield: boolean;
  private cw: number;
  private ch: number;
  onReorient?: () => void;
  private previewFace: 0 | 1 | null = null;
  private loadGeneration = 0;

  constructor(card: CardDto, kind: "battlefield" | "hand" = "battlefield") {
    super();
    this.card = card;
    this.isBattlefield = kind === "battlefield";
    const horizontal = this.isHorizontal();
    this.cw = horizontal ? CARD_H : CARD_W;
    this.ch = horizontal ? CARD_W : CARD_H;
    this.eventMode = "static";
    this.cursor = "pointer";

    this.ownerRingGfx = new Graphics();
    this.addChild(this.ownerRingGfx);

    this.ringGfx = new Graphics();
    this.addChild(this.ringGfx);

    this.contentContainer = new Container();
    this.addChild(this.contentContainer);

    this.placeholderGfx = new Graphics();
    this.placeholderGfx.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
    this.placeholderGfx.fill({
      color: hexToNum(activeTheme.gameTheme.cardPlaceholder.fill),
      alpha: 0.8,
    });
    this.placeholderGfx.stroke({
      color: hexToNum(activeTheme.gameTheme.cardPlaceholder.stroke),
      width: 1,
    });
    this.addChild(this.placeholderGfx);

    this.nameText = new Text({ text: card.identity.name, style: NAME_STYLE });
    this.nameText.resolution = TEXT_RASTER_RESOLUTION;
    this.nameText.anchor.set(0.5);
    this.nameText.x = this.cw / 2;
    this.nameText.y = this.ch / 2;
    this.addChild(this.nameText);

    this.imageMask = new Graphics();
    this.imageMask.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
    this.imageMask.fill(hexToNum(activeTheme.gameTheme.canvas.neutral));
    this.addChild(this.imageMask);

    this.imageSpr = new Sprite(Texture.EMPTY);
    this.imageSpr.setSize(this.cw, this.ch);
    this.imageSpr.mask = this.imageMask;
    this.addChild(this.imageSpr);
    this.fitImageToSlot();

    this.frameContainer = new Container();
    this.frameContainer.visible = false;
    this.frameMask = new Graphics();
    this.frameMask.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
    this.frameMask.fill(hexToNum(activeTheme.gameTheme.canvas.neutral));
    this.frameContainer.addChild(this.frameMask);
    this.frameContainer.mask = this.frameMask;
    this.frameGfx = new Graphics();
    this.frameContainer.addChild(this.frameGfx);
    this.frameNameText = new Text({ text: "", style: FRAME_NAME_STYLE.clone() });
    this.frameNameText.resolution = TEXT_RASTER_RESOLUTION;
    this.frameTypeText = new Text({ text: "", style: FRAME_TYPE_STYLE.clone() });
    this.frameTypeText.resolution = TEXT_RASTER_RESOLUTION;
    this.frameContainer.addChild(this.frameNameText);
    this.frameContainer.addChild(this.frameTypeText);
    this.addChild(this.frameContainer);

    this.manaContainer = new Container();
    this.addChild(this.manaContainer);

    this.doomedGfx = new Graphics();
    this.doomedGfx.visible = false;
    this.addChild(this.doomedGfx);

    this.damageGfx = new Graphics();
    this.damageGfx.visible = false;
    this.addChild(this.damageGfx);

    this.hitFlashGfx = new Graphics();
    this.hitFlashGfx.visible = false;
    this.addChild(this.hitFlashGfx);

    this.edgeGlowMask = new Graphics();
    this.edgeGlowMask
      .roundRect(0, 0, this.cw, this.ch, CARD_RADIUS)
      .fill(hexToNum(activeTheme.gameTheme.canvas.neutral));
    this.addChild(this.edgeGlowMask);
    this.edgeGlowGfx = new Graphics();
    this.edgeGlowGfx.visible = false;
    this.edgeGlowGfx.mask = this.edgeGlowMask;
    this.addChild(this.edgeGlowGfx);

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

    this.foilRing = new Graphics();
    this.foilRing.visible = false;
    this.addChild(this.foilRing);

    this.foilStar = new Text({ text: "✦", style: FOIL_STAR_STYLE });
    this.foilStar.resolution = TEXT_RASTER_RESOLUTION;
    this.foilStar.anchor.set(1, 0);
    this.foilStar.x = this.cw - 3;
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

    this.mustAttackGfx = new Graphics();
    this.mustAttackGfx.visible = false;
    this.addChild(this.mustAttackGfx);

    this.mustAttackIcon = new Sprite(Texture.EMPTY);
    this.mustAttackIcon.anchor.set(0.5, 0.5);
    this.mustAttackIcon.visible = false;
    this.addChild(this.mustAttackIcon);

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
    this.redrawHoverDebug();

    this.hitArea = {
      contains: (x: number, y: number) =>
        x >= -this.hitPad &&
        x <= this.cw + this.hitPad &&
        y >= -this.hitPad &&
        y <= this.ch + this.hitPad,
    };

    // Everything except the selection/target ring lives under contentContainer so
    // the summoning-sick / phased desaturate filter greys the card body but leaves
    // the interaction ring at full color.
    for (const child of [...this.children]) {
      if (child !== this.ringGfx && child !== this.contentContainer) {
        this.contentContainer.addChild(child);
      }
    }

    this.pivot.set(this.cw / 2, this.ch / 2);
    this.loadImage();
  }

  redrawHoverDebug(): void {
    this.hoverDebugGfx.clear();
    if (!activeHoverDebug || !this.isBattlefield) return;
    this.hoverDebugGfx.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
    this.hoverDebugGfx.fill({ color: hexToNum(activeTheme.gameTheme.success), alpha: 0.28 });
  }

  private deckCard() {
    return asDeckCard(useGameStore.getState().gameDecks[this.card.ownerId], this.card);
  }

  // Scryfall serves horizontal-frame cards as upright 5:7 PNGs — rotate
  // the sprite 90° so the printed art reads in landscape inside the slot.
  private isHorizontal(): boolean {
    return isHorizontalGameCard(this.card, this.deckCard().layout);
  }

  get horizontalFrame(): boolean {
    return this.cw > this.ch;
  }

  // Image fit + frame are left for the caller (`loadImage`) to repaint.
  private reapplyOrientation(): void {
    const horizontal = this.isHorizontal();
    const cw = horizontal ? CARD_H : CARD_W;
    const ch = horizontal ? CARD_W : CARD_H;
    if (cw === this.cw && ch === this.ch) return;
    this.cw = cw;
    this.ch = ch;
    this.placeholderGfx.clear();
    this.placeholderGfx.roundRect(0, 0, cw, ch, CARD_RADIUS);
    this.placeholderGfx.fill({
      color: hexToNum(activeTheme.gameTheme.cardPlaceholder.fill),
      alpha: 0.8,
    });
    this.placeholderGfx.stroke({
      color: hexToNum(activeTheme.gameTheme.cardPlaceholder.stroke),
      width: 1,
    });
    const neutral = hexToNum(activeTheme.gameTheme.canvas.neutral);
    for (const m of [this.imageMask, this.frameMask, this.edgeGlowMask]) {
      m.clear();
      m.roundRect(0, 0, cw, ch, CARD_RADIUS).fill(neutral);
    }
    this.nameText.position.set(cw / 2, ch / 2);
    this.foilStar.x = cw - 3;
    this.pivot.set(cw / 2, ch / 2);
    this.onReorient?.();
  }

  private fitImageToSlot(): void {
    if (this.isHorizontal()) {
      this.imageSpr.anchor.set(0.5, 0.5);
      this.imageSpr.x = this.cw / 2;
      this.imageSpr.y = this.ch / 2;
      this.imageSpr.rotation = Math.PI / 2;
      this.imageSpr.setSize(this.ch, this.cw);
    } else {
      this.imageSpr.anchor.set(0, 0);
      this.imageSpr.rotation = 0;
      this.imageSpr.x = 0;
      this.imageSpr.y = 0;
      this.imageSpr.setSize(this.cw, this.ch);
    }
  }

  private async loadImage(): Promise<void> {
    const generation = ++this.loadGeneration;
    const deck = useGameStore.getState().gameDecks[this.card.ownerId];
    const deckCard = asDeckCard(deck, this.card);
    const custom = this.isBattlefield && activeStyle !== "realistic";
    const faceIndex = this.previewFace ?? (this.card.isTransformed ? 1 : 0);
    let tex: Texture;
    try {
      tex = await useScryfallStore
        .getState()
        .getCardTexture(deckCard, custom ? "art" : "full", faceIndex);
    } catch {
      tex = Texture.EMPTY;
    }
    if (this.destroyed || generation !== this.loadGeneration) return;
    this.reapplyOrientation();
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

  setPreviewFace(face: 0 | 1 | null): void {
    if (this.previewFace === face) return;
    this.previewFace = face;
    this.loadImage();
  }

  private fitArtCover(): void {
    const tex = this.imageSpr.texture;
    if (tex.width === 0 || tex.height === 0) return;
    this.imageSpr.anchor.set(0.5, 0.5);
    this.imageSpr.rotation = 0;
    this.imageSpr.x = this.cw / 2;
    this.imageSpr.y = this.ch / 2;
    const ar = tex.width / tex.height;
    const cardAR = this.cw / this.ch;
    if (ar > cardAR) this.imageSpr.setSize(this.ch * ar, this.ch);
    else this.imageSpr.setSize(this.cw, this.cw / ar);
  }

  restyle(): void {
    // Repaint synchronously so the frame switches style in the same frame as the
    // keyword/mana strips; loadImage repaints again after the texture resolves.
    // Otherwise the strips lead the bars/border by one async gap.
    this.renderFrame();
    this.loadImage();
    this.updateKeywords();
    this.updateMana();
  }

  private updateMana(): void {
    this.manaContainer.removeChildren().forEach((c) => c.destroy());
    if (!this.isBattlefield || activeStyle === "realistic") return;
    const codes = parseManaCost(this.card.manaCost);
    if (codes.length === 0) return;

    const size = MANA_PIP_SIZE;
    const gap = 1;
    const totalW = codes.length * size + (codes.length - 1) * gap;
    let x = this.cw - totalW - 3;
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

  private renderFrame(): void {
    if (!this.isBattlefield || activeStyle === "realistic") {
      this.frameContainer.visible = false;
      this.frameTypeBandH = 0;
      this.frameNameBandH = 0;
      this.frameCounterReserve = 0;
      return;
    }
    this.frameContainer.visible = true;
    const colorIdentity = this.deckCard().colorIdentity;
    const colorless = !(colorIdentity ?? []).some((c) => WUBRG.has(c));
    const tintHex = frameTint(
      cardTintHex(colorIdentity),
      colorless ? FRAME_TINT_COLORLESS_MAX_LUMINANCE : undefined,
    );
    const tintNum = hexToNum(tintHex);
    const shadowHex = activeTheme.gameTheme.canvas.shadow;
    const lightText = activeTheme.gameTheme.textOnTinted;

    this.frameGfx.clear();
    this.frameNameText.text = this.card.identity.name;
    this.frameTypeText.text = frameTypeLine(this.card);

    const pad = 3;
    this.frameTypeBandH = 0;
    this.frameNameBandH = 0;
    this.frameCounterReserve = 0;
    if (activeStyle === "art") {
      this.frameNameText.style.fill = lightText;
      this.frameTypeText.style.fill = lightText;
      this.frameTypeText.anchor.set(0, 1);
      this.frameTypeText.alpha = 0.78;
      this.frameTypeText.x = pad;
      this.frameTypeText.y = this.ch - pad;
      this.frameNameText.anchor.set(0, 1);
      this.frameNameText.alpha = 1;
      this.frameNameText.x = pad;
      this.frameNameText.y = this.frameTypeText.y - this.frameTypeText.height - 1;
      const captionTop = this.frameNameText.y - this.frameNameText.height;
      this.frameCounterReserve = this.ch - captionTop;
      const scrimTop = captionTop - 8;
      this.frameGfx.rect(0, scrimTop, this.cw, this.ch - scrimTop);
      this.frameGfx.fill(this.scrimGradient(scrimTop, shadowHex));
    } else {
      const barText = readableTextColor(tintHex, shadowHex, lightText);
      this.frameNameText.style.fill = barText;
      this.frameTypeText.style.fill = barText;
      this.frameNameText.anchor.set(0, 0);
      this.frameNameText.alpha = 1;
      this.frameNameText.x = pad;
      this.frameNameText.y = 2.5;
      const nameBandH = this.frameNameText.height + 5;
      this.frameTypeText.anchor.set(0, 1);
      this.frameTypeText.alpha = 1;
      this.frameTypeText.x = pad;
      this.frameTypeText.y = this.ch - 2.5;
      const typeBandH = this.frameTypeText.height + 5;
      this.frameTypeBandH = typeBandH;
      this.frameNameBandH = nameBandH;
      this.frameCounterReserve = typeBandH;
      this.frameGfx.rect(0, 0, this.cw, nameBandH);
      this.frameGfx.fill({ color: tintNum, alpha: 0.92 });
      this.frameGfx.rect(0, this.ch - typeBandH, this.cw, typeBandH);
      this.frameGfx.fill({ color: tintNum, alpha: 0.85 });
      this.frameGfx.roundRect(2.6, 2.6, this.cw - 5.2, this.ch - 5.2, CARD_RADIUS - 2.6);
      this.frameGfx.stroke({ color: hexToNum(shadowHex), width: 0.6, alpha: 0.4 });
    }

    this.frameGfx.roundRect(0.75, 0.75, this.cw - 1.5, this.ch - 1.5, CARD_RADIUS - 0.75);
    this.frameGfx.stroke({ color: tintNum, width: 1.5 });
  }

  /** Cached per (top, color) so the gradient texture isn't rebuilt on every
   *  state tick. */
  private scrimGradient(top: number, shadowHex: string): FillGradient {
    const key = `${top.toFixed(2)}|${shadowHex}`;
    if (this.frameScrimKey !== key || !this.frameScrimGrad) {
      this.frameScrimGrad = new FillGradient({
        type: "linear",
        start: { x: 0, y: top },
        end: { x: 0, y: this.ch },
        textureSpace: "global",
        colorStops: [
          { offset: 0, color: withAlpha(shadowHex, 0) },
          { offset: 0.4, color: withAlpha(shadowHex, 0.6) },
          { offset: 1, color: withAlpha(shadowHex, 0.94) },
        ],
      });
      this.frameScrimKey = key;
    }
    return this.frameScrimGrad;
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
  updateCardContent(card: CardDto): void {
    const nameChanged =
      card.identity.name !== this.card.identity.name ||
      card.identity.setCode !== this.card.identity.setCode ||
      card.identity.cardNumber !== this.card.identity.cardNumber ||
      card.isFaceDown !== this.card.isFaceDown ||
      card.isTransformed !== this.card.isTransformed;
    this.card = card;

    if (nameChanged) {
      this._imageLoaded = false;
      this.placeholderGfx.visible = true;
      this.nameText.visible = true;
      this.nameText.text = card.identity.name;
      this.loadImage();
    }

    this.renderFrame();
    this.updatePT();
    this.updateDamage();
    this.updateBadge();
    this.updateCounters();
    this.updateKeywords();
    this.updateFoil();
    this.updateRingBearer();
    this.updateMana();
    this.updateCardFilter();
    this.updateEdgeGlow();
  }

  private updateEdgeGlow(): void {
    const card = this.card;
    const attacking = this.isBattlefield && !!card.isAttacking;
    const sick =
      this.isBattlefield &&
      !!card.summoningSick &&
      (card.types?.some((t) => t.toLowerCase() === "creature") ?? false);
    this.edgeGlowGfx.clear();
    if (!attacking && !sick) {
      this.edgeGlowGfx.visible = false;
      this.glowPulsing = false;
      return;
    }
    const color = attacking
      ? hexToNum(activeTheme.gameTheme.pt.lethal)
      : hexToNum(activeTheme.gameTheme.textOnTinted);
    const maxAlpha = attacking ? EDGE_GLOW.attackingMaxAlpha : EDGE_GLOW.sickMaxAlpha;
    const layers = EDGE_GLOW.layers;
    const step = EDGE_GLOW.insetStep;
    for (let i = 0; i < layers; i++) {
      const inset = i * step;
      this.edgeGlowGfx.roundRect(
        inset,
        inset,
        this.cw - 2 * inset,
        this.ch - 2 * inset,
        Math.max(0, CARD_RADIUS - inset),
      );
      this.edgeGlowGfx.stroke({
        color,
        width: EDGE_GLOW.strokeWidth,
        alpha: maxAlpha * (1 - i / layers),
      });
    }
    this.edgeGlowGfx.visible = true;
    this.edgeGlowGfx.alpha = 1;
    this.glowPulsing = sick && !attacking;
  }

  playStatPop(now: number): void {
    this.statPopFx = oneShot(now, STAT_POP.durationMs);
  }

  playDamageHit(now: number): void {
    this.hitFlashFx = oneShot(now, DAMAGE_HIT.durationMs);
  }

  tickEffects(now: number): void {
    if (this.glowPulsing) {
      this.edgeGlowGfx.alpha = animationsEnabled()
        ? pulse(now, EDGE_GLOW.pulsePeriodMs, EDGE_GLOW.pulseMin, EDGE_GLOW.pulseMax)
        : EDGE_GLOW.staticAlpha;
    }

    const sp = oneShotProgress(this.statPopFx, now);
    if (sp != null) this.ptContainer.scale.set(1 + STAT_POP.bumpScale * bump(sp));
    else if (this.statPopFx) {
      this.statPopFx = null;
      this.ptContainer.scale.set(1);
    }

    const fp = oneShotProgress(this.hitFlashFx, now);
    if (fp != null) {
      this.hitFlashGfx.clear();
      this.hitFlashGfx.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
      this.hitFlashGfx.fill({
        color: hexToNum(activeTheme.gameTheme.textOnTinted),
        alpha: DAMAGE_HIT.maxAlpha * bump(fp),
      });
      this.hitFlashGfx.visible = true;
    } else if (this.hitFlashFx) {
      this.hitFlashFx = null;
      this.hitFlashGfx.visible = false;
      this.hitFlashGfx.clear();
    }
  }

  destroy(options?: DestroyOptions): void {
    // If the card is removed mid-stomp the GSAP tween would keep mutating a
    // destroyed sprite's fxScale forever; kill it before teardown.
    gsap.killTweensOf(this.fxScale);
    if (this.sickFilter) {
      this.sickFilter.destroy();
      this.sickFilter = null;
    }
    const frameNameStyle = this.frameNameText.style;
    const frameTypeStyle = this.frameTypeText.style;
    super.destroy(options);
    frameNameStyle.destroy();
    frameTypeStyle.destroy();
  }

  /** Phased-out cards are desaturated here, but their alpha fade is owned by the
   *  board tick. */
  private updateCardFilter(): void {
    const card = this.card;
    const sick =
      this.isBattlefield &&
      !!card.summoningSick &&
      (card.types?.some((t) => t.toLowerCase() === "creature") ?? false);
    const phased = this.isBattlefield && !!card.phasedOut;
    // Rebuild only when the state changes — updateCardContent runs every tick.
    const key = sick ? "sick" : phased ? "phased" : "none";
    if (key === this.lastFilterKey) return;
    this.lastFilterKey = key;
    if (key === "none") {
      this.contentContainer.filters = [];
      return;
    }
    if (!this.sickFilter) this.sickFilter = new ColorMatrixFilter();
    const f = this.sickFilter;
    if (sick) {
      f.saturate(SUMMONING_FILTER.sickSaturate, false);
      f.brightness(SUMMONING_FILTER.sickBrightness, true);
    } else {
      f.saturate(SUMMONING_FILTER.phasedSaturate, false);
    }
    this.contentContainer.filters = [f];
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

  setMustAttack(active: boolean): void {
    if (active === this.mustAttackActive) return;
    this.mustAttackActive = active;
    this.mustAttackGfx.visible = active;
    this.mustAttackIcon.visible = active;
    if (!active) {
      this.mustAttackGfx.clear();
      return;
    }
    const discRadius = 13;
    const cx = discRadius + 2;
    const cy = this.ch - discRadius - 2;
    const fgHex = activeTheme.gameTheme.textOnTinted;
    this.mustAttackGfx.clear();
    this.mustAttackGfx.circle(cx, cy, discRadius);
    this.mustAttackGfx.fill({
      color: hexToNum(activeTheme.gameTheme.promptAction.attackAction),
      alpha: 0.95,
    });
    this.mustAttackGfx.circle(cx, cy, discRadius);
    this.mustAttackGfx.stroke({ color: hexToNum(fgHex), width: 1.5, alpha: 0.6 });
    const iconSize = 18;
    this.mustAttackIcon.x = cx;
    this.mustAttackIcon.y = cy;
    this.mustAttackIcon.width = iconSize;
    this.mustAttackIcon.height = iconSize;
    applyIcon(this.mustAttackIcon, "sword-brandish", fgHex, 64, iconSize, iconSize);
  }

  private updateKeywords(): void {
    this.keywordsContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const custom = this.isBattlefield && activeStyle !== "realistic";
    if (!custom && this.card.id !== DEBUG_KEYWORD_CARD_ID) return;

    const { shown, hidden } = battlefieldKeywords(this.card.keywords, MAX_VISIBLE_KEYWORDS);
    if (shown.length === 0) return;

    const rowH = KEYWORD_ROW_H;
    let offsetY = Math.round(this.ch * 0.3);
    const shadowNum = hexToNum(activeTheme.gameTheme.canvas.shadow);

    const addChip = (text: string) => {
      const chip = new Container();
      const bg = new Graphics();
      const txt = new Text({ text, style: KEYWORD_CHIP_STYLE });
      txt.resolution = TEXT_RASTER_RESOLUTION;
      txt.anchor.set(0, 0.5);
      txt.x = 3;
      txt.y = rowH / 2;

      const cw = Math.min(txt.width + 6, this.cw - 6);
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
    this.etbGlow.roundRect(-2, -2, this.cw + 4, this.ch + 4, CARD_RADIUS + 2);
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
    this.orderBadgeContainer.x = (this.cw - d) / 2;
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
    this.foilRing.roundRect(1, 1, this.cw - 2, this.ch - 2, CARD_RADIUS - 1);
    this.foilRing.stroke({ color: FOIL_RING_COLOR, width: 1.5, alpha: 0.85 });
  }

  private updatePT(): void {
    const card = this.card;
    const isCreature = card.types?.some((t) => t.toLowerCase() === "creature");
    // Hand cards already carry the printed P/T; drawing our overlay on top would
    // double it at a mismatched size, so the badge is battlefield-only.
    if (!this.isBattlefield || !isCreature || !card.power || !card.toughness) {
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
    // Pivot at the badge center so the stat-pop scales in place, not from a corner.
    this.ptContainer.pivot.set(tw / 2, th / 2);
    this.ptContainer.x = this.cw - tw - 3 + tw / 2;
    this.ptContainer.y =
      this.ch - th - 3 - (this.frameTypeBandH > 0 ? this.frameTypeBandH + 1 : 0) + th / 2;
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
    // Below the title line, not on top of it — a top-centered badge would cover
    // the mana cost cluster when the hand hover scales the card up.
    const titleBandY = Math.round(this.ch * BADGE_TITLE_BAND_FRAC);
    this.badgeContainer.x = (this.cw - bw) / 2;
    this.badgeContainer.y = titleBandY;
  }

  private updateCounters(): void {
    this.counterContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const counters = this.card.counters;
    if (!counters) return;

    // P1P1 / M1M1 are deliberately excluded — the net buff/debuff is conveyed by
    // the green/red P/T color instead.
    const present = Object.entries(counters).filter(
      ([t, n]) => n > 0 && t !== "P1P1" && t !== "M1M1",
    );
    if (present.length === 0) return;
    const entries = present.slice(0, MAX_VISIBLE_COUNTERS);
    const hiddenTypeCount = present.length - entries.length;

    const iconSize = COUNTER_HEIGHT - 4;
    const fgHex = activeTheme.gameTheme.textOnTinted;
    const counterY =
      this.ch -
      COUNTER_HEIGHT -
      3 -
      (this.frameCounterReserve > 0 ? this.frameCounterReserve + 1 : 0);

    let offsetX = 3;
    for (const [type, count] of entries) {
      const color = getCounterColor(type);
      const iconName = COUNTER_ICON_NAMES[type];
      const textLabel = type.slice(0, 3);

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
      badge.y = counterY;
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
      badge.y = counterY;
      this.counterContainer.addChild(badge);
    }
  }

  private updateDamage(): void {
    const card = this.card;
    const dmg = card.damage ?? 0;
    if (dmg <= 0) {
      this.damageGfx.visible = false;
      return;
    }
    const tough = parseInt(card.toughness ?? "0", 10);
    const alpha = Math.min(0.5, (tough > 0 ? dmg / tough : 1) * 0.5);
    this.damageGfx.visible = true;
    this.damageGfx.clear();
    // Mini-frame washes only the art window between the bars so they stay clean;
    // art / realistic washes the whole rounded card.
    if (this.frameNameBandH > 0) {
      const top = this.frameNameBandH;
      this.damageGfx.rect(0, top, this.cw, this.ch - top - this.frameTypeBandH);
    } else {
      this.damageGfx.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
    }
    this.damageGfx.fill({ color: hexToNum(activeTheme.gameTheme.pt.lethal), alpha });
  }

  setHitPad(pad: number): void {
    this.hitPad = pad;
  }

  setChromeScale(scale: number): void {
    if (this.chromeScale === scale) return;
    this.chromeScale = scale;
    if (this.lastRing) this.setRing(this.lastRing.color, this.lastRing.alpha);
    if (this.lastOwnerRing != null) this.setOwnerRing(this.lastOwnerRing);
  }

  setRing(color: number | null, alpha = 1): void {
    this.lastRing = color == null ? null : { color, alpha };
    this.ringGfx.clear();
    if (color == null) return;
    this.drawRingStroke(color, alpha);
  }

  setOwnerRing(color: number | null): void {
    this.lastOwnerRing = color;
    this.ownerRingGfx.clear();
    if (color == null) return;
    const o = RING_INSET + 3;
    this.ownerRingGfx.roundRect(-o, -o, this.cw + o * 2, this.ch + o * 2, RING_RADIUS + 3);
    this.ownerRingGfx.stroke({ color, width: 2.5 * this.chromeScale });
  }

  setDoomed(active: boolean): void {
    if (this.doomedGfx.visible === active) return;
    this.doomedGfx.visible = active;
    this.doomedGfx.clear();
    if (!active) return;
    this.doomedGfx.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
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
    this.ringGfx.roundRect(0, 0, this.cw, this.ch, CARD_RADIUS);
    this.ringGfx.fill({ color, alpha });
  }

  private drawRingStroke(color: number, alpha: number): void {
    this.ringGfx.roundRect(
      -RING_INSET,
      -RING_INSET,
      this.cw + RING_INSET * 2,
      this.ch + RING_INSET * 2,
      RING_RADIUS,
    );
    this.ringGfx.stroke({ color, width: 2 * this.chromeScale, alpha });
  }
}
