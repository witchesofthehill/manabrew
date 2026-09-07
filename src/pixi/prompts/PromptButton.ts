import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";

export interface PromptButtonOptions {
  label: string;
  title?: string;
  icon?: string;
  iconTexture?: Promise<Texture>;
  iconTint?: boolean;
  iconSize?: number;
  width?: number;
  height?: number;
  color?: string;
  foreground?: string;
  outline?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onPress?: () => void;
}

export class PromptButton extends Container {
  private readonly visual = new Container();
  private readonly background = new Graphics();
  private readonly labelText: Text;
  private readonly iconSprite: Sprite | null;
  private readonly theme: Theme;
  private options: PromptButtonOptions;
  private hovered = false;
  private focused = false;
  private pressed = false;

  constructor(theme: Theme, options: PromptButtonOptions) {
    super();
    this.theme = theme;
    this.options = options;
    this.eventMode = options.disabled ? "none" : "static";
    this.cursor = options.disabled ? "default" : "pointer";
    this.accessible = true;
    this.accessibleTitle = options.title ?? options.label;
    this.tabIndex = options.disabled ? -1 : 0;
    this.addChild(this.visual);
    this.visual.addChild(this.background);
    const iconTexture = options.icon ? gameIconTexture(options.icon) : options.iconTexture;
    this.iconSprite = iconTexture ? new Sprite() : null;
    if (this.iconSprite) {
      this.iconSprite.anchor.set(0.5);
      this.iconSprite.eventMode = "none";
      this.visual.addChild(this.iconSprite);
      void iconTexture!
        .then((texture) => {
          if (!this.iconSprite || this.destroyed) return;
          this.iconSprite.texture = texture;
          const size = this.options.iconSize ?? 14;
          this.iconSprite.width = size;
          this.iconSprite.height = size;
          this.redraw();
        })
        .catch(() => {});
    }
    this.labelText = new Text({
      text: options.label,
      style: new TextStyle({
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: options.compact ? 10 : 12,
        fontWeight: "700",
        letterSpacing: options.compact ? 0.7 : 0.3,
        fill: hexToNum(options.foreground ?? theme.appTheme["primary-foreground"]),
        align: "center",
      }),
    });
    this.labelText.anchor.set(0.5);
    this.labelText.eventMode = "none";
    this.visual.addChild(this.labelText);
    this.on("pointertap", () => {
      if (!this.options.disabled) this.options.onPress?.();
    });
    this.on("pointerdown", () => {
      if (this.options.disabled) return;
      this.pressed = true;
      this.syncVisual();
    });
    this.on("pointerup", () => {
      this.pressed = false;
      this.syncVisual();
    });
    this.on("pointerupoutside", () => {
      this.pressed = false;
      this.syncVisual();
    });
    this.on("pointerover", () => {
      if (this.options.disabled) return;
      this.hovered = true;
      this.redraw();
      this.syncVisual();
    });
    this.on("pointerout", () => {
      this.hovered = false;
      this.pressed = false;
      this.redraw();
      this.syncVisual();
    });
    this.on("focusin", () => {
      this.focused = true;
      this.redraw();
    });
    this.on("focusout", () => {
      this.focused = false;
      this.pressed = false;
      this.redraw();
      this.syncVisual();
    });
    this.redraw();
  }

  get buttonWidth(): number {
    const iconWidth = this.iconSprite ? (this.options.iconSize ?? 14) : 0;
    const gap = this.iconSprite && this.options.label ? 6 : 0;
    return (
      this.options.width ??
      Math.max(this.options.compact ? 48 : 76, iconWidth + gap + this.labelText.width + 24)
    );
  }

  get buttonHeight(): number {
    return this.options.height ?? (this.options.compact ? 38 : 36);
  }

  setDisabled(disabled: boolean): void {
    this.options = { ...this.options, disabled };
    this.eventMode = disabled ? "none" : "static";
    this.cursor = disabled ? "default" : "pointer";
    this.tabIndex = disabled ? -1 : 0;
    this.hovered = false;
    this.focused = false;
    this.pressed = false;
    this.redraw();
    this.syncVisual();
  }

  private redraw(): void {
    const width = this.buttonWidth;
    const height = this.buttonHeight;
    const color = hexToNum(this.options.color ?? this.theme.appTheme.primary);
    const foreground = hexToNum(
      this.options.foreground ?? this.theme.appTheme["primary-foreground"],
    );
    const border = hexToNum(this.theme.appTheme.border);
    const disabled = this.options.disabled ?? false;
    this.background.clear().roundRect(0, 0, width, height, this.options.compact ? 12 : 7);
    if (this.options.outline) {
      this.background.fill({
        color: hexToNum(this.theme.appTheme.card),
        alpha: disabled ? 0.45 : 0.94,
      });
      this.background.stroke({
        color,
        width: this.hovered || this.focused ? 2 : 1,
        alpha: disabled ? 0.35 : 0.9,
      });
      this.labelText.style.fill = color;
      if (this.iconSprite && this.options.iconTint !== false) this.iconSprite.tint = color;
    } else {
      this.background.fill({
        color,
        alpha: disabled ? 0.35 : this.pressed ? 0.78 : this.hovered || this.focused ? 1 : 0.9,
      });
      this.background.stroke({ color: border, width: 1, alpha: 0.35 });
      this.labelText.style.fill = foreground;
      if (this.iconSprite && this.options.iconTint !== false) this.iconSprite.tint = foreground;
    }
    const iconSize = this.options.iconSize ?? 14;
    const gap = this.iconSprite && this.options.label ? 6 : 0;
    const contentWidth = (this.iconSprite ? iconSize : 0) + gap + this.labelText.width;
    const contentX = (width - contentWidth) / 2;
    if (this.iconSprite) {
      this.iconSprite.alpha = disabled ? 0.55 : 1;
      this.iconSprite.position.set(contentX + iconSize / 2, height / 2);
    }
    this.labelText.alpha = disabled ? 0.55 : 1;
    this.labelText.position.set(
      contentX + (this.iconSprite ? iconSize + gap : 0) + this.labelText.width / 2,
      height / 2,
    );
    this.hitArea = new Rectangle(0, 0, width, height);
    this.visual.pivot.set(width / 2, height / 2);
    this.visual.position.set(width / 2, height / 2);
  }

  private syncVisual(): void {
    const scale = this.pressed ? 0.97 : this.hovered || this.focused ? 1.015 : 1;
    gsap.killTweensOf(this.visual.scale);
    if (!animationsEnabled()) {
      this.visual.scale.set(scale);
      return;
    }
    gsap.to(this.visual.scale, {
      x: scale,
      y: scale,
      duration: this.pressed ? 0.08 : 0.14,
      ease: "power2.out",
    });
  }

  override destroy(): void {
    gsap.killTweensOf(this.visual.scale);
    super.destroy({ children: true });
  }
}
