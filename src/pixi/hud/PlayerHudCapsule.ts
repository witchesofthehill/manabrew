import { Container, Graphics, Matrix, Sprite, Text, Texture, TextStyle } from "pixi.js";
import gsap from "gsap";
import type { Theme } from "@/hooks/useTheme";
import { MANA_LETTERS } from "@/themes/gameTheme";
import { getInitials } from "@/components/game/game.utils";
import { hexToNum } from "../colorUtils";
import { gameIconTexture } from "../gameIconCache";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "../manaSymbolCache";
import { loadAvatarTexture } from "./avatarTextureCache";
import type { PlayerHudSpec, PlayerHudTooltipContent } from "./playerHud.types";
import { RING_ABILITIES } from "@/components/game/game.constants";

const BOT_ICON_NAME = "robot-antennas";
const FONT = "Inter, system-ui, -apple-system, sans-serif";

const iconTextures = new Map<string, Texture>();

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
}

interface ContentItem {
  w: number;
  place: (x: number, y: number) => void;
}

/** A single player's HUD: a minimal pill with the avatar as a left-edge cap,
 *  the life total, the floating mana pool, and any active player/game badges.
 *  Collapses to an avatar "sphere" + life when its field is narrow. Owns its own
 *  gsap tweens (life-change pop + floating delta, priority pulse, badge fade). */
export class PlayerHudCapsule {
  readonly container: Container;
  private theme: Theme;
  private onTarget: () => void;
  private onHover: HoverFn;

  private bg = new Graphics();
  private glow = new Graphics();
  private damageWash = new Graphics();
  private targetRing = new Graphics();
  private flashRing = new Graphics();
  private avatarTex: Texture | null = null;
  private bot = new Sprite();
  private initial: Text;
  private avatarHit = new Graphics();
  private heart: Text;
  private life: Text;
  private lifeFloat: Text;
  private manaLayer = new Container();
  private badgeLayer = new Container();
  private pips: ManaPip[] = [];
  private chips: BadgeChip[] = [];

  private spec: PlayerHudSpec;
  private width = 0;
  private height = 0;
  private column = false;
  private avatarUrl: string | null = null;
  private readonly isBot: boolean;
  private renderedLife: number | null = null;
  private pulse: gsap.core.Tween | null = null;
  private priorityActive = false;
  private targetableActive = false;
  private targetTween: gsap.core.Tween | null = null;
  private flashTween: gsap.core.Tween | null = null;
  private prevFlashing = false;
  private avatarCx = 0;
  private avatarCy = 0;
  private avatarDia = 0;

  constructor(theme: Theme, spec: PlayerHudSpec, onTarget: () => void, onHover: HoverFn) {
    this.theme = theme;
    this.spec = spec;
    this.isBot = spec.isBot;
    this.onTarget = onTarget;
    this.onHover = onHover;

    this.container = new Container();
    this.bot.anchor.set(0.5);
    this.bot.visible = false;
    this.glow.eventMode = "none";
    this.damageWash.eventMode = "none";
    this.targetRing.eventMode = "none";
    this.flashRing.eventMode = "none";

    this.avatarHit.eventMode = "static";
    this.avatarHit.cursor = "pointer";
    this.avatarHit.on("pointertap", () => {
      if (this.spec.isTargetable) this.onTarget();
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
      this.damageWash,
      this.targetRing,
      this.flashRing,
      this.bot,
      this.initial,
      this.avatarHit,
      this.heart,
      this.life,
      this.manaLayer,
      this.badgeLayer,
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
    this.onHover(
      content,
      this.container.x + localCx,
      this.container.y + localTop,
      this.container.y + localBottom,
    );
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.render();
  }

  setSpec(spec: PlayerHudSpec): void {
    this.spec = spec;
    this.updateAvatarTexture(spec.avatarUrl);
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
    return new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: weight,
      fill: hexToNum(this.theme.gameTheme.textOnTinted),
      dropShadow: { color: 0x000000, alpha: 0.55, blur: 3, distance: 1, angle: Math.PI / 2 },
    });
  }

  private heartStyle(size: number): TextStyle {
    return new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: "900",
      fill: hexToNum(this.theme.gameTheme.life),
      dropShadow: { color: 0x000000, alpha: 0.55, blur: 3, distance: 1, angle: Math.PI / 2 },
    });
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

    if (hasImage) {
      const tex = this.avatarTex!;
      const tw = tex.width || diameter;
      const th = tex.height || diameter;
      const cover = diameter / Math.min(tw, th);
      const m = new Matrix();
      m.scale(cover, cover);
      m.translate(cx - (tw * cover) / 2, cy - (th * cover) / 2);
      this.bg.circle(cx, cy, r);
      this.bg.fill({ texture: tex, matrix: m });
    }

    this.bg.circle(cx, cy, r - 0.5);
    this.bg.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.25 });

    // Targetable draws a pulsing ring in `targetRing`; the static ring here is
    // only the selected-target and active-turn cues.
    const accent = this.spec.isSelectedTarget
      ? { c: gt.promptAction.attackAction, w: 2.5, a: 1 }
      : this.spec.isActiveTurn
        ? { c: this.spec.color, w: 1.5, a: 0.95 }
        : null;
    if (accent) {
      this.bg.circle(cx, cy, r - accent.w / 2);
      this.bg.stroke({ color: hexToNum(accent.c), width: accent.w, alpha: accent.a });
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

    this.avatarHit.clear();
    this.avatarHit.circle(cx, cy, r);
    this.avatarHit.fill({ color: 0xffffff, alpha: 0.001 });
    this.avatarHit.cursor = this.spec.isTargetable ? "pointer" : "default";
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
      sprite.on("pointerout", () => this.onHover(null));
      this.chips.push(chip);
    }
    for (let i = n; i < this.chips.length; i++) {
      this.chips[i]!.sprite.visible = false;
      this.chips[i]!.count.visible = false;
    }
  }

  private render(): void {
    const { width: w, height: h } = this;
    if (w <= 0 || h <= 0) return;
    this.life.text = String(this.spec.life);

    this.bg.clear();
    if (this.column) {
      this.renderColumn(w, h);
      return;
    }
    this.renderCapsule(h);
    this.applyLifeAnim();
    this.applyPriority();
    this.applyTargetable();
    this.applyFlash();
  }

  private renderColumn(w: number, h: number): void {
    this.manaLayer.visible = false;
    this.badgeLayer.visible = false;
    this.glow.visible = false;
    this.damageWash.visible = false;
    this.flashRing.visible = false;
    this.targetTween?.kill();
    this.targetTween = null;
    this.targetableActive = false;
    this.targetRing.visible = false;
    this.heart.style = this.heartStyle(h * 0.12);
    this.life.style = this.textStyle(h * 0.15, "800");
    const diameter = Math.max(8, Math.min(w - 8, h - 28));
    const cx = w / 2;
    const cy = 4 + diameter / 2;
    this.avatarCx = cx;
    this.avatarCy = cy;
    this.avatarDia = diameter;
    this.drawAvatar(cx, cy, diameter);
    const total = this.heart.width + 3 + this.life.width;
    const ly = cy + diameter / 2 + 4 + Math.max(this.heart.height, this.life.height) / 2;
    this.heart.position.set(cx - total / 2, ly);
    this.life.position.set(cx - total / 2 + this.heart.width + 3, ly);
  }

  private renderCapsule(h: number): void {
    const gt = this.theme.gameTheme;
    this.manaLayer.visible = true;
    this.badgeLayer.visible = true;

    const avatarD = Math.round(h * 0.84);
    const avatarCx = avatarD / 2 + 2;
    const avatarCy = avatarD / 2 + 2;
    this.avatarCx = avatarCx;
    this.avatarCy = avatarCy;
    this.avatarDia = avatarD;
    this.drawAvatar(avatarCx, avatarCy, avatarD);

    // Life pill straddling the avatar's bottom edge (MTGA-style).
    this.heart.style = this.heartStyle(Math.round(avatarD * 0.26));
    this.life.style = this.textStyle(Math.round(avatarD * 0.32), "800");
    const padX = Math.round(avatarD * 0.12);
    const pillH = Math.round(avatarD * 0.34);
    const pillW = padX * 2 + this.heart.width + 3 + this.life.width;
    const pillLeft = avatarCx - pillW / 2;
    const pillCy = avatarCy + avatarD / 2 - pillH * 0.3;
    this.bg.roundRect(pillLeft, pillCy - pillH / 2, pillW, pillH, pillH / 2);
    this.bg.fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.9 });
    this.bg.roundRect(pillLeft + 0.5, pillCy - pillH / 2 + 0.5, pillW - 1, pillH - 1, pillH / 2);
    this.bg.stroke({ color: hexToNum(gt.textGhost), width: 1, alpha: 0.25 });
    this.heart.position.set(pillLeft + padX, pillCy);
    this.life.position.set(this.heart.x + this.heart.width + 3, pillCy);

    // Mana pips + badges flow to the right of the avatar and wrap into stacked
    // rows once they'd exceed the panel's max width, so a player with many
    // badges never bleeds into the hand. The row block is centred on the avatar.
    const gap = Math.max(5, Math.round(h * 0.14));
    const startX = avatarCx + avatarD / 2 + gap;
    this.layoutContent(startX, avatarCy, avatarD, gap);
  }

  private layoutContent(startX: number, cy: number, unit: number, gap: number): void {
    const present = MANA_LETTERS.filter((l) => (this.spec.manaPool[l] ?? 0) > 0);
    const badges = this.spec.badges;
    this.ensurePips(present.length);
    this.ensureChips(badges.length);
    const countColor = hexToNum(this.theme.gameTheme.textMuted);
    const pipSize = Math.round(unit * 0.3);
    const badgeSize = Math.round(unit * 0.4);

    const makePip = (i: number, letter: string): ContentItem => {
      const pip = this.pips[i]!;
      const tex = this.manaTexture(letter);
      if (tex) pip.sprite.texture = tex;
      pip.sprite.width = pipSize;
      pip.sprite.height = pipSize;
      pip.count.style = this.textStyle(Math.round(unit * 0.27));
      pip.count.style.fill = countColor;
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
    };

    const makeBadge = (i: number): ContentItem => {
      const badge = badges[i]!;
      const chip = this.chips[i]!;
      const tex = this.iconTexture(badge.icon);
      const wasHidden = !chip.sprite.visible;
      if (tex) chip.sprite.texture = tex;
      chip.sprite.tint = hexToNum(badge.color);
      chip.sprite.width = badgeSize;
      chip.sprite.height = badgeSize;
      chip.content = this.badgeTooltip(badge);
      const hasCount = badge.count !== undefined;
      let w = badgeSize;
      if (hasCount) {
        chip.count.style = this.textStyle(Math.round(unit * 0.3));
        chip.count.style.fill = countColor;
        chip.count.text = String(badge.count);
        w += 1 + chip.count.width;
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
    };

    // Top row: hand-size badge + the floating mana pool. Bottom row(s): every
    // other badge, wrapping within the panel's max width.
    const handIdx = badges.findIndex((b) => b.id === "hand");
    const top: ContentItem[] = [];
    if (handIdx >= 0) top.push(makeBadge(handIdx));
    for (let i = 0; i < present.length; i++) top.push(makePip(i, present[i]!));
    const bottom: ContentItem[] = [];
    for (let i = 0; i < badges.length; i++) if (i !== handIdx) bottom.push(makeBadge(i));

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

    const maxRow = placed.reduce((m, p) => Math.max(m, p.row), 0);
    const blockTop = cy - ((maxRow + 1) * rowH) / 2;
    for (const p of placed) p.item.place(p.x, blockTop + p.row * rowH + rowH / 2);
  }

  private applyLifeAnim(): void {
    const next = this.spec.life;
    if (this.renderedLife !== null && next !== this.renderedLife) {
      const gt = this.theme.gameTheme;
      const gained = next > this.renderedLife;
      const delta = next - this.renderedLife;
      this.life.style.fill = hexToNum(gained ? gt.pt.buffed : gt.pt.lethal);
      gsap.killTweensOf(this.life.scale);
      gsap.fromTo(
        this.life.scale,
        { x: 1.3, y: 1.3 },
        { x: 1, y: 1, duration: 0.45, ease: "back.out(2)" },
      );
      gsap.delayedCall(0.5, () => {
        if (!this.life.destroyed) this.life.style.fill = hexToNum(gt.textOnTinted);
      });
      this.floatLifeDelta(delta, gained ? gt.pt.buffed : gt.pt.lethal);
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
    this.lifeFloat.style = this.textStyle(Math.round(this.avatarDia * 0.42), "900");
    this.lifeFloat.style.fill = hexToNum(color);
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

  destroy(): void {
    this.pulse?.kill();
    this.targetTween?.kill();
    this.flashTween?.kill();
    gsap.killTweensOf(this.life.scale);
    gsap.killTweensOf(this.lifeFloat);
    gsap.killTweensOf(this.glow);
    gsap.killTweensOf(this.damageWash);
    for (const chip of this.chips) gsap.killTweensOf(chip.sprite);
    this.onHover(null);
    this.container.destroy({ children: true });
  }
}
