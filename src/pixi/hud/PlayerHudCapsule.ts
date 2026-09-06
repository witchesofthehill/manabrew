import {
  Bounds,
  ColorMatrixFilter,
  Container,
  Graphics,
  Point,
  Sprite,
  Text,
  Texture,
  TextStyle,
} from "pixi.js";
import { gsap } from "@/pixi/effects/gsap";
import { animationsEnabled } from "@/pixi/effects/enabled";
import type { Theme } from "@/hooks/useTheme";
import { getTheme } from "@/hooks/useTheme";
import { MANA_LETTERS } from "@/themes/gameTheme";
import { getInitials } from "@/components/game/game.utils";
import { hexToNum } from "../colorUtils";
import { gameIconTexture } from "../gameIconCache";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "../manaSymbolCache";
import { loadAvatarTexture } from "./avatarTextureCache";
import type { PlayerHudSpec, PlayerHudTooltipContent } from "./playerHud.types";
import type { ScreenBounds, ScreenPos } from "@/pixi/types";
import { loadCardBack } from "@/pixi/CardSprite";
import { RING_ABILITIES, zoneBadgeId } from "@/components/game/game.constants";

const BOT_ICON_NAME = "robot-antennas";
const SKULL_ICON_NAME = "skull-crossed-bones";
const OFFLINE_ICON_NAME = "aerial-signal";
const GEAR_ICON_NAME = "cog";
const DETAILS_ICON_NAME = "info";
const FONT = "Inter, system-ui, -apple-system, sans-serif";
const PANEL_PADDING = 10;
const AVATAR_DIAMETER = 44;
const SHALLOW_AVATAR_MIN_HEIGHT = 96;
const SHALLOW_RESOURCE_IDENTITY_OVERLAP = 30;
const SHALLOW_RESOURCE_RIGHT_INSET = 16;
const SHALLOW_STATE_BLOCK_HEIGHT = 48;
const STATE_ROW_HEIGHT = 24;
const STATE_TOUCH_ROW_HEIGHT = 40;
const TRAY_HORIZONTAL_PADDING = 6;
const TRAY_VERTICAL_PADDING = 2;
const TRAY_RADIUS = 6;
const STATE_ORDER = ["incoming-damage", "poison", "commander", "monarch", "initiative"];

const iconTextures = new Map<string, Texture>();

const SCRATCH_A = new Point();
const SCRATCH_B = new Point();

// Shared, immutable text styles keyed by (size, weight, fill). Pixi safely
// shares one TextStyle across many Text objects, so this removes the per-render
// allocation churn — callers must never mutate a returned style.
const styleCache = new Map<string, TextStyle>();
function cachedTextStyle(size: number, weight: TextStyle["fontWeight"], fill: number): TextStyle {
  const key = `${size}|${weight}|${fill}`;
  let s = styleCache.get(key);
  if (!s) {
    s = new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: weight,
      fill,
      dropShadow: {
        color: getTheme().gameTheme.canvas.shadow,
        alpha: 0.55,
        blur: 3,
        distance: 1,
        angle: Math.PI / 2,
      },
    });
    styleCache.set(key, s);
  }
  return s;
}

export type HoverFn = (
  content: PlayerHudTooltipContent | null,
  cx?: number,
  top?: number,
  bottom?: number,
) => void;

export type PlayerHudEdgeDock = "top" | "bottom" | null;

interface ManaPip {
  sprite: Sprite;
  count: Text;
  value?: number;
  flash: Graphics;
}

interface BadgeChip {
  sprite: Sprite;
  count: Text;
  label: Text;
  hit: Graphics;
  content: PlayerHudTooltipContent;
  badgeId?: string;
}

interface ContentItem {
  w: number;
  place: (x: number, y: number) => void;
}

interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class PlayerHudCapsule {
  readonly container: Container;
  private theme: Theme;
  private onTarget: () => void;
  private onShowSheet: () => void;
  private onInspect: () => void;
  private onMenu: () => void;
  private onHover: HoverFn;

  private bg = new Graphics();
  private glow = new Graphics();
  private combatGlow = new Graphics();
  private damageWash = new Graphics();
  private targetRing = new Graphics();
  private flashRing = new Graphics();
  private avatarTex: Texture | null = null;
  private avatarPhoto = new Sprite();
  private avatarMask = new Graphics();
  private avatarFx = new Graphics();
  private bot = new Sprite();
  private skull = new Sprite();
  private offline = new Sprite();
  private gear = new Sprite();
  private detailsIcon = new Sprite();
  private gearHit = new Graphics();
  private initial: Text;
  private avatarHit = new Graphics();
  private heart: Text;
  private life: Text;
  private lifeFloat: Text;
  private nameText: Text;
  private seatState: Text;
  private priorityText: Text;
  private handCount: Text;
  private handFan = new Container();
  private handBacks: Sprite[] = [];
  private seatRail = new Graphics();
  private overflow: Text;
  private emptyStateText: Text;
  private overflowHit = new Graphics();
  private identityHeight = 0;
  private identityWidth = 0;
  private panelHeight = 0;
  private motionEnabled = animationsEnabled();
  private manaTray = new Graphics();
  private stateTray = new Graphics();
  private manaLayer = new Container();
  private badgeLayer = new Container();
  private sparkles = new Container();
  private pips: ManaPip[] = [];
  private chips: BadgeChip[] = [];
  private greyscale = new ColorMatrixFilter();

  private spec: PlayerHudSpec;
  private width = 0;
  private height = 0;
  private column = false;
  private compact = false;
  private edgeDock: PlayerHudEdgeDock = null;
  private avatarUrl: string | null = null;
  private readonly isBot: boolean;
  private renderedLife: number | null = null;
  private targetableActive = false;
  private targetTween: gsap.core.Tween | null = null;
  private flashTween: gsap.core.Tween | null = null;
  private lifeTween: gsap.core.Tween | null = null;
  private offlineTween: gsap.core.Tween | null = null;
  private offlineActive = false;
  private combatPulse: gsap.core.Tween | null = null;
  private combatActive = false;
  private combatLethalActive = false;
  private gearHovered = false;
  private gearCx = 0;
  private gearCy = 0;
  private gearChipR = 0;
  private prevFlashing = false;
  private prevBadgeIds = new Set<string>();
  private lifeFontSize = 15;
  private lastSig = "";
  private avatarCx = 0;
  private avatarCy = 0;
  private avatarDia = 0;
  private contentBounds = new Bounds();

  constructor(
    theme: Theme,
    spec: PlayerHudSpec,
    onTarget: () => void,
    onShowSheet: () => void,
    onMenu: () => void,
    onHover: HoverFn,
    onInspect: () => void,
  ) {
    this.theme = theme;
    this.spec = spec;
    this.isBot = spec.isBot;
    this.onTarget = onTarget;
    this.onShowSheet = onShowSheet;
    this.onInspect = onInspect;
    this.onMenu = onMenu;
    this.onHover = onHover;

    this.container = new Container();
    this.avatarPhoto.anchor.set(0.5);
    this.avatarPhoto.visible = false;
    this.avatarPhoto.eventMode = "none";
    this.avatarPhoto.mask = this.avatarMask;
    this.avatarMask.eventMode = "none";
    this.avatarFx.eventMode = "none";
    this.combatGlow.eventMode = "none";
    this.combatGlow.visible = false;
    this.bot.anchor.set(0.5);
    this.bot.visible = false;
    this.skull.anchor.set(0.5);
    this.skull.visible = false;
    this.offline.anchor.set(0.5);
    this.offline.visible = false;
    this.gear.anchor.set(0.5);
    this.gear.visible = false;
    this.gear.eventMode = "none";
    this.detailsIcon.anchor.set(0.5);
    this.detailsIcon.visible = false;
    this.detailsIcon.eventMode = "none";
    this.gearHit.visible = false;
    this.gearHit.eventMode = "static";
    this.gearHit.cursor = "pointer";
    this.gearHit.on("pointertap", (e) => {
      e.stopPropagation();
      this.onMenu();
    });
    this.gearHit.on("pointerover", () => {
      this.gearHovered = true;
      this.redrawGearChip();
      this.styleGear();
    });
    this.gearHit.on("pointerout", () => {
      this.gearHovered = false;
      this.redrawGearChip();
      this.styleGear();
    });
    this.greyscale.desaturate();
    this.glow.eventMode = "none";
    this.damageWash.eventMode = "none";
    this.targetRing.eventMode = "none";
    this.flashRing.eventMode = "none";
    this.manaTray.eventMode = "none";
    this.stateTray.eventMode = "none";
    this.sparkles.eventMode = "none";

    this.avatarHit.eventMode = "static";
    this.avatarHit.cursor = "pointer";
    this.avatarHit.on("pointertap", () => {
      if (this.spec.isTargetable) this.onTarget();
      else this.onShowSheet();
    });
    this.avatarHit.on("pointerover", () => {
      const r = this.avatarDia / 2;
      this.emitHover(this.avatarHover(), this.avatarCx, this.avatarCy - r, this.avatarCy + r);
    });
    this.avatarHit.on("pointerout", () => this.onHover(null));

    this.initial = new Text({ text: "", style: this.textStyle(16) });
    this.initial.anchor.set(0.5);
    this.heart = new Text({
      text: "LIFE",
      style: this.styled(8, "600", theme.gameTheme.textMuted),
    });
    this.heart.anchor.set(0, 0.5);
    this.life = new Text({ text: String(spec.life), style: this.textStyle(15) });
    this.life.anchor.set(0, 0.5);
    this.lifeFloat = new Text({ text: "", style: this.textStyle(16) });
    this.lifeFloat.anchor.set(0.5);
    this.lifeFloat.visible = false;
    this.nameText = new Text({ text: "", style: this.textStyle(12, "600") });
    this.seatState = new Text({ text: "", style: this.textStyle(9, "700") });
    this.priorityText = new Text({ text: "Priority", style: this.textStyle(9, "600") });
    this.handCount = new Text({ text: "", style: this.textStyle(13) });
    this.handCount.anchor.set(0, 0.5);
    this.overflow = new Text({ text: "", style: this.textStyle(11, "600") });
    this.emptyStateText = new Text({
      text: "No active effects",
      style: this.styled(9, "500", theme.gameTheme.textGhost),
    });
    this.emptyStateText.anchor.set(0, 0.5);
    this.emptyStateText.visible = false;
    this.emptyStateText.eventMode = "none";
    this.overflow.anchor.set(0, 0.5);
    this.overflow.eventMode = "none";
    this.overflowHit.eventMode = "static";
    this.overflowHit.cursor = "pointer";
    this.overflowHit.on("pointertap", (event) => {
      event.stopPropagation();
      this.onHover(null);
      this.onInspect();
    });
    this.handFan.eventMode = "none";
    this.seatRail.eventMode = "none";
    for (let i = 0; i < 3; i++) {
      const back = new Sprite();
      back.anchor.set(0.5, 1);
      back.rotation = (i - 1) * 0.16;
      this.handFan.addChild(back);
      this.handBacks.push(back);
    }
    loadCardBack()
      .then((texture) => {
        if (this.container.destroyed) return;
        for (const back of this.handBacks) back.texture = texture;
        this.render();
      })
      .catch((error) => console.warn("[hud] hand card back load failed", error));

    this.container.addChild(
      this.bg,
      this.seatRail,
      this.manaTray,
      this.stateTray,
      this.glow,
      this.avatarMask,
      this.avatarPhoto,
      this.avatarFx,
      this.combatGlow,
      this.damageWash,
      this.targetRing,
      this.flashRing,
      this.bot,
      this.initial,
      this.skull,
      this.offline,
      this.avatarHit,
      this.gearHit,
      this.gear,
      this.heart,
      this.life,
      this.nameText,
      this.seatState,
      this.priorityText,
      this.handFan,
      this.handCount,
      this.emptyStateText,
      this.overflow,
      this.detailsIcon,
      this.overflowHit,
      this.manaLayer,
      this.badgeLayer,
      this.sparkles,
      this.lifeFloat,
    );
  }

  private avatarHover(): PlayerHudTooltipContent {
    return { title: this.spec.isTargetable ? `Target ${this.spec.name}` : this.spec.name };
  }

  private badgeTooltip(badge: PlayerHudSpec["badges"][number]): PlayerHudTooltipContent {
    if (badge.id === "ring") {
      const level = Math.min(badge.count ?? 0, RING_ABILITIES.length);
      return {
        title: `${badge.label} — ${level}/${RING_ABILITIES.length}`,
        lines: RING_ABILITIES.map((text, i) => ({ text, active: i < level })),
      };
    }
    return { title: badge.count === undefined ? badge.label : `${badge.label}: ${badge.count}` };
  }

  private emitHover(
    content: PlayerHudTooltipContent,
    localCx: number,
    localTop: number,
    localBottom: number,
  ): void {
    const sx = this.container.scale.x;
    const sy = this.container.scale.y;
    this.onHover(
      content,
      this.container.x + localCx * sx,
      this.container.y + localTop * sy,
      this.container.y + localBottom * sy,
    );
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.lastSig = "";
    this.render();
  }

  getAvatarCenter(): ScreenPos {
    return this.container.toGlobal(new Point(this.avatarCx, this.avatarCy));
  }

  getZoneAnchor(zoneKey: string): ScreenPos | null {
    const id = zoneBadgeId(zoneKey);
    const idx = this.spec.badges.findIndex((b) => b.id === id);
    if (idx < 0) return null;
    const chip = this.chips[idx];
    if (!chip || !chip.sprite.visible) return null;
    const p = this.container.toGlobal(
      SCRATCH_A.set(chip.sprite.x + chip.sprite.width / 2, chip.sprite.y + chip.sprite.height / 2),
      SCRATCH_A,
    );
    return { x: p.x, y: p.y };
  }

  setSpec(spec: PlayerHudSpec): void {
    const sig = PlayerHudCapsule.signature(spec);
    this.spec = spec;
    this.updateAvatarTexture(spec.avatarUrl);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  private static signature(s: PlayerHudSpec): string {
    return JSON.stringify([
      s.life,
      s.isActiveTurn,
      s.isPriorityPlayer,
      s.isTargetable,
      s.isSelectedTarget,
      s.isFlashing,
      s.isEliminated,
      s.isDisconnected,
      s.inCombat,
      s.combatLethal,
      s.color,
      s.name,
      s.isBot,
      s.manaPool,
      s.badges,
    ]);
  }

  setCompact(compact: boolean): void {
    if (this.compact === compact) return;
    this.compact = compact;
    this.lastSig = "";
    this.render();
  }

  refreshMotion(): void {
    const enabled = animationsEnabled();
    if (enabled === this.motionEnabled) return;
    this.motionEnabled = enabled;
    this.combatPulse?.kill();
    this.targetTween?.kill();
    this.offlineTween?.kill();
    this.flashTween?.kill();
    this.lifeTween?.kill();
    gsap.killTweensOf(this.life.scale);
    gsap.killTweensOf(this.lifeFloat);
    gsap.killTweensOf(this.damageWash);
    this.life.scale.set(1);
    this.lifeFloat.visible = false;
    this.damageWash.visible = false;
    this.flashRing.visible = false;
    this.glow.alpha = 1;
    this.targetRing.alpha = 1;
    this.offline.alpha = 1;
    this.combatActive = false;
    this.targetableActive = false;
    this.offlineActive = false;
    for (const chip of this.chips) {
      gsap.killTweensOf(chip.sprite);
      chip.sprite.alpha = 1;
      chip.hit.alpha = 1;
    }
    for (const pip of this.pips) {
      gsap.killTweensOf(pip.flash);
      pip.flash.alpha = 0;
    }
    for (const dot of this.sparkles.removeChildren()) {
      gsap.killTweensOf(dot);
      dot.destroy();
    }
    this.render();
  }

  setRect(
    x: number,
    y: number,
    width: number,
    height: number,
    column: boolean,
    edgeDock: PlayerHudEdgeDock,
  ): void {
    this.container.position.set(x, y);
    if (
      this.width === width &&
      this.height === height &&
      this.column === column &&
      this.edgeDock === edgeDock
    )
      return;
    this.width = width;
    this.height = height;
    this.column = column;
    this.edgeDock = edgeDock;
    this.render();
  }

  private textStyle(size: number, weight: TextStyle["fontWeight"] = "700"): TextStyle {
    return cachedTextStyle(size, weight, hexToNum(this.theme.gameTheme.textOnTinted));
  }

  private styled(size: number, weight: TextStyle["fontWeight"], fill: string): TextStyle {
    return cachedTextStyle(size, weight, hexToNum(fill));
  }

  private updateAvatarTexture(url: string | undefined): void {
    if (!url) {
      this.avatarUrl = null;
      if (this.avatarTex) {
        this.avatarTex = null;
        this.render();
      }
      return;
    }
    if (url === this.avatarUrl) return;
    this.avatarUrl = url;
    loadAvatarTexture(url)
      .then((tex) => {
        if (this.avatarUrl !== url || this.container.destroyed) return;
        this.avatarTex = tex;
        this.render();
      })
      .catch((err) => console.warn("[hud] avatar load failed", this.spec.name, err));
  }

  private iconTexture(name: string): Texture | null {
    const cached = iconTextures.get(name);
    if (cached) return cached;
    gameIconTexture(name)
      .then((tex) => {
        iconTextures.set(name, tex);
        if (!this.container.destroyed) this.render();
      })
      .catch(() => {});
    return null;
  }

  private manaTexture(letter: string): Texture | null {
    const cached = getManaSymbolTextureSync(letter);
    if (cached) return cached;
    loadManaSymbolTexture(letter)
      .then(() => {
        if (!this.container.destroyed) this.render();
      })
      .catch(() => {});
    return null;
  }

  private drawAvatar(cx: number, cy: number, diameter: number, visible: boolean): void {
    const gt = this.theme.gameTheme;
    const r = diameter / 2;
    const hasImage = !!this.avatarTex;
    if (visible) {
      this.bg.circle(cx, cy, r);
      this.bg.fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.65 });
    }
    this.avatarFx.clear();
    this.avatarFx.visible = visible;
    this.avatarPhoto.visible = hasImage && visible;
    if (hasImage) {
      const tex = this.avatarTex!;
      const cover = diameter / Math.min(tex.width, tex.height);
      this.avatarPhoto.texture = tex;
      this.avatarPhoto.width = tex.width * cover;
      this.avatarPhoto.height = tex.height * cover;
      this.avatarPhoto.position.set(cx, cy);
      this.avatarMask
        .clear()
        .circle(cx, cy, r)
        .fill({ color: hexToNum(gt.textOnTinted) });
    }
    this.avatarFx.circle(cx, cy, r - 0.5);
    this.avatarFx.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.25 });
    this.bot.visible = visible && !hasImage && this.isBot;
    if (this.bot.visible) {
      const tex = this.iconTexture(BOT_ICON_NAME);
      if (tex) this.bot.texture = tex;
      this.bot.tint = hexToNum(gt.textMuted);
      this.bot.width = this.bot.height = diameter * 0.56;
      this.bot.position.set(cx, cy);
    }
    this.initial.visible = visible && !hasImage && !this.isBot;
    if (this.initial.visible) {
      this.initial.text = getInitials(this.spec.name);
      this.initial.style = this.textStyle(Math.round(diameter * 0.36), "800");
      this.initial.position.set(cx, cy);
    }
    this.skull.visible = visible && this.spec.isEliminated;
    if (this.skull.visible) {
      const tex = this.iconTexture(SKULL_ICON_NAME);
      if (tex) this.skull.texture = tex;
      this.skull.tint = hexToNum(gt.textOnTinted);
      this.skull.width = this.skull.height = diameter * 0.6;
      this.skull.position.set(cx, cy);
    }
    this.offline.visible = visible && this.spec.isDisconnected && !this.spec.isEliminated;
    if (this.offline.visible) {
      const tex = this.iconTexture(OFFLINE_ICON_NAME);
      if (tex) this.offline.texture = tex;
      this.offline.tint = hexToNum(gt.promptAction.cancel);
      this.offline.width = this.offline.height = diameter * 0.35;
      this.offline.position.set(cx + r * 0.6, cy + r * 0.6);
    }
    this.avatarHit
      .clear()
      .rect(0, 0, this.identityWidth, this.identityHeight)
      .fill({ color: hexToNum(gt.canvas.background), alpha: 0.001 });
    this.avatarHit.cursor = "pointer";
    this.gear.visible = this.gearHit.visible = this.spec.isSelf;
    if (this.spec.isSelf) {
      this.layoutGear(this.width - 20, 20, this.compact ? 20 : 12);
    }
  }

  private layoutGear(cx: number, cy: number, radius: number): void {
    this.gearCx = cx;
    this.gearCy = cy;
    this.gearChipR = radius;
    this.redrawGearChip();
    const texture = this.iconTexture(GEAR_ICON_NAME);
    if (texture) this.gear.texture = texture;
    this.gear.position.set(cx, cy);
    this.styleGear();
  }

  private redrawGearChip(): void {
    const gt = this.theme.gameTheme;
    this.gearHit.clear();
    this.gearHit.circle(this.gearCx, this.gearCy, this.gearChipR);
    this.gearHit.fill({
      color: hexToNum(gt.canvas.shadow),
      alpha: this.gearHovered ? 1 : 0.92,
    });
    this.gearHit.circle(this.gearCx, this.gearCy, this.gearChipR);
    this.gearHit.stroke({
      color: hexToNum(this.gearHovered ? gt.activeAction.active : gt.textGhost),
      width: this.gearHovered ? 1.5 : 1,
      alpha: this.gearHovered ? 0.95 : 0.35,
    });
  }

  private styleGear(): void {
    const gt = this.theme.gameTheme;
    const base = this.avatarDia * 0.22;
    const size = this.gearHovered ? base * 1.18 : base;
    this.gear.width = size;
    this.gear.height = size;
    this.gear.tint = hexToNum(this.gearHovered ? gt.activeAction.active : gt.textMuted);
  }

  private ensurePips(): void {
    while (this.pips.length < MANA_LETTERS.length) {
      const sprite = new Sprite();
      const count = new Text({ text: "", style: this.textStyle(12) });
      const flash = new Graphics();
      flash.eventMode = "none";
      flash.alpha = 0;
      count.anchor.set(0, 0.5);
      this.manaLayer.addChild(flash, sprite, count);
      this.pips.push({ sprite, count, flash });
    }
  }

  private ensureChips(): void {
    while (this.chips.length < this.spec.badges.length) {
      const sprite = new Sprite();
      const count = new Text({ text: "", style: this.textStyle(12) });
      const label = new Text({ text: "", style: this.textStyle(10, "500") });
      const hit = new Graphics();
      count.anchor.set(1, 0.5);
      label.anchor.set(0, 0.5);
      sprite.eventMode = count.eventMode = label.eventMode = "none";
      hit.eventMode = "static";
      hit.cursor = "pointer";
      const chip: BadgeChip = { sprite, count, label, hit, content: { title: "" } };
      hit.on("pointerover", () =>
        this.emitHover(chip.content, hit.x + hit.width / 2, hit.y, hit.y + hit.height),
      );
      hit.on("pointerout", () => this.onHover(null));
      hit.on("pointertap", (event) => {
        event.stopPropagation();
        this.onHover(null);
        const badge = this.spec.badges.find((entry) => entry.id === chip.badgeId);
        if (badge?.onTap) badge.onTap();
        else this.onInspect();
      });
      this.badgeLayer.addChild(hit, sprite, label, count);
      this.chips.push(chip);
    }
  }

  private extendContent(x: number, y: number, w: number, h: number): void {
    this.contentBounds.addFrame(x, y, x + w, y + h);
  }

  getKeepOutBounds(): ScreenBounds | null {
    if (!this.contentBounds.isValid) return null;
    const b = this.contentBounds;
    const tl = this.container.toGlobal(SCRATCH_A.set(b.minX, b.minY), SCRATCH_A);
    const br = this.container.toGlobal(SCRATCH_B.set(b.maxX, b.maxY), SCRATCH_B);
    return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
  }

  private render(): void {
    const { width: w, height: h } = this;
    if (w <= 0 || h <= 0) return;
    this.contentBounds.clear();
    this.life.text = String(this.spec.life);
    this.updateFilters();
    this.applyOffline();

    this.bg.clear();
    this.handFan.visible = false;
    this.seatRail.clear();
    this.manaTray.clear();
    this.stateTray.clear();
    this.detailsIcon.visible = false;
    this.overflow.visible = false;
    this.emptyStateText.visible = false;
    this.overflowHit.clear();
    this.overflowHit.visible = false;
    for (const chip of this.chips) {
      chip.sprite.visible = false;
      chip.count.visible = false;
      chip.label.visible = false;
      chip.hit.visible = false;
    }
    for (const pip of this.pips) {
      pip.sprite.visible = false;
      pip.count.visible = false;
    }
    if (this.column) this.renderColumn(w, h);
    else this.renderCapsule(w, h);
    this.applyLifeAnim();
    this.applyPriority();
    this.applyCombatGlow();
    this.applyTargetable();
    this.applyFlash();
    this.checkBadgeSparkles();
  }

  private applyOffline(): void {
    const on = this.spec.isDisconnected && !this.spec.isEliminated;
    if (on === this.offlineActive) return;
    this.offlineActive = on;
    if (!this.motionEnabled) {
      this.offline.alpha = 1;
      return;
    }
    if (on) {
      this.offlineTween = gsap.fromTo(
        this.offline,
        { alpha: 1 },
        { alpha: 0.35, duration: 0.7, ease: "sine.inOut", repeat: -1, yoyo: true },
      );
    } else {
      this.offlineTween?.kill();
      this.offlineTween = null;
      this.offline.alpha = 1;
    }
  }

  private updateFilters(): void {
    const eliminated = this.spec.isEliminated;
    // `null`, not `[]` — an empty filters array still routes the container
    // through a filter render-pass in Pixi, which softens/blurs it.
    this.container.filters = eliminated ? [this.greyscale] : null;
    this.container.alpha = !eliminated && this.spec.isDisconnected ? 0.6 : 1;
  }

  private checkBadgeSparkles(): void {
    const ids = new Set(this.spec.badges.map((b) => b.id));
    for (const id of ["monarch", "initiative"]) {
      if (this.motionEnabled && ids.has(id) && !this.prevBadgeIds.has(id)) {
        const badge = this.spec.badges.find((b) => b.id === id);
        this.burstSparkles(badge?.color ?? this.theme.gameTheme.textOnTinted);
      }
    }
    this.prevBadgeIds = ids;
  }

  private burstSparkles(color: string): void {
    const n = 10;
    const tint = hexToNum(color);
    const r = this.avatarDia / 2;
    for (let i = 0; i < n; i++) {
      const dot = new Graphics();
      dot.circle(0, 0, Math.max(1.5, this.avatarDia * 0.04));
      dot.fill({ color: tint, alpha: 1 });
      dot.position.set(this.avatarCx, this.avatarCy);
      this.sparkles.addChild(dot);
      const ang = (i / n) * Math.PI * 2 + i * 0.3;
      const dist = r * (0.9 + (i % 3) * 0.25);
      gsap.to(dot, {
        x: this.avatarCx + Math.cos(ang) * dist,
        y: this.avatarCy + Math.sin(ang) * dist,
        alpha: 0,
        duration: 0.7,
        ease: "power2.out",
        onComplete: () => dot.destroy(),
      });
    }
  }

  private renderColumn(w: number, h: number): void {
    const short = h < 290;
    const pad = 8;
    this.panelHeight = Math.min(h, 352);
    this.identityHeight = short ? 62 : 130;
    this.identityWidth = w;
    this.drawPlate(w, this.panelHeight);
    this.avatarCx = w / 2;
    this.avatarCy = 34;
    this.avatarDia = AVATAR_DIAMETER;
    this.drawAvatar(this.avatarCx, this.avatarCy, this.avatarDia, !short);
    this.layoutIdentity(pad, short ? 5 : 64, w - pad * 2, true, short ? 48 : 120);
    this.layoutLife(short ? w / 2 - 4 : w / 2, short ? 32 : 98, !short);
    this.heart.visible = false;
    const hand = this.makeHandItem(short ? 26 : 32);
    hand.place(short ? w / 2 + 4 : (w - hand.w) / 2, short ? 32 : 146);
    this.layoutMana(pad, short ? 70 : 172, w - pad * 2, 2, short ? 18 : 24);
    const stateY = short ? 120 : 240;
    this.layoutStates(pad, stateY, w - pad * 2, this.panelHeight - stateY - 4, 2);
  }

  private renderCapsule(w: number, h: number): void {
    const pad = PANEL_PADDING;
    const shallow = h < 132;
    const showAvatar = !shallow || h >= SHALLOW_AVATAR_MIN_HEIGHT;
    this.panelHeight = h;
    this.identityHeight = shallow ? h : 56;
    this.identityWidth = shallow ? Math.min(w, showAvatar ? 200 : 132) : w;
    this.drawPlate(w, h);
    this.avatarCx = pad + AVATAR_DIAMETER / 2;
    this.avatarCy = shallow && showAvatar ? Math.min(46, h / 2) : 32;
    this.avatarDia = AVATAR_DIAMETER;
    this.drawAvatar(this.avatarCx, this.avatarCy, this.avatarDia, showAvatar);
    if (shallow) {
      let statusX = pad;
      if (showAvatar) {
        const contentX = pad + AVATAR_DIAMETER + 12;
        statusX = contentX;
        this.layoutIdentity(
          contentX,
          5,
          Math.max(1, this.identityWidth - contentX - pad),
          false,
          h - 16,
        );
        this.nameText.position.set(this.avatarCx - this.nameText.width / 2, 5);
        this.layoutLife(contentX, this.avatarCy, false);
        this.life.anchor.set(0, 0.5);
        this.makeHandItem(30).place(contentX, h - 32);
      } else {
        const lifeX = this.identityWidth - 4;
        this.layoutIdentity(pad, 7, this.identityWidth - pad * 2, false, h - 16);
        this.layoutLife(lifeX, 32, false);
        this.makeHandItem(30).place(pad, 32);
      }
      this.priorityText.position.x =
        statusX + (this.seatState.text ? this.seatState.width + 12 : 0);
      this.heart.visible = false;
      const utilityTop = h - 28;
      const utilityHeight = 20;
      const detailsRect: LayoutRect = this.spec.isSelf
        ? { x: pad + 24, y: utilityTop, width: 24, height: utilityHeight }
        : { x: pad, y: utilityTop, width: AVATAR_DIAMETER, height: utilityHeight };
      if (this.spec.isSelf) this.layoutGear(pad + 10, utilityTop + utilityHeight / 2, 10);
      const manaRight = w - SHALLOW_RESOURCE_RIGHT_INSET;
      const manaX = showAvatar
        ? this.identityWidth - SHALLOW_RESOURCE_IDENTITY_OVERLAP
        : this.identityWidth;
      const manaY = h < 80 ? 14 : 20;
      this.layoutMana(manaX, manaY, Math.max(1, manaRight - manaX), 6, 20);
      const stateBottom = h - 10;
      const stateY = Math.max(h < 80 ? 24 : 36, stateBottom - SHALLOW_STATE_BLOCK_HEIGHT);
      this.layoutStates(
        manaX,
        stateY,
        Math.max(1, manaRight - manaX),
        Math.max(1, stateBottom - stateY),
        3,
        detailsRect,
      );
      this.avatarHit
        .clear()
        .rect(0, 0, this.identityWidth, h)
        .fill({ color: hexToNum(this.theme.gameTheme.canvas.background), alpha: 0.001 });
      return;
    }
    const lifeX = w - 42;
    const identityX = pad + AVATAR_DIAMETER + 10;
    this.layoutIdentity(identityX, 12, lifeX - identityX - 58, false);
    this.layoutLife(lifeX, 29, false);
    this.heart.visible = true;
    this.heart.text = "LIFE";
    this.heart.style = this.styled(8, "600", this.theme.gameTheme.textMuted);
    this.heart.anchor.set(1, 0.5);
    this.heart.position.set(lifeX, 49);
    this.makeHandItem(32).place(pad, this.compact ? 70 : 67);
    const zones = this.spec.badges
      .map((badge, index) => ({ badge, index }))
      .filter(({ badge }) => badge.zone);
    this.ensureChips();
    const zoneWidth = (w - pad * 2 - 60) / Math.max(1, zones.length);
    for (let i = 0; i < zones.length; i++) {
      this.placeBadge(zones[i]!.index, pad + 60 + i * zoneWidth, 50, zoneWidth, 40, false);
    }
    this.layoutMana(pad, this.compact ? 103 : 90, w - pad * 2, 6, 24);
    const stateY = this.compact ? 122 : 110;
    this.layoutStates(pad, stateY, w - pad * 2, h - stateY - 6, 3);
  }

  private drawPlate(width: number, height: number): void {
    const { appTheme, gameTheme: gt } = this.theme;
    const plateY = this.edgeDock === "top" ? -8 : 0;
    const plateHeight = height + (this.edgeDock ? 8 : 0);
    this.bg.roundRect(0, plateY, width, plateHeight, 8);
    this.bg.fill({ color: hexToNum(appTheme.card) });
    this.bg.roundRect(0.5, plateY + 0.5, width - 1, plateHeight - 1, 8);
    this.bg.stroke({ color: hexToNum(appTheme.border), alpha: 0.7, width: 1 });
    this.seatRail.roundRect(0, 10, 3, Math.max(12, this.identityHeight - 20), 1.5);
    this.seatRail.fill({
      color: hexToNum(this.spec.color),
      alpha: this.spec.isActiveTurn ? 1 : 0.35,
    });
    if (this.spec.isSelectedTarget) {
      this.bg.roundRect(1, 1, this.identityWidth - 2, this.identityHeight - 2, 7);
      this.bg.stroke({ color: hexToNum(gt.promptAction.attackAction), alpha: 1, width: 2 });
    }
    this.extendContent(0, 0, width, height);
  }

  private layoutLife(x: number, y: number, centered: boolean): void {
    this.lifeFontSize = this.compact ? 28 : 32;
    this.life.style = this.textStyle(this.lifeFontSize, "800");
    this.life.anchor.set(centered ? 0.5 : 1, 0.5);
    this.life.position.set(x, y);
  }

  private layoutIdentity(
    x: number,
    y: number,
    width: number,
    column: boolean,
    statusY = y + 19,
  ): void {
    const gt = this.theme.gameTheme;
    this.nameText.style = this.styled(12, "700", gt.textOnTinted);
    this.nameText.text = this.spec.name;
    while (this.nameText.width > width && this.nameText.text.length > 2) {
      this.nameText.text = `${this.nameText.text.replace(/…$/, "").slice(0, -1)}…`;
    }
    this.nameText.position.set(column ? x + (width - this.nameText.width) / 2 : x, y);
    this.seatState.text = this.spec.isEliminated
      ? "Eliminated"
      : this.spec.isDisconnected
        ? "Offline"
        : this.spec.isActiveTurn
          ? "Turn"
          : "";
    this.seatState.style = this.styled(
      10,
      "700",
      this.spec.isEliminated || this.spec.isDisconnected ? gt.pt.lethal : this.spec.color,
    );
    this.seatState.position.set(x, statusY);
    this.priorityText.visible = this.spec.isPriorityPlayer && !this.spec.isEliminated;
    this.priorityText.style = this.styled(10, "700", gt.activeAction.priority);
    this.priorityText.position.set(x + width - this.priorityText.width, statusY);
  }

  private makeHandItem(unit: number): ContentItem {
    const count = this.spec.badges.find((badge) => badge.id === "hand")?.count ?? 0;
    const height = Math.round(unit * 0.42);
    const width = height * 0.71;
    this.handCount.text = String(count);
    this.handCount.style = this.styled(
      Math.max(12, Math.round(unit * 0.28)),
      "700",
      this.theme.gameTheme.textOnTinted,
    );
    const fanWidth = width + 10;
    for (let i = 0; i < this.handBacks.length; i++) {
      const back = this.handBacks[i]!;
      back.width = width;
      back.height = height;
      back.visible = i < count;
      back.position.set(width / 2 + i * 5, height / 2);
    }
    return {
      w: fanWidth + 5 + this.handCount.width,
      place: (x, y) => {
        this.handFan.position.set(x, y);
        this.handFan.visible = count > 0;
        this.handCount.position.set(x + fanWidth + 5, y);
      },
    };
  }

  private layoutMana(
    x: number,
    y: number,
    width: number,
    columns: number,
    rowHeight: number,
  ): void {
    this.ensurePips();
    const gt = this.theme.gameTheme;
    const cellWidth = width / columns;
    const size = Math.min(18, rowHeight - 4);
    const rows = Math.ceil(MANA_LETTERS.length / columns);
    this.manaTray
      .roundRect(
        x - TRAY_HORIZONTAL_PADDING,
        y - rowHeight / 2 - TRAY_VERTICAL_PADDING,
        width + TRAY_HORIZONTAL_PADDING * 2,
        rows * rowHeight + TRAY_VERTICAL_PADDING * 2,
        TRAY_RADIUS,
      )
      .fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.38 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), alpha: 0.65, width: 1 });
    for (let i = 0; i < MANA_LETTERS.length; i++) {
      const letter = MANA_LETTERS[i]!;
      const pip = this.pips[i]!;
      const value = this.spec.manaPool[letter] ?? 0;
      const left = x + (i % columns) * cellWidth;
      const cy = y + Math.floor(i / columns) * rowHeight;
      const texture = this.manaTexture(letter);
      if (texture) pip.sprite.texture = texture;
      const active = value > 0;
      pip.sprite.visible = pip.count.visible = true;
      pip.sprite.width = pip.sprite.height = size;
      pip.sprite.position.set(left, cy - size / 2);
      pip.sprite.alpha = active ? 1 : 0.24;
      pip.count.text = String(value);
      pip.count.style = this.styled(12, "700", active ? gt.textOnTinted : gt.textGhost);
      pip.count.alpha = active ? 1 : 0.65;
      pip.count.scale.set(1);
      pip.count.scale.x = Math.min(1, Math.max(1, cellWidth - size - 6) / pip.count.width);
      pip.count.position.set(left + size + 4, cy);
      pip.flash
        .clear()
        .roundRect(left - 2, cy - rowHeight / 2, cellWidth - 2, rowHeight, 4)
        .fill({ color: hexToNum(gt.activeAction.priority) });
      if (pip.value !== undefined && pip.value !== value && this.motionEnabled) {
        gsap.killTweensOf(pip.flash);
        gsap.fromTo(pip.flash, { alpha: 0.35 }, { alpha: 0, duration: 0.55, ease: "power1.out" });
      }
      pip.value = value;
    }
  }

  private badgeIsUrgent(badge: PlayerHudSpec["badges"][number]): boolean {
    return (
      !!badge.lethal ||
      badge.id === "extra-turn" ||
      badge.id === "controlled-player" ||
      badge.id === "damage-prevention" ||
      (badge.id === "poison" && (badge.count ?? 0) >= 8) ||
      (badge.id.startsWith("cmd-") && (badge.count ?? 0) >= 18)
    );
  }

  private badgeIsGlanceworthy(badge: PlayerHudSpec["badges"][number]): boolean {
    return this.badgeIsUrgent(badge) || badge.id === "monarch" || badge.id === "initiative";
  }

  private placeBadge(
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
    showLabel: boolean,
  ): void {
    const gt = this.theme.gameTheme;
    const badge = this.spec.badges[index]!;
    const urgent = this.badgeIsUrgent(badge);
    const chip = this.chips[index]!;
    const size = 16;
    const cy = y + height / 2;
    const texture = this.iconTexture(badge.icon);
    if (texture) chip.sprite.texture = texture;
    chip.sprite.tint = hexToNum(badge.color);
    chip.sprite.width = chip.sprite.height = size;
    chip.sprite.position.set(x + 4, cy - size / 2);
    chip.sprite.visible = chip.hit.visible = true;
    chip.badgeId = badge.id;
    chip.content = this.badgeTooltip(badge);
    chip.hit
      .clear()
      .roundRect(0, 0, width - 3, height - 2, 4)
      .fill({
        color: hexToNum(urgent ? gt.pt.lethal : gt.textGhost),
        alpha: urgent ? 0.16 : 0.04,
      });
    chip.hit.position.set(x, y + 1);
    chip.count.visible = badge.count !== undefined;
    chip.count.text = badge.count === undefined ? "" : String(badge.count);
    chip.count.style = this.styled(12, "700", urgent ? gt.pt.lethal : gt.textOnTinted);
    chip.count.scale.set(1);
    chip.count.scale.x = Math.min(
      1,
      Math.max(1, width - size - 12) / Math.max(1, chip.count.width),
    );
    chip.count.position.set(x + width - 8, cy);
    const labelWidth = width - size - 14 - (chip.count.visible ? chip.count.width + 4 : 0);
    chip.label.visible = showLabel && labelWidth >= 24;
    if (chip.label.visible) {
      chip.label.text = badge.id.startsWith("cmd-") ? "Cmd dmg" : badge.label;
      chip.label.style = this.styled(10, "500", gt.textMuted);
      while (chip.label.width > labelWidth && chip.label.text.length > 2) {
        chip.label.text = `${chip.label.text.replace(/…$/, "").slice(0, -1)}…`;
      }
      chip.label.position.set(x + size + 8, cy);
    }
  }

  private layoutStates(
    x: number,
    y: number,
    width: number,
    height: number,
    columns: number,
    overflowRect?: LayoutRect,
  ): void {
    this.ensureChips();
    const rowHeight = this.compact ? STATE_TOUCH_ROW_HEIGHT : STATE_ROW_HEIGHT;
    const rows = Math.max(1, Math.min(3, Math.floor(height / rowHeight)));
    const cellHeight = Math.min(rowHeight, height / rows);
    const cellWidth = width / columns;
    this.stateTray
      .roundRect(
        x - TRAY_HORIZONTAL_PADDING,
        y - TRAY_VERTICAL_PADDING,
        width + TRAY_HORIZONTAL_PADDING * 2,
        rows * cellHeight + TRAY_VERTICAL_PADDING * 2,
        TRAY_RADIUS,
      )
      .fill({ color: hexToNum(this.theme.gameTheme.canvas.shadow), alpha: 0.26 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), alpha: 0.5, width: 1 });
    const rank = (id: string) => {
      const index = STATE_ORDER.indexOf(id.startsWith("cmd-") ? "commander" : id);
      return index < 0 ? STATE_ORDER.length : index;
    };
    const allStates = this.spec.badges
      .map((badge, index) => ({ badge, index }))
      .filter(({ badge }) => badge.id !== "hand" && !badge.zone)
      .sort(
        (a, b) =>
          Number(this.badgeIsUrgent(b.badge)) - Number(this.badgeIsUrgent(a.badge)) ||
          rank(a.badge.id) - rank(b.badge.id) ||
          a.badge.id.localeCompare(b.badge.id),
      );
    const states = this.column
      ? allStates.filter(({ badge }) => this.badgeIsGlanceworthy(badge)).slice(0, 2)
      : allStates;
    this.emptyStateText.visible = allStates.length === 0 && width >= 160;
    if (this.emptyStateText.visible) {
      this.emptyStateText.style = this.styled(10, "500", this.theme.gameTheme.textMuted);
      this.emptyStateText.position.set(x + 8, y + (rows * cellHeight) / 2);
    }
    const capacity = rows * columns - (overflowRect ? 0 : 1);
    const visible = Math.min(states.length, capacity);
    for (let i = 0; i < visible; i++) {
      this.placeBadge(
        states[i]!.index,
        x + (i % columns) * cellWidth,
        y + Math.floor(i / columns) * cellHeight,
        cellWidth,
        cellHeight,
        cellWidth >= 80,
      );
    }
    const hidden = allStates.length - visible;
    const visibleIds = new Set(states.slice(0, visible).map(({ badge }) => badge.id));
    const danger = allStates.some(
      ({ badge }) => !visibleIds.has(badge.id) && this.badgeIsUrgent(badge),
    );
    const slot = this.column ? Math.min(rows * columns - 1, visible) : rows * columns - 1;
    this.placeOverflow(
      overflowRect ?? {
        x: x + (slot % columns) * cellWidth,
        y: y + Math.floor(slot / columns) * cellHeight,
        width: cellWidth,
        height: cellHeight,
      },
      hidden,
      danger,
    );
  }

  private placeOverflow(rect: LayoutRect, hidden: number, danger: boolean): void {
    const compact = rect.width < 48;
    const showIcon = hidden === 0 && compact;
    this.detailsIcon.visible = showIcon;
    if (showIcon) {
      const texture = this.iconTexture(DETAILS_ICON_NAME);
      if (texture) this.detailsIcon.texture = texture;
      this.detailsIcon.tint = hexToNum(this.theme.gameTheme.textMuted);
      this.detailsIcon.width = this.detailsIcon.height = 12;
      this.detailsIcon.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    this.overflow.text =
      hidden > 0
        ? compact
          ? `+${hidden}`
          : rect.width < 70
            ? `+${hidden}\nstates`
            : `+${hidden} states`
        : "Details";
    this.overflow.style = this.styled(
      10,
      danger ? "700" : "500",
      danger ? this.theme.gameTheme.pt.lethal : this.theme.gameTheme.textMuted,
    );
    this.overflow.position.set(
      rect.x + (rect.width - this.overflow.width) / 2,
      rect.y + rect.height / 2,
    );
    this.overflow.visible = !showIcon;
    this.overflowHit.visible = true;
    this.overflowHit.roundRect(rect.x, rect.y, rect.width, rect.height, 5).fill({
      color: hexToNum(danger ? this.theme.gameTheme.pt.lethal : this.theme.gameTheme.textGhost),
      alpha: danger ? 0.16 : 0.08,
    });
  }

  private applyLifeAnim(): void {
    const next = this.spec.life;
    this.life.text = String(next);
    if (this.column || !this.motionEnabled) {
      this.lifeTween?.kill();
      gsap.killTweensOf(this.life.scale);
      this.life.scale.set(1);
      this.renderedLife = next;
      return;
    }
    if (this.renderedLife !== null && next !== this.renderedLife) {
      const gt = this.theme.gameTheme;
      const gained = next > this.renderedLife;
      const delta = next - this.renderedLife;
      const flash = gained ? gt.pt.buffed : gt.pt.lethal;
      this.lifeTween?.kill();
      const counter = { v: this.renderedLife };
      this.lifeTween = gsap.to(counter, {
        v: next,
        duration: 0.5,
        ease: "power1.out",
        onUpdate: () => {
          if (!this.life.destroyed) this.life.text = String(Math.round(counter.v));
        },
        onComplete: () => {
          if (!this.life.destroyed) this.life.text = String(next);
        },
      });
      this.life.style = this.styled(this.lifeFontSize, "800", flash);
      gsap.killTweensOf(this.life.scale);
      gsap.fromTo(
        this.life.scale,
        { x: 1.3, y: 1.3 },
        { x: 1, y: 1, duration: 0.45, ease: "back.out(2)" },
      );
      gsap.delayedCall(0.55, () => {
        if (!this.life.destroyed) this.life.style = this.textStyle(this.lifeFontSize, "800");
      });
      this.floatLifeDelta(delta, flash);
      if (!gained) this.washDamage();
    }
    this.renderedLife = next;
  }

  private washDamage(): void {
    const gt = this.theme.gameTheme;
    const r = this.avatarDia / 2;
    this.damageWash.clear();
    this.damageWash.circle(this.avatarCx, this.avatarCy, r);
    this.damageWash.fill({ color: hexToNum(gt.pt.lethal), alpha: 0.55 });
    this.damageWash.visible = true;
    gsap.killTweensOf(this.damageWash);
    gsap.fromTo(
      this.damageWash,
      { alpha: 1 },
      {
        alpha: 0,
        duration: 0.55,
        ease: "power1.out",
        onComplete: () => {
          if (!this.damageWash.destroyed) this.damageWash.visible = false;
        },
      },
    );
  }

  private applyTargetable(): void {
    const on = this.spec.isTargetable && !this.spec.isSelectedTarget;
    if (on === this.targetableActive) {
      if (on) this.drawTargetRing();
      return;
    }
    this.targetableActive = on;
    if (on) {
      this.drawTargetRing();
      this.targetRing.visible = true;
      if (!this.motionEnabled) {
        this.targetRing.alpha = 1;
        return;
      }
      this.targetTween = gsap.fromTo(
        this.targetRing,
        { alpha: 0.55 },
        { alpha: 1, duration: 0.75, ease: "sine.inOut", repeat: -1, yoyo: true },
      );
    } else {
      this.targetTween?.kill();
      this.targetTween = null;
      this.targetRing.visible = false;
      this.targetRing.clear();
    }
  }

  private drawTargetRing(): void {
    this.targetRing.clear();
    this.targetRing.roundRect(1, 1, this.identityWidth - 2, this.identityHeight - 2, 7);
    this.targetRing.stroke({
      color: hexToNum(this.theme.gameTheme.promptAction.attackAction),
      width: 2,
      alpha: 1,
    });
  }

  private applyFlash(): void {
    const flashing = this.spec.isFlashing;
    if (!this.motionEnabled) {
      this.flashRing.clear();
      this.flashRing.visible = flashing;
      this.flashRing.alpha = 1;
      if (flashing) {
        this.flashRing.circle(this.avatarCx, this.avatarCy, this.avatarDia / 2 + 4);
        this.flashRing.stroke({ color: hexToNum(this.spec.color), width: 2, alpha: 0.8 });
      }
      this.prevFlashing = flashing;
      return;
    }
    if (flashing && !this.prevFlashing && this.motionEnabled) {
      const r = this.avatarDia / 2;
      this.flashRing.clear();
      this.flashRing.circle(this.avatarCx, this.avatarCy, r);
      this.flashRing.stroke({ color: hexToNum(this.spec.color), width: 3, alpha: 1 });
      this.flashRing.visible = true;
      this.flashTween?.kill();
      this.flashTween = gsap.fromTo(
        this.flashRing,
        { alpha: 1 },
        {
          alpha: 0,
          duration: 0.6,
          ease: "power2.out",
          repeat: 1,
          yoyo: true,
          onComplete: () => {
            if (!this.flashRing.destroyed) this.flashRing.visible = false;
          },
        },
      );
    }
    this.prevFlashing = flashing;
  }

  private floatLifeDelta(delta: number, color: string): void {
    if (this.column) return;
    this.lifeFloat.text = delta > 0 ? `+${delta}` : String(delta);
    this.lifeFloat.style = this.styled(Math.round(this.avatarDia * 0.42), "900", color);
    this.lifeFloat.visible = true;
    gsap.killTweensOf(this.lifeFloat);
    gsap.fromTo(
      this.lifeFloat,
      { alpha: 1, x: this.life.x - this.life.width * (this.life.anchor.x - 0.5), y: this.life.y },
      {
        alpha: 0,
        y: this.life.y - this.avatarDia * 0.8,
        duration: 0.9,
        ease: "power1.out",
        onComplete: () => {
          if (!this.lifeFloat.destroyed) this.lifeFloat.visible = false;
        },
      },
    );
  }

  private applyPriority(): void {
    this.glow.visible = this.priorityText.visible;
    this.drawGlow();
  }

  private drawGlow(): void {
    this.glow.clear();
    if (!this.priorityText.visible) return;
    const color = hexToNum(this.theme.gameTheme.activeAction.priority);
    const x = this.priorityText.x - 6;
    const y = this.priorityText.y + 5;
    this.glow.circle(x, y, 3);
    this.glow.fill({ color });
    this.glow.moveTo(x + 5, y).lineTo(this.priorityText.x + this.priorityText.width, y);
    this.glow.stroke({ color, width: 1.5, alpha: 0.7 });
  }

  private applyCombatGlow(): void {
    const lethal = this.spec.combatLethal;
    if (this.spec.inCombat === this.combatActive && lethal === this.combatLethalActive) {
      if (this.combatActive) this.drawCombatGlow();
      return;
    }
    this.combatActive = this.spec.inCombat;
    this.combatLethalActive = lethal;
    this.combatPulse?.kill();
    this.combatPulse = null;
    if (this.combatActive) {
      this.drawCombatGlow();
      this.combatGlow.visible = true;
      this.combatGlow.alpha = 1;
      if (!this.motionEnabled) return;
      this.combatPulse = gsap.to(this.combatGlow, {
        alpha: lethal ? 0.7 : 0.5,
        duration: lethal ? 0.4 : 0.9,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    } else {
      this.combatGlow.visible = false;
      this.combatGlow.clear();
    }
  }

  private drawCombatGlow(): void {
    this.combatGlow.clear();
    const r = this.avatarDia / 2;
    const red = hexToNum(this.theme.gameTheme.pt.lethal);
    const layers = this.combatLethalActive
      ? [
          { rr: r + 8, w: 10, a: 0.25 },
          { rr: r + 3, w: 6, a: 0.6 },
          { rr: r, w: 3, a: 1 },
        ]
      : [
          { rr: r + 5, w: 7, a: 0.18 },
          { rr: r + 2, w: 4, a: 0.45 },
          { rr: r, w: 2, a: 0.95 },
        ];
    for (const layer of layers) {
      this.combatGlow.circle(this.avatarCx, this.avatarCy, layer.rr);
      this.combatGlow.stroke({ color: red, width: layer.w, alpha: layer.a });
    }
  }

  destroy(): void {
    this.combatPulse?.kill();
    this.targetTween?.kill();
    this.flashTween?.kill();
    this.lifeTween?.kill();
    this.offlineTween?.kill();
    gsap.killTweensOf(this.combatGlow);
    gsap.killTweensOf(this.life.scale);
    gsap.killTweensOf(this.lifeFloat);
    gsap.killTweensOf(this.glow);
    gsap.killTweensOf(this.damageWash);
    for (const pip of this.pips) gsap.killTweensOf(pip.flash);
    for (const chip of this.chips) gsap.killTweensOf(chip.sprite);
    for (const dot of this.sparkles.children) gsap.killTweensOf(dot);
    this.onHover(null);
    this.container.destroy({ children: true });
  }
}
