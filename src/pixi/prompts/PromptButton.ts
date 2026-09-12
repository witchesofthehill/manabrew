import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { colorAlpha, hexToNum } from "@/pixi/colorUtils";
import { gameIconTexture } from "@/pixi/gameIconCache";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";

const FONT = "Inter, system-ui, sans-serif";
const PRESS_SECONDS = 0.08;
const RELEASE_SECONDS = 0.18;

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
  variant?: "primary" | "secondary" | "destructive";
  action?: keyof Theme["gameTheme"]["promptAction"] | "priority";
  foreground?: string;
  outline?: boolean;
  disabled?: boolean;
  compact?: boolean;
  labelPlacement?: "inline" | "stacked" | "hidden";
  flat?: boolean;
  radius?: number;
  shadow?: boolean;
  badge?: string;
  tooltip?: boolean;
  backgroundColor?: string;
  backgroundAlpha?: number;
  borderColor?: string;
  borderAlpha?: number;
  hoverBackgroundAlpha?: number;
  hoverBorderAlpha?: number;
  pressOffsetY?: number;
  fontSize?: number;
  fontWeight?: "500" | "600" | "700" | "800" | "900";
  letterSpacing?: number;
  paddingX?: number;
  onPress?: () => void;
}

export class PromptButton extends Container {
  private readonly visual = new Container();
  private readonly shadow = new Graphics();
  private readonly background = new Graphics();
  private readonly feedback = new Graphics();
  private readonly labelText: Text;
  private readonly iconSprite: Sprite | null;
  private readonly badgeContainer: Container | null;
  private readonly tooltipContainer: Container | null;
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
    this.visual.addChild(this.shadow, this.background, this.feedback);
    this.feedback.eventMode = "none";
    this.feedback.alpha = 0;
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
    const labelPlacement = options.labelPlacement ?? "inline";
    this.labelText = new Text({
      text: labelPlacement === "stacked" ? options.label.toUpperCase() : options.label,
      style: new TextStyle({
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize:
          options.fontSize ?? (labelPlacement === "stacked" ? 8 : options.compact ? 10 : 12),
        fontWeight: options.fontWeight ?? "700",
        letterSpacing:
          options.letterSpacing ??
          (labelPlacement === "stacked" ? 0.4 : options.compact ? 0.7 : 0.3),
        lineHeight: labelPlacement === "stacked" ? 8 : undefined,
        fill: hexToNum(theme.gameTheme.textOnTinted),
        align: "center",
      }),
    });
    this.labelText.anchor.set(0.5);
    this.labelText.eventMode = "none";
    this.labelText.visible = labelPlacement !== "hidden";
    this.visual.addChild(this.labelText);
    this.badgeContainer = options.badge ? this.makeBadge(options.badge) : null;
    if (this.badgeContainer) this.addChild(this.badgeContainer);
    this.tooltipContainer =
      options.tooltip && labelPlacement === "hidden" ? this.makeTooltip(options.label) : null;
    if (this.tooltipContainer) {
      this.tooltipContainer.visible = false;
      this.addChild(this.tooltipContainer);
    }
    this.on("pointertap", () => {
      if (!this.options.disabled) this.options.onPress?.();
    });
    this.on("pointerdown", () => {
      if (this.options.disabled) return;
      this.pressed = true;
      this.redraw();
      this.syncVisual();
    });
    this.on("pointerup", () => {
      this.pressed = false;
      this.redraw();
      this.syncVisual();
    });
    this.on("pointerupoutside", () => {
      this.pressed = false;
      this.redraw();
      this.syncVisual();
    });
    this.on("pointercancel", () => {
      this.pressed = false;
      this.hovered = false;
      this.redraw();
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
      this.syncVisual();
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
    if (this.options.width != null) return this.options.width;
    const iconWidth = this.iconSprite ? (this.options.iconSize ?? 14) : 0;
    const placement = this.options.labelPlacement ?? "inline";
    const paddingX = this.options.paddingX ?? (placement === "stacked" ? 6 : 12);
    if (placement === "hidden") return Math.max(36, iconWidth + paddingX * 2);
    if (placement === "stacked") {
      return Math.max(40, iconWidth + paddingX * 2, this.labelText.width + paddingX * 2);
    }
    const gap = this.iconSprite && this.options.label ? 6 : 0;
    return Math.max(
      this.options.compact ? 48 : 76,
      iconWidth + gap + this.labelText.width + paddingX * 2,
    );
  }

  get buttonHeight(): number {
    if (this.options.height != null) return this.options.height;
    const placement = this.options.labelPlacement ?? "inline";
    if (placement === "stacked") return 40;
    if (placement === "hidden") return 36;
    return this.options.compact ? 38 : 36;
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

  addProgressFill(fill: Graphics): void {
    this.visual.addChildAt(fill, 2);
  }

  private redraw(): void {
    const width = this.buttonWidth;
    const height = this.buttonHeight;
    const app = this.theme.appTheme;
    const action = this.options.action;
    const variant = this.options.variant ?? "primary";
    const fill =
      this.options.color ??
      (action === "priority"
        ? app.primary
        : action
          ? this.theme.gameTheme.promptAction[action]
          : app[variant]);
    const color = hexToNum(fill);
    const active = !this.options.disabled && (this.pressed || this.hovered || this.focused);
    const foregroundColor =
      this.options.foreground ??
      (this.options.outline
        ? active && !this.options.backgroundColor
          ? app["accent-foreground"]
          : app["card-foreground"]
        : action === "priority"
          ? app["primary-foreground"]
          : action
            ? this.theme.gameTheme.promptForeground[action]
            : app[`${variant}-foreground`]);
    const foreground = hexToNum(foregroundColor);
    const foregroundAlpha = colorAlpha(foregroundColor);
    const border = hexToNum(this.options.borderColor ?? this.theme.appTheme.border);
    const disabled = this.options.disabled ?? false;
    const placement = this.options.labelPlacement ?? "inline";
    const radius = this.options.radius ?? (this.options.compact ? 12 : 7);
    this.shadow.clear();
    if (this.options.shadow && !disabled) {
      this.shadow
        .roundRect(-4, 2, width + 8, height + 10, radius + 4)
        .fill({ color, alpha: 0.08 })
        .roundRect(-2, 3, width + 4, height + 6, radius + 2)
        .fill({ color, alpha: 0.12 });
    }
    this.background.clear().roundRect(0, 0, width, height, radius);
    if (this.options.flat) {
      this.background.fill({ color, alpha: colorAlpha(fill) });
      if (active) {
        this.background.roundRect(0, 0, width, height, radius).fill({
          color: foreground,
          alpha: this.pressed ? 0.2 : 0.12,
        });
      }
      this.labelText.style.fill = foreground;
      if (this.iconSprite && this.options.iconTint !== false) this.iconSprite.tint = foreground;
      this.visual.alpha = disabled ? 0.5 : 1;
    } else if (this.options.outline) {
      this.background.fill({
        color: hexToNum(this.options.backgroundColor ?? (active ? app.accent : app.card)),
        alpha:
          this.hovered || this.focused
            ? (this.options.hoverBackgroundAlpha ?? this.options.backgroundAlpha ?? 0.94)
            : (this.options.backgroundAlpha ?? 0.94),
      });
      this.background.stroke({
        color: border,
        width: 1,
        alpha:
          this.hovered || this.focused
            ? (this.options.hoverBorderAlpha ?? this.options.borderAlpha ?? 0.9)
            : (this.options.borderAlpha ?? 0.9),
      });
      this.labelText.style.fill = foreground;
      if (this.iconSprite && this.options.iconTint !== false) this.iconSprite.tint = foreground;
      this.visual.alpha = disabled ? 0.5 : 1;
    } else {
      this.background.fill({
        color,
        alpha: colorAlpha(fill) * (this.pressed ? 0.78 : active ? 1 : 0.9),
      });
      this.background.stroke({ color: border, width: 1, alpha: 0.35 });
      this.labelText.style.fill = foreground;
      if (this.iconSprite && this.options.iconTint !== false) this.iconSprite.tint = foreground;
      this.visual.alpha = disabled ? 0.5 : 1;
    }
    if (this.focused && !disabled) {
      this.background
        .roundRect(-2, -2, width + 4, height + 4, radius + 2)
        .stroke({ color: hexToNum(app.ring), width: 2 });
    }
    this.feedback
      .clear()
      .roundRect(0, 0, width, height, radius)
      .fill({ color: foreground, alpha: 0.22 });
    const iconSize = this.options.iconSize ?? 14;
    if (placement === "stacked") {
      if (this.iconSprite) this.iconSprite.position.set(width / 2, 15);
      this.labelText.position.set(width / 2, 28);
    } else if (placement === "hidden") {
      if (this.iconSprite) this.iconSprite.position.set(width / 2, height / 2);
    } else {
      const gap = this.iconSprite && this.options.label ? 6 : 0;
      const contentWidth = (this.iconSprite ? iconSize : 0) + gap + this.labelText.width;
      const contentX = (width - contentWidth) / 2;
      if (this.iconSprite) this.iconSprite.position.set(contentX + iconSize / 2, height / 2);
      this.labelText.position.set(
        contentX + (this.iconSprite ? iconSize + gap : 0) + this.labelText.width / 2,
        height / 2,
      );
    }
    if (this.iconSprite)
      this.iconSprite.alpha = this.options.iconTint === false ? 1 : foregroundAlpha;
    this.labelText.alpha = foregroundAlpha;
    this.hitArea = new Rectangle(0, 0, width, height);
    const offsetY = this.visual.y - this.visual.pivot.y;
    this.visual.pivot.set(width / 2, height / 2);
    this.visual.position.set(width / 2, height / 2 + offsetY);
    if (this.badgeContainer) {
      const badgeWidth = this.badgeContainer.getLocalBounds().width;
      this.badgeContainer.position.set(width + 6 - badgeWidth / 2, 2);
    }
    if (this.tooltipContainer) {
      this.tooltipContainer.position.set(width / 2, -18);
      this.tooltipContainer.visible = this.hovered || this.focused;
    }
  }

  private makeBadge(value: string): Container {
    const badge = new Container();
    const label = new Text({
      text: value,
      style: new TextStyle({
        fontFamily: FONT,
        fontSize: 9,
        fontWeight: "700",
        fill: hexToNum(this.theme.gameTheme.textOnTinted),
      }),
    });
    label.anchor.set(0.5);
    const width = Math.max(16, label.width + 8);
    badge.addChild(
      new Graphics()
        .roundRect(-width / 2, -8, width, 16, 8)
        .fill({ color: hexToNum(this.theme.gameTheme.canvas.shadow), alpha: 0.8 }),
      label,
    );
    badge.eventMode = "none";
    return badge;
  }

  private makeTooltip(value: string): Container {
    const tooltip = new Container();
    const label = new Text({
      text: value,
      style: new TextStyle({
        fontFamily: FONT,
        fontSize: 10,
        fontWeight: "600",
        fill: hexToNum(this.theme.appTheme["popover-foreground"]),
      }),
    });
    label.anchor.set(0.5);
    const width = label.width + 16;
    tooltip.addChild(
      new Graphics()
        .roundRect(-width / 2, -10, width, 20, 4)
        .fill({ color: hexToNum(this.theme.appTheme.popover), alpha: 0.95 }),
      label,
    );
    tooltip.eventMode = "none";
    return tooltip;
  }

  setPressFeedback(strength: number): void {
    this.feedback.alpha = strength;
  }

  private syncVisual(): void {
    const scale =
      this.options.flat || this.options.pressOffsetY != null
        ? 1
        : this.pressed
          ? 0.985
          : this.hovered || this.focused
            ? 1.008
            : 1;
    const y = this.buttonHeight / 2 + (this.pressed ? (this.options.pressOffsetY ?? 0) : 0);
    gsap.killTweensOf(this.visual);
    if (!animationsEnabled()) {
      this.visual.scale.set(scale);
      this.visual.position.y = y;
      return;
    }
    gsap.to(this.visual, {
      pixi: { scale, y },
      duration: this.pressed ? PRESS_SECONDS : RELEASE_SECONDS,
      ease: this.pressed ? "power2.out" : "power3.out",
    });
  }

  override destroy(): void {
    gsap.killTweensOf(this.visual);
    super.destroy({ children: true });
  }
}
