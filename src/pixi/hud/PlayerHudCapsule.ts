import {
  Bounds,
  ColorMatrixFilter,
  Container,
  Graphics,
  Point,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextStyle,
} from "pixi.js";
import gsap from "gsap";
import type { Theme } from "@/hooks/useTheme";
import { MANA_LETTERS } from "@/themes/gameTheme";
import { getInitials } from "@/components/game/game.utils";
import { hexToNum } from "../colorUtils";
import { gameIconTexture } from "../gameIconCache";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "../manaSymbolCache";
import { loadAvatarTexture } from "./avatarTextureCache";
import type { PlayerHudSpec, PlayerHudTooltipContent } from "./playerHud.types";
import type { ScreenBounds, ScreenPos } from "@/pixi/types";
import { RING_ABILITIES, zoneBadgeId } from "@/components/game/game.constants";

const BOT_ICON_NAME = "robot-antennas";
const SKULL_ICON_NAME = "skull-crossed-bones";
const OFFLINE_ICON_NAME = "aerial-signal";
const GEAR_ICON_NAME = "cog";
const FONT = "Inter, system-ui, -apple-system, sans-serif";
const BADGE_TAP_HIT_PAD_X = 8;
const BADGE_TAP_HIT_PAD_Y = 3;

/** Avatar circle diameter — fixed so it's identical in the expanded capsule and
 *  the collapsed column (the collapsed band caps it if narrower). */
const AVATAR_DIAMETER = 56;

/** Collapsed column's avatar top inset — keeps the avatar's field-y the same as
 *  the expanded capsule (its container sits at `PLAYER_HUD_TOP_MARGIN_PX` (8) +
 *  the capsule's 2px avatar pad), so the two states stay vertically aligned. */
const COLUMN_AVATAR_TOP = 10;

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
      dropShadow: { color: 0x000000, alpha: 0.55, blur: 3, distance: 1, angle: Math.PI / 2 },
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

interface ManaPip {
  sprite: Sprite;
  count: Text;
}

interface BadgeChip {
  sprite: Sprite;
  count: Text;
  content: PlayerHudTooltipContent;
  badgeId?: string;
}

interface ContentItem {
  w: number;
  place: (x: number, y: number) => void;
}

/** A single player's HUD: a minimal pill with the avatar as a left-edge cap,
 *  the life total, the floating mana pool, and any active player/game badges.
 *  When its field collapses to a narrow band it reflows into a **full-height
 *  vertical stack** (avatar + life + badges + mana) so all the info stays
 *  visible. Owns its own gsap tweens (life pop + floating delta, priority pulse,
 *  badge fade). */
export class PlayerHudCapsule {
  readonly container: Container;
  private theme: Theme;
  private onTarget: () => void;
  private onShowSheet: () => void;
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
  private lifePill = new Graphics();
  private bot = new Sprite();
  private skull = new Sprite();
  private offline = new Sprite();
  private gear = new Sprite();
  private gearHit = new Graphics();
  private initial: Text;
  private avatarHit = new Graphics();
  private heart: Text;
  private life: Text;
  private lifeFloat: Text;
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
  private avatarUrl: string | null = null;
  private readonly isBot: boolean;
  private renderedLife: number | null = null;
  private pulse: gsap.core.Tween | null = null;
  private priorityActive = false;
  private targetableActive = false;
  private targetTween: gsap.core.Tween | null = null;
  private flashTween: gsap.core.Tween | null = null;
  private lifeTween: gsap.core.Tween | null = null;
  private offlineTween: gsap.core.Tween | null = null;
  private offlineActive = false;
  private tapTooltipTimer: number | null = null;
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
  ) {
    this.theme = theme;
    this.spec = spec;
    this.isBot = spec.isBot;
    this.onTarget = onTarget;
    this.onShowSheet = onShowSheet;
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
    this.lifePill.eventMode = "none";
    this.bot.anchor.set(0.5);
    this.bot.visible = false;
    this.skull.anchor.set(0.5);
    this.skull.visible = false;
    this.offline.anchor.set(0.5);
    this.offline.visible = false;
    this.gear.anchor.set(0.5);
    this.gear.visible = false;
    this.gear.eventMode = "none";
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
    this.heart = new Text({ text: "♥", style: this.heartStyle(14) });
    this.heart.anchor.set(0, 0.5);
    this.life = new Text({ text: String(spec.life), style: this.textStyle(15) });
    this.life.anchor.set(0, 0.5);
    this.lifeFloat = new Text({ text: "", style: this.textStyle(16) });
    this.lifeFloat.anchor.set(0.5);
    this.lifeFloat.visible = false;

    this.container.addChild(
      this.glow,
      this.bg,
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
      this.lifePill,
      this.heart,
      this.life,
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
    return { title: badge.label };
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

  setScale(scale: number): void {
    if (this.container.scale.x === scale) return;
    this.container.scale.set(scale);
    this.lastSig = "";
    this.render();
  }

  setRect(x: number, y: number, width: number, height: number, column: boolean): void {
    this.container.position.set(x, y);
    if (this.width === width && this.height === height && this.column === column) return;
    this.width = width;
    this.height = height;
    this.column = column;
    this.render();
  }

  private textStyle(size: number, weight: TextStyle["fontWeight"] = "700"): TextStyle {
    return cachedTextStyle(size, weight, hexToNum(this.theme.gameTheme.textOnTinted));
  }

  private heartStyle(size: number): TextStyle {
    return cachedTextStyle(size, "900", hexToNum(this.theme.gameTheme.life));
  }

  private styled(size: number, weight: TextStyle["fontWeight"], fill: string): TextStyle {
    return cachedTextStyle(size, weight, hexToNum(fill));
  }

  private updateAvatarTexture(url: string | undefined): void {
    if (!url || url === this.avatarUrl) return;
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

  private drawAvatar(cx: number, cy: number, diameter: number): void {
    const gt = this.theme.gameTheme;
    const r = diameter / 2;
    const hasImage = !!this.avatarTex;

    this.bg.circle(cx, cy, r);
    this.bg.fill({ color: hexToNum(gt.canvas.background), alpha: 0.95 });

    // The photo is a masked Sprite (cover-fit), not a Graphics texture fill —
    // Pixi v8 fills the shape with a *repeating* pattern, which tiled the avatar.
    this.avatarFx.clear();
    this.avatarPhoto.visible = hasImage;
    if (hasImage) {
      const tex = this.avatarTex!;
      const tw = tex.width || diameter;
      const th = tex.height || diameter;
      const cover = diameter / Math.min(tw, th);
      this.avatarPhoto.texture = tex;
      this.avatarPhoto.width = tw * cover;
      this.avatarPhoto.height = th * cover;
      this.avatarPhoto.position.set(cx, cy);
      this.avatarMask.clear();
      this.avatarMask.circle(cx, cy, r);
      this.avatarMask.fill({ color: 0xffffff });
    }

    this.avatarFx.circle(cx, cy, r - 0.5);
    this.avatarFx.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.25 });

    // Targetable draws a pulsing ring in `targetRing`. The static ring here:
    // selected-target, then priority (same priority colour as the pass-button
    // border — `activeAction.priority`), then the active-turn seat colour.
    const accent = this.spec.isSelectedTarget
      ? { c: gt.promptAction.attackAction, w: 2.5, a: 1 }
      : this.spec.isPriorityPlayer
        ? { c: gt.activeAction.priority, w: 2.5, a: 1 }
        : this.spec.isActiveTurn
          ? { c: this.spec.color, w: 1.5, a: 1 }
          : null;
    if (accent) {
      this.avatarFx.circle(cx, cy, r - accent.w / 2);
      this.avatarFx.stroke({ color: hexToNum(accent.c), width: accent.w, alpha: accent.a });
    }

    const showBot = !hasImage && this.isBot;
    const showInitial = !hasImage && !this.isBot;

    this.bot.visible = showBot;
    if (showBot) {
      const tex = this.iconTexture(BOT_ICON_NAME);
      if (tex) this.bot.texture = tex;
      this.bot.tint = hexToNum(gt.textMuted);
      this.bot.width = diameter * 0.56;
      this.bot.height = diameter * 0.56;
      this.bot.position.set(cx, cy);
    }

    this.initial.visible = showInitial;
    if (showInitial) {
      this.initial.text = getInitials(this.spec.name);
      this.initial.style = this.textStyle(Math.round(diameter * 0.36), "800");
      this.initial.position.set(cx, cy);
    }

    // Eliminated → skull over the avatar; disconnected → a small offline glyph
    // pinned to the top-right.
    this.skull.visible = this.spec.isEliminated;
    if (this.spec.isEliminated) {
      const tex = this.iconTexture(SKULL_ICON_NAME);
      if (tex) this.skull.texture = tex;
      this.skull.tint = hexToNum(gt.textOnTinted);
      this.skull.width = diameter * 0.6;
      this.skull.height = diameter * 0.6;
      this.skull.position.set(cx, cy);
    }
    this.offline.visible = this.spec.isDisconnected && !this.spec.isEliminated;
    if (this.offline.visible) {
      const ox = cx + r * 0.4;
      const oy = cy - r * 0.55;
      const chipR = diameter * 0.3;
      this.avatarFx.circle(ox, oy, chipR);
      this.avatarFx.fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.95 });
      this.avatarFx.circle(ox, oy, chipR);
      this.avatarFx.stroke({ color: hexToNum(gt.promptAction.cancel), width: 1.5, alpha: 0.9 });
      const tex = this.iconTexture(OFFLINE_ICON_NAME);
      if (tex) this.offline.texture = tex;
      this.offline.tint = hexToNum(gt.promptAction.cancel);
      this.offline.width = diameter * 0.42;
      this.offline.height = diameter * 0.42;
      this.offline.position.set(ox, oy);
      this.extendContent(ox - chipR, oy - chipR, chipR * 2, chipR * 2);
    }

    this.avatarHit.clear();
    this.avatarHit.circle(cx, cy, r);
    this.avatarHit.fill({ color: 0xffffff, alpha: 0.001 });
    this.avatarHit.cursor = "pointer";

    // Self only: a small gear on a chip at the avatar's top-left that opens the
    // board menu (fullscreen / dev panel / concede).
    this.gear.visible = this.spec.isSelf;
    this.gearHit.visible = this.spec.isSelf;
    if (this.spec.isSelf) {
      this.gearCx = cx - r * 0.78;
      this.gearCy = cy - r * 0.58;
      this.gearChipR = diameter * 0.2;
      this.redrawGearChip();
      const tex = this.iconTexture(GEAR_ICON_NAME);
      if (tex) this.gear.texture = tex;
      this.gear.position.set(this.gearCx, this.gearCy);
      this.styleGear();
      this.extendContent(
        this.gearCx - this.gearChipR,
        this.gearCy - this.gearChipR,
        this.gearChipR * 2,
        this.gearChipR * 2,
      );
    }
  }

  /** The gear's chip backing — doubles as the click/hover hit area. Brightens on
   *  hover so it reads as a button. */
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

  /** Gear size + tint, with a hover state so it reads as a clickable button. */
  private styleGear(): void {
    const gt = this.theme.gameTheme;
    const base = this.avatarDia * 0.22;
    const size = this.gearHovered ? base * 1.18 : base;
    this.gear.width = size;
    this.gear.height = size;
    this.gear.tint = hexToNum(this.gearHovered ? gt.activeAction.active : gt.textMuted);
  }

  private ensurePips(n: number): void {
    while (this.pips.length < n) {
      const sprite = new Sprite();
      const count = new Text({ text: "", style: this.textStyle(11) });
      count.anchor.set(0, 0.5);
      this.manaLayer.addChild(sprite, count);
      this.pips.push({ sprite, count });
    }
    for (let i = n; i < this.pips.length; i++) {
      this.pips[i]!.sprite.visible = false;
      this.pips[i]!.count.visible = false;
    }
  }

  private ensureChips(n: number): void {
    while (this.chips.length < n) {
      const sprite = new Sprite();
      const count = new Text({ text: "", style: this.textStyle(11) });
      count.anchor.set(0, 0.5);
      this.badgeLayer.addChild(sprite, count);
      const chip: BadgeChip = { sprite, count, content: { title: "" } };
      sprite.eventMode = "static";
      sprite.cursor = "help";
      sprite.on("pointerover", () => {
        const s = sprite.height;
        this.emitHover(chip.content, sprite.x + sprite.width / 2, sprite.y, sprite.y + s);
      });
      sprite.on("pointerout", (e) => {
        if (e.pointerType !== "mouse" && this.tapTooltipTimer !== null) return;
        this.onHover(null);
      });
      sprite.on("pointertap", (e) => {
        // Collapsed column: chips cover most of the banner, and the banner tap
        // gesture belongs to tap-to-focus/tap-to-target — same as the avatar.
        if (this.column) {
          this.onHover(null);
          if (this.spec.isTargetable) this.onTarget();
          else this.onShowSheet();
          return;
        }
        const onTap = this.spec.badges.find((b) => b.id === chip.badgeId)?.onTap;
        if (onTap) {
          this.onHover(null);
          onTap();
          return;
        }
        if (e.pointerType === "mouse") return;
        const s = sprite.height;
        this.emitHover(chip.content, sprite.x + sprite.width / 2, sprite.y, sprite.y + s);
        if (this.tapTooltipTimer !== null) window.clearTimeout(this.tapTooltipTimer);
        this.tapTooltipTimer = window.setTimeout(() => {
          this.tapTooltipTimer = null;
          this.onHover(null);
        }, 2500);
      });
      this.chips.push(chip);
    }
    for (let i = n; i < this.chips.length; i++) {
      this.chips[i]!.sprite.visible = false;
      this.chips[i]!.count.visible = false;
    }
  }

  private extendContent(x: number, y: number, w: number, h: number): void {
    this.contentBounds.addFrame(x, y, x + w, y + h);
  }

  /** The rendered footprint (avatar + gear/offline chrome, life pill, badge
   *  rows, zone column incl. tap pads) in canvas space, accumulated
   *  analytically at render time — transient tween children (life float,
   *  sparkles, glows) are deliberately excluded so the battlefield keep-out
   *  doesn't breathe with animations. */
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
    this.lifePill.clear();
    if (this.column) {
      this.renderColumn(w, h);
      this.applyCombatGlow();
      this.checkBadgeSparkles();
      return;
    }
    this.renderCapsule(h);
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
    // A collapsed panel has a solid opaque backing — never dim the container or
    // the felt would show through it. The greyscale (eliminated) filter still
    // applies. Dimming is only a de-emphasis cue for the expanded capsule.
    if (this.column) {
      this.container.alpha = 1;
      return;
    }
    const inactiveOpp =
      !this.spec.isSelf &&
      !this.spec.isActiveTurn &&
      !this.spec.isPriorityPlayer &&
      !this.spec.isTargetable;
    this.container.alpha = eliminated
      ? 0.5
      : this.spec.isDisconnected
        ? 0.6
        : inactiveOpp
          ? 0.78
          : 1;
  }

  /** Burst a few sparkles when a "prestige" badge (monarch / initiative) is
   *  newly acquired this render. */
  private checkBadgeSparkles(): void {
    const ids = new Set(this.spec.badges.map((b) => b.id));
    for (const id of ["monarch", "initiative"]) {
      if (ids.has(id) && !this.prevBadgeIds.has(id)) {
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

  /** Collapsed/narrow field: a full-height vertical stack — avatar + life pill
   *  on top, then every badge and mana pip stacked down the column so all the
   *  player info is still visible in the sliver of space. */
  private renderColumn(w: number, h: number): void {
    const gt = this.theme.gameTheme;
    this.manaLayer.visible = true;
    this.badgeLayer.visible = true;
    this.glow.visible = false;
    this.damageWash.visible = false;
    this.flashRing.visible = false;
    this.targetTween?.kill();
    this.targetTween = null;
    this.targetableActive = false;
    this.targetRing.visible = false;

    const pad = 5;
    const cx = w / 2;
    const avatarD = Math.max(8, Math.min(w - pad * 2, AVATAR_DIAMETER));
    const avatarCy = COLUMN_AVATAR_TOP + avatarD / 2;
    this.avatarCx = cx;
    this.avatarCy = avatarCy;
    this.avatarDia = avatarD;
    this.drawAvatar(cx, avatarCy, avatarD);

    // Life pill straddling the avatar's bottom edge.
    this.lifeFontSize = Math.round(avatarD * 0.3);
    this.heart.style = this.heartStyle(Math.round(avatarD * 0.24));
    this.life.style = this.textStyle(this.lifeFontSize, "800");
    const padX = Math.round(avatarD * 0.12);
    const pillH = Math.round(avatarD * 0.32);
    const pillW = padX * 2 + this.heart.width + 3 + this.life.width;
    const pillLeft = cx - pillW / 2;
    const pillCy = avatarCy + avatarD / 2 - pillH * 0.25;
    this.lifePill.roundRect(pillLeft, pillCy - pillH / 2, pillW, pillH, pillH / 2);
    this.lifePill.fill({ color: hexToNum(gt.canvas.shadow) });
    this.lifePill.roundRect(
      pillLeft + 0.5,
      pillCy - pillH / 2 + 0.5,
      pillW - 1,
      pillH - 1,
      pillH / 2,
    );
    this.lifePill.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.25 });
    this.heart.position.set(pillLeft + padX, pillCy);
    this.life.position.set(this.heart.x + this.heart.width + 3, pillCy);
    this.extendContent(cx - avatarD / 2, avatarCy - avatarD / 2, avatarD, avatarD);
    this.extendContent(pillLeft, pillCy - pillH / 2, pillW, pillH);

    // Vertical stack of badges + mana, distributed down the remaining height.
    const present = MANA_LETTERS.filter((l) => (this.spec.manaPool[l] ?? 0) > 0);
    const badges = this.spec.badges;
    this.ensurePips(present.length);
    this.ensureChips(badges.length);
    const unit = Math.round(w * 0.52);
    const items: ContentItem[] = [];
    for (let i = 0; i < badges.length; i++) items.push(this.makeBadgeItem(i, unit));
    for (let i = 0; i < present.length; i++) items.push(this.makePipItem(i, present[i]!, unit));

    const top = pillCy + pillH / 2 + 6;
    const availH = h - top - pad;
    const rowH = items.length > 0 ? Math.min(Math.round(unit * 0.62), availH / items.length) : 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      it.place(cx - it.w / 2, top + i * rowH + rowH / 2);
      this.extendContent(cx - it.w / 2, top + i * rowH, it.w, rowH);
    }
  }

  private renderCapsule(h: number): void {
    const gt = this.theme.gameTheme;
    this.manaLayer.visible = true;
    this.badgeLayer.visible = true;

    const avatarD = AVATAR_DIAMETER;
    const avatarCx = avatarD / 2 + 2;
    const avatarCy = avatarD / 2 + 2;
    this.avatarCx = avatarCx;
    this.avatarCy = avatarCy;
    this.avatarDia = avatarD;
    this.drawAvatar(avatarCx, avatarCy, avatarD);
    this.extendContent(avatarCx - avatarD / 2, avatarCy - avatarD / 2, avatarD, avatarD);

    // Life pill straddling the avatar's bottom edge (MTGA-style).
    this.lifeFontSize = Math.round(avatarD * 0.32);
    this.heart.style = this.heartStyle(Math.round(avatarD * 0.26));
    this.life.style = this.textStyle(this.lifeFontSize, "800");
    const padX = Math.round(avatarD * 0.12);
    const pillH = Math.round(avatarD * 0.34);
    const pillW = padX * 2 + this.heart.width + 3 + this.life.width;
    const pillLeft = avatarCx - pillW / 2;
    const pillCy = avatarCy + avatarD / 2 - pillH * 0.3;
    this.lifePill.roundRect(pillLeft, pillCy - pillH / 2, pillW, pillH, pillH / 2);
    this.lifePill.fill({ color: hexToNum(gt.canvas.shadow) });
    this.lifePill.roundRect(
      pillLeft + 0.5,
      pillCy - pillH / 2 + 0.5,
      pillW - 1,
      pillH - 1,
      pillH / 2,
    );
    this.lifePill.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.25 });
    this.heart.position.set(pillLeft + padX, pillCy);
    this.life.position.set(this.heart.x + this.heart.width + 3, pillCy);
    this.extendContent(pillLeft, pillCy - pillH / 2, pillW, pillH);

    // Mana pips + badges flow to the right of the avatar and wrap into stacked
    // rows once they'd exceed the panel's max width, so a player with many
    // badges never bleeds into the hand. The row block is centred on the avatar.
    const gap = Math.max(5, Math.round(h * 0.14));
    const startX = avatarCx + avatarD / 2 + gap;
    this.layoutContent(startX, avatarCy, avatarD, gap);
  }

  private makePipItem(i: number, letter: string, unit: number): ContentItem {
    const pip = this.pips[i]!;
    const pipSize = Math.round(unit * 0.3);
    const tex = this.manaTexture(letter);
    if (tex) pip.sprite.texture = tex;
    pip.sprite.width = pipSize;
    pip.sprite.height = pipSize;
    pip.count.style = this.styled(Math.round(unit * 0.27), "700", this.theme.gameTheme.textMuted);
    pip.count.text = String(this.spec.manaPool[letter] ?? 0);
    return {
      w: pipSize + 2 + pip.count.width,
      place: (x, y) => {
        pip.sprite.visible = true;
        pip.count.visible = true;
        pip.sprite.position.set(x, y - pipSize / 2);
        pip.count.position.set(x + pipSize + 2, y);
      },
    };
  }

  private makeBadgeItem(i: number, unit: number): ContentItem {
    const gt = this.theme.gameTheme;
    const badge = this.spec.badges[i]!;
    const chip = this.chips[i]!;
    const badgeSize = Math.round(unit * 0.4);
    const tex = this.iconTexture(badge.icon);
    const wasHidden = !chip.sprite.visible;
    if (tex) chip.sprite.texture = tex;
    chip.sprite.tint = hexToNum(badge.color);
    chip.sprite.width = badgeSize;
    chip.sprite.height = badgeSize;
    chip.content = this.badgeTooltip(badge);
    chip.badgeId = badge.id;
    // Collapsed columns keep chips as plain badges: the banner's tap gesture
    // belongs to tap-to-focus, so zone chips must not open dialogs there.
    const tappable = !!badge.onTap && !this.column;
    chip.sprite.cursor = tappable ? "pointer" : "help";
    const hasCount = badge.count !== undefined;
    let w = badgeSize;
    if (hasCount) {
      chip.count.style = this.styled(
        Math.round(unit * 0.3),
        badge.lethal ? "800" : "700",
        badge.lethal ? gt.pt.lethal : gt.textMuted,
      );
      chip.count.text = String(badge.count);
      w += 1 + chip.count.width;
    }
    if (tappable && tex) {
      // Pads are screen px: the capsule scale would otherwise shrink them, and
      // the count text (a separate, non-interactive Text) must be tappable too.
      const capsuleScale = this.container.scale.x || 1;
      const toTexX = tex.width / badgeSize;
      const toTexY = tex.height / badgeSize;
      const padX = (BADGE_TAP_HIT_PAD_X / capsuleScale) * toTexX;
      const padY = (BADGE_TAP_HIT_PAD_Y / capsuleScale) * toTexY;
      chip.sprite.hitArea = new Rectangle(
        -padX,
        -padY,
        tex.width + (w - badgeSize) * toTexX + padX * 2,
        tex.height + padY * 2,
      );
    } else {
      chip.sprite.hitArea = null;
    }
    return {
      w,
      place: (x, y) => {
        chip.sprite.visible = true;
        chip.sprite.position.set(x, y - badgeSize / 2);
        if (wasHidden && tex) {
          gsap.killTweensOf(chip.sprite);
          gsap.from(chip.sprite, { alpha: 0, duration: 0.25, ease: "power2.out" });
        }
        if (hasCount) {
          chip.count.visible = true;
          chip.count.position.set(x + badgeSize + 1, y);
        } else {
          chip.count.visible = false;
        }
      },
    };
  }

  private layoutContent(startX: number, cy: number, unit: number, gap: number): void {
    const present = MANA_LETTERS.filter((l) => (this.spec.manaPool[l] ?? 0) > 0);
    const badges = this.spec.badges;
    this.ensurePips(present.length);
    this.ensureChips(badges.length);
    const badgeSize = Math.round(unit * 0.4);

    // Top row: hand-size badge + the floating mana pool. Bottom row(s): every
    // other badge, wrapping within the panel's max width. Zone pills leave the
    // rows entirely and stack on the avatar instead.
    const handIdx = badges.findIndex((b) => b.id === "hand");
    const top: ContentItem[] = [];
    if (handIdx >= 0) top.push(this.makeBadgeItem(handIdx, unit));
    for (let i = 0; i < present.length; i++) top.push(this.makePipItem(i, present[i]!, unit));
    const bottom: ContentItem[] = [];
    for (let i = 0; i < badges.length; i++)
      if (i !== handIdx && !badges[i]!.zone) bottom.push(this.makeBadgeItem(i, unit));

    const interGap = Math.max(4, Math.round(gap * 0.7));
    const rowH = Math.round(unit * 0.52);
    const maxX = Math.max(startX + badgeSize * 2, this.width - 6);
    const placed: { item: ContentItem; x: number; row: number }[] = [];

    let x = startX;
    for (const it of top) {
      placed.push({ item: it, x, row: 0 });
      x += it.w + interGap;
    }
    let row = top.length > 0 ? 1 : 0;
    x = startX;
    for (const it of bottom) {
      if (x > startX && x + it.w > maxX) {
        row++;
        x = startX;
      }
      placed.push({ item: it, x, row });
      x += it.w + interGap;
    }

    const avatarTop = this.avatarCy - this.avatarDia / 2;
    const maxRow = placed.reduce((m, p) => Math.max(m, p.row), 0);
    const blockH = (maxRow + 1) * rowH;
    // Compact self capsule sits at the bottom edge under the hand fan, so the
    // whole row block lifts above the avatar top instead of centring on it.
    const blockTop = this.compact && this.spec.isSelf ? avatarTop - gap - blockH : cy - blockH / 2;
    for (const p of placed) {
      const rowTop = blockTop + p.row * rowH;
      p.item.place(p.x, rowTop + rowH / 2);
      this.extendContent(p.x, rowTop, p.item.w, rowH);
    }

    this.layoutZoneColumn(unit, rowH, gap, avatarTop);
  }

  private layoutZoneColumn(unit: number, rowH: number, gap: number, avatarTop: number): void {
    const items: ContentItem[] = [];
    for (let i = 0; i < this.spec.badges.length; i++)
      if (this.spec.badges[i]!.zone) items.push(this.makeBadgeItem(i, unit));
    if (items.length === 0) return;
    const colH = items.length * rowH;
    const pillH = Math.round(this.avatarDia * 0.34);
    const colTop = this.spec.isSelf
      ? avatarTop - gap - colH
      : this.avatarCy + this.avatarDia / 2 + pillH * 0.2 + gap;
    const capsuleScale = this.container.scale.x || 1;
    const hitPadX = BADGE_TAP_HIT_PAD_X / capsuleScale;
    const hitPadY = BADGE_TAP_HIT_PAD_Y / capsuleScale;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      it.place(this.avatarCx - it.w / 2, colTop + i * rowH + rowH / 2);
      this.extendContent(
        this.avatarCx - it.w / 2 - hitPadX,
        colTop + i * rowH - hitPadY,
        it.w + hitPadX * 2,
        rowH + hitPadY * 2,
      );
    }
  }

  private applyLifeAnim(): void {
    const next = this.spec.life;
    if (this.renderedLife !== null && next !== this.renderedLife) {
      const gt = this.theme.gameTheme;
      const gained = next > this.renderedLife;
      const delta = next - this.renderedLife;
      const flash = gained ? gt.pt.buffed : gt.pt.lethal;
      // Odometer: roll the displayed number from the old value to the new one.
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
    const r = this.avatarDia / 2;
    this.targetRing.clear();
    this.targetRing.circle(this.avatarCx, this.avatarCy, r - 1);
    this.targetRing.stroke({
      color: hexToNum(this.theme.gameTheme.promptAction.attackAction),
      width: 2,
      alpha: 1,
    });
  }

  private applyFlash(): void {
    const flashing = this.spec.isFlashing;
    if (flashing && !this.prevFlashing) {
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
      { alpha: 1, x: this.avatarCx, y: this.avatarCy },
      {
        alpha: 0,
        y: this.avatarCy - this.avatarDia * 0.7,
        duration: 0.9,
        ease: "power1.out",
        onComplete: () => {
          if (!this.lifeFloat.destroyed) this.lifeFloat.visible = false;
        },
      },
    );
  }

  private applyPriority(): void {
    if (this.spec.isPriorityPlayer === this.priorityActive) {
      if (this.priorityActive) this.drawGlow();
      return;
    }
    this.priorityActive = this.spec.isPriorityPlayer;
    if (this.priorityActive) {
      this.drawGlow();
      this.glow.visible = true;
      this.pulse = gsap.to(this.glow, {
        alpha: 0.5,
        duration: 0.85,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    } else {
      this.pulse?.kill();
      this.pulse = null;
      this.glow.visible = false;
      this.glow.clear();
    }
  }

  private drawGlow(): void {
    this.glow.clear();
    this.glow.circle(this.avatarCx, this.avatarCy, this.avatarDia * 0.62);
    this.glow.fill({ color: hexToNum(this.theme.gameTheme.activeAction.priority), alpha: 0.22 });
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
    if (this.tapTooltipTimer !== null) window.clearTimeout(this.tapTooltipTimer);
    this.pulse?.kill();
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
    for (const chip of this.chips) gsap.killTweensOf(chip.sprite);
    for (const dot of this.sparkles.children) gsap.killTweensOf(dot);
    this.onHover(null);
    this.container.destroy({ children: true });
  }
}
