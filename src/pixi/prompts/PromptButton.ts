import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "@/pixi/colorUtils";

export interface PromptButtonOptions {
  label: string;
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
  private readonly background = new Graphics();
  private readonly labelText: Text;
  private readonly theme: Theme;
  private options: PromptButtonOptions;

  constructor(theme: Theme, options: PromptButtonOptions) {
    super();
    this.theme = theme;
    this.options = options;
    this.eventMode = options.disabled ? "none" : "static";
    this.cursor = options.disabled ? "default" : "pointer";
    this.accessible = true;
    this.accessibleTitle = options.label;
    this.tabIndex = options.disabled ? -1 : 0;
    this.addChild(this.background);
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
    this.addChild(this.labelText);
    this.on("pointertap", () => {
      if (!this.options.disabled) this.options.onPress?.();
    });
    this.on("pointerover", () => {
      if (!this.options.disabled) {
        this.redraw(true);
      }
    });
    this.on("pointerout", () => {
      this.redraw(false);
    });
    this.redraw(false);
  }

  get buttonWidth(): number {
    return (
      this.options.width ?? Math.max(this.options.compact ? 48 : 76, this.labelText.width + 24)
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
    this.redraw(false);
  }

  private redraw(hovered: boolean): void {
    const width = this.buttonWidth;
    const height = this.buttonHeight;
    const color = hexToNum(this.options.color ?? this.theme.appTheme.primary);
    const border = hexToNum(this.theme.appTheme.border);
    const disabled = this.options.disabled ?? false;
    this.background.clear().roundRect(0, 0, width, height, this.options.compact ? 12 : 7);
    if (this.options.outline) {
      this.background.fill({
        color: hexToNum(this.theme.appTheme.card),
        alpha: disabled ? 0.45 : 0.94,
      });
      this.background.stroke({ color, width: hovered ? 2 : 1, alpha: disabled ? 0.35 : 0.9 });
      this.labelText.style.fill = color;
    } else {
      this.background.fill({ color, alpha: disabled ? 0.35 : hovered ? 1 : 0.9 });
      this.background.stroke({ color: border, width: 1, alpha: 0.35 });
      this.labelText.style.fill = hexToNum(
        this.options.foreground ?? this.theme.appTheme["primary-foreground"],
      );
    }
    this.labelText.alpha = disabled ? 0.55 : 1;
    this.labelText.position.set(width / 2, height / 2);
    this.hitArea = new Rectangle(0, 0, width, height);
  }
}
