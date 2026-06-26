import { Assets, Container, Graphics, Sprite, Text, Texture, TextStyle } from "pixi.js";
import gsap from "gsap";
import type { Theme } from "@/hooks/useTheme";
import { darken, MANA_LETTERS } from "@/themes/gameTheme";
import { hexToNum } from "../colorUtils";
import { gameIconTexture } from "../gameIconCache";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "../manaSymbolCache";
import type { PlayerHudSpec } from "./playerHud.types";

const BOT_ICON_NAME = "robot-antennas";
const FONT = "Inter, system-ui, -apple-system, sans-serif";

const iconTextures = new Map<string, Texture>();

interface ManaPip {
  sprite: Sprite;
  count: Text;
}

interface BadgeChip {
  sprite: Sprite;
  count: Text;
}

/** A single player's HUD: a compact capsule with the avatar as a left-edge cap,
 *  the life total, the floating mana pool, and any active player/game badges.
 *  Collapses to an avatar "sphere" + life when its field is narrow. Owns its own
 *  gsap tweens (life-change pop, priority pulse, badge fade-in). */
export class PlayerHudCapsule {
  readonly container: Container;
  private theme: Theme;
  private onTarget: () => void;

  private bg = new Graphics();
  private glow = new Graphics();
  private avatar = new Sprite();
  private avatarMask = new Graphics();
  private bot = new Sprite();
  private initial: Text;
  private avatarHit = new Graphics();
  private heart: Text;
  private life: Text;
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

  constructor(theme: Theme, spec: PlayerHudSpec, onTarget: () => void) {
    this.theme = theme;
    this.spec = spec;
    this.isBot = spec.isBot;
    this.onTarget = onTarget;

    this.container = new Container();
    this.avatar.anchor.set(0.5);
    this.avatar.visible = false;
    this.bot.anchor.set(0.5);
    this.bot.visible = false;
    this.glow.eventMode = "none";

    this.avatarHit.eventMode = "static";
    this.avatarHit.cursor = "pointer";
    this.avatarHit.on("pointertap", () => {
      if (this.spec.isTargetable) this.onTarget();
    });

    this.initial = new Text({ text: "", style: this.textStyle(16) });
    this.initial.anchor.set(0.5);
    this.heart = new Text({ text: "♥", style: this.heartStyle(17) });
    this.heart.anchor.set(0, 0.5);
    this.life = new Text({ text: String(spec.life), style: this.textStyle(16) });
    this.life.anchor.set(0, 0.5);

    this.container.addChild(
      this.glow,
      this.bg,
      this.avatar,
      this.avatarMask,
      this.bot,
      this.initial,
      this.avatarHit,
      this.heart,
      this.life,
      this.manaLayer,
      this.badgeLayer,
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

  private textStyle(size: number): TextStyle {
    return new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: "800",
      fill: hexToNum(this.theme.gameTheme.textOnTinted),
    });
  }

  private heartStyle(size: number): TextStyle {
    return new TextStyle({
      fontFamily: FONT,
      fontSize: size,
      fontWeight: "900",
      fill: hexToNum(this.theme.gameTheme.life),
    });
  }

  private updateAvatarTexture(url: string | undefined): void {
    if (!url || url === this.avatarUrl) return;
    this.avatarUrl = url;
    Assets.load<Texture>(url)
      .then((tex) => {
        if (this.avatarUrl !== url || this.avatar.destroyed) return;
        this.avatar.texture = tex;
        this.render();
      })
      .catch(() => {});
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

  private drawAvatar(cx: number, cy: number, diameter: number, accent: number): void {
    const gt = this.theme.gameTheme;
    const r = diameter / 2;
    this.bg.circle(cx, cy, r);
    this.bg.fill({ color: hexToNum(darken(gt.canvas.background, 0.35)), alpha: 1 });
    const ringWidth = this.spec.isTargetable ? 2 : this.spec.isActiveTurn ? 2.5 : 1;
    const ringAlpha = this.spec.isTargetable ? 0.9 : this.spec.isActiveTurn ? 0.95 : 0.5;
    this.bg.stroke({ color: accent, width: ringWidth, alpha: ringAlpha });

    const hasImage = !!this.avatarUrl && this.avatar.texture !== Texture.EMPTY;
    const showBot = !hasImage && this.isBot;
    const showInitial = !hasImage && !this.isBot;

    this.avatar.visible = hasImage;
    if (hasImage) {
      this.avatar.position.set(cx, cy);
      const tw = this.avatar.texture.width || diameter;
      const th = this.avatar.texture.height || diameter;
      this.avatar.scale.set(diameter / Math.min(tw, th));
      this.avatarMask.clear();
      this.avatarMask.circle(cx, cy, r);
      this.avatarMask.fill({ color: 0xffffff });
      this.avatar.mask = this.avatarMask;
    } else {
      this.avatar.mask = null;
    }

    this.bot.visible = showBot;
    if (showBot) {
      const tex = this.iconTexture(BOT_ICON_NAME);
      if (tex) this.bot.texture = tex;
      this.bot.tint = hexToNum(gt.textOnTinted);
      this.bot.width = diameter * 0.62;
      this.bot.height = diameter * 0.62;
      this.bot.position.set(cx, cy);
    }

    this.initial.visible = showInitial;
    if (showInitial) {
      this.initial.text = this.spec.name.trim()[0]?.toUpperCase() ?? "?";
      this.initial.style = this.textStyle(Math.round(diameter * 0.5));
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
      const count = new Text({ text: "", style: this.textStyle(12) });
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
      const count = new Text({ text: "", style: this.textStyle(12) });
      count.anchor.set(0, 0.5);
      this.badgeLayer.addChild(sprite, count);
      this.chips.push({ sprite, count });
    }
    for (let i = n; i < this.chips.length; i++) {
      this.chips[i]!.sprite.visible = false;
      this.chips[i]!.count.visible = false;
    }
  }

  private render(): void {
    const { width: w, height: h } = this;
    if (w <= 0 || h <= 0) return;
    const gt = this.theme.gameTheme;
    const accent = this.spec.isTargetable
      ? hexToNum(gt.promptAction.attackAction)
      : hexToNum(this.spec.color);

    this.bg.clear();
    this.heart.style = this.heartStyle(this.column ? h * 0.13 : h * 0.4);
    this.life.style = this.textStyle(this.column ? h * 0.16 : h * 0.5);
    this.life.text = String(this.spec.life);

    if (this.column) {
      this.renderColumn(w, h, accent);
      return;
    }
    this.renderCapsule(h, accent, gt);
    this.applyLifeAnim();
    this.applyPriority(accent);
  }

  private renderColumn(w: number, h: number, accent: number): void {
    this.manaLayer.visible = false;
    this.badgeLayer.visible = false;
    this.glow.visible = false;
    const diameter = Math.max(8, Math.min(w - 8, h - 28));
    const cx = w / 2;
    const cy = 4 + diameter / 2;
    this.drawAvatar(cx, cy, diameter, accent);
    const total = this.heart.width + 3 + this.life.width;
    const ly = cy + diameter / 2 + 4 + Math.max(this.heart.height, this.life.height) / 2;
    this.heart.position.set(cx - total / 2, ly);
    this.life.position.set(cx - total / 2 + this.heart.width + 3, ly);
  }

  private renderCapsule(h: number, accent: number, gt: Theme["gameTheme"]): void {
    this.manaLayer.visible = true;
    this.badgeLayer.visible = true;
    const avatarD = h;
    const avatarCx = avatarD / 2;
    const cy = h / 2;
    const gap = Math.max(5, Math.round(h * 0.16));
    const pad = Math.max(6, Math.round(h * 0.22));

    let x = avatarD + gap;
    this.heart.position.set(x, cy);
    x += this.heart.width + 3;
    this.life.position.set(x, cy);
    x += this.life.width + gap * 1.4;

    x = this.layoutMana(x, cy, h, gap);
    x = this.layoutBadges(x, cy, h, gap);

    const right = x + pad;
    this.bg.roundRect(avatarCx, 0, Math.max(avatarD, right - avatarCx), h, Math.round(h * 0.32));
    this.bg.fill({ color: hexToNum(darken(gt.canvas.background, 0.45)), alpha: 0.92 });
    this.drawAvatar(avatarCx, cy, avatarD, accent);
  }

  private layoutMana(startX: number, cy: number, h: number, gap: number): number {
    const present = MANA_LETTERS.filter((l) => (this.spec.manaPool[l] ?? 0) > 0);
    this.ensurePips(present.length);
    const size = Math.round(h * 0.34);
    let x = startX;
    for (let i = 0; i < present.length; i++) {
      const letter = present[i]!;
      const pip = this.pips[i]!;
      const tex = this.manaTexture(letter);
      pip.sprite.visible = true;
      pip.count.visible = true;
      if (tex) pip.sprite.texture = tex;
      pip.sprite.width = size;
      pip.sprite.height = size;
      pip.sprite.position.set(x, cy - size / 2);
      pip.count.style = this.textStyle(Math.round(h * 0.3));
      pip.count.text = String(this.spec.manaPool[letter] ?? 0);
      pip.count.position.set(x + size + 2, cy);
      x += size + 2 + pip.count.width + gap;
    }
    return present.length > 0 ? x : startX;
  }

  private layoutBadges(startX: number, cy: number, h: number, gap: number): number {
    const badges = this.spec.badges;
    this.ensureChips(badges.length);
    const size = Math.round(h * 0.46);
    let x = startX;
    for (let i = 0; i < badges.length; i++) {
      const badge = badges[i]!;
      const chip = this.chips[i]!;
      const tex = this.iconTexture(badge.icon);
      const wasHidden = !chip.sprite.visible;
      chip.sprite.visible = true;
      if (tex) chip.sprite.texture = tex;
      chip.sprite.tint = hexToNum(badge.color);
      chip.sprite.width = size;
      chip.sprite.height = size;
      chip.sprite.position.set(x, cy - size / 2);
      if (wasHidden && tex) {
        gsap.killTweensOf(chip.sprite);
        gsap.from(chip.sprite, { alpha: 0, duration: 0.25, ease: "power2.out" });
      }
      x += size + 2;
      if (badge.count !== undefined) {
        chip.count.visible = true;
        chip.count.style = this.textStyle(Math.round(h * 0.34));
        chip.count.style.fill = hexToNum(badge.color);
        chip.count.text = String(badge.count);
        chip.count.position.set(x, cy);
        x += chip.count.width + 2;
      } else {
        chip.count.visible = false;
      }
      x += gap * 0.7;
    }
    return badges.length > 0 ? x : startX;
  }

  private applyLifeAnim(): void {
    const next = this.spec.life;
    if (this.renderedLife !== null && next !== this.renderedLife) {
      const gt = this.theme.gameTheme;
      const flash = next > this.renderedLife ? gt.pt.buffed : gt.pt.lethal;
      this.life.style.fill = hexToNum(flash);
      gsap.killTweensOf(this.life.scale);
      gsap.fromTo(
        this.life.scale,
        { x: 1.35, y: 1.35 },
        { x: 1, y: 1, duration: 0.45, ease: "back.out(2)" },
      );
      gsap.delayedCall(0.5, () => {
        if (!this.life.destroyed) this.life.style.fill = hexToNum(gt.textOnTinted);
      });
    }
    this.renderedLife = next;
  }

  private applyPriority(accent: number): void {
    if (this.spec.isPriorityPlayer === this.priorityActive) {
      if (this.priorityActive) this.drawGlow(accent);
      return;
    }
    this.priorityActive = this.spec.isPriorityPlayer;
    if (this.priorityActive) {
      this.drawGlow(accent);
      this.glow.visible = true;
      this.pulse = gsap.to(this.glow, {
        alpha: 0.55,
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

  private drawGlow(accent: number): void {
    const d = this.height;
    this.glow.clear();
    this.glow.circle(d / 2, d / 2, d * 0.62);
    this.glow.fill({ color: accent, alpha: 0.25 });
  }

  destroy(): void {
    this.pulse?.kill();
    gsap.killTweensOf(this.life.scale);
    gsap.killTweensOf(this.glow);
    for (const chip of this.chips) gsap.killTweensOf(chip.sprite);
    this.container.destroy({ children: true });
  }
}
