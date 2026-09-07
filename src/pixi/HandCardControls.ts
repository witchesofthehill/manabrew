import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { isCoarsePointer } from "@/lib/responsive";
import { applyIcon } from "./panelIcons";
import { hexToNum } from "./colorUtils";

const CONTROL_SIZE = 20;
const CONTROL_GAP = 4;
const CONTROL_INSET = 5;
const CONTROL_RADIUS = CONTROL_SIZE / 2;
const ICON_SIZE = 12;
const TOOLTIP_GAP = 4;
const TOOLTIP_HEIGHT = 20;
const TOOLTIP_PAD_X = 6;
const TOOLTIP_RADIUS = 5;
const TOOLTIP_FONT_SIZE = 10;

export interface HandCardControlsSpec {
  rulesView: boolean;
  horizontal: boolean;
  alternateFace: boolean;
  showFaceControl: boolean;
  onToggleRules: () => void;
  onToggleFace: () => void;
}

export class HandCardControls extends Container {
  private spec: HandCardControlsSpec | null = null;
  private theme: Theme;

  constructor(theme: Theme) {
    super();
    this.theme = theme;
    this.eventMode = "passive";
    this.visible = false;
  }

  setSpec(
    spec: HandCardControlsSpec | null,
    cardWidth: number,
    artTop: number,
    parentScaleX: number,
    parentScaleY: number,
  ): void {
    this.spec = spec;
    this.redraw();
    this.setParentScale(parentScaleX, parentScaleY, cardWidth, artTop);
  }

  setParentScale(scaleX: number, scaleY: number, cardWidth: number, artTop: number): void {
    if (scaleX <= 0 || scaleY <= 0) return;
    this.scale.set(1 / scaleX, 1 / scaleY);
    this.position.set(cardWidth - CONTROL_INSET / scaleX, artTop);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.redraw();
  }

  private redraw(): void {
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    const spec = this.spec;
    if (!spec) {
      this.visible = false;
      return;
    }

    const controls = [
      {
        icon: spec.rulesView ? "card-play" : "spell-book",
        tooltip: spec.rulesView ? "Show card" : "Show rules",
        activate: spec.onToggleRules,
      },
      ...(spec.showFaceControl
        ? [
            {
              icon: "cycle",
              tooltip: spec.horizontal
                ? spec.alternateFace
                  ? "Return upright"
                  : "Rotate to read"
                : spec.alternateFace
                  ? "Show front face"
                  : "Show back face",
              activate: spec.onToggleFace,
            },
          ]
        : []),
    ];
    const tooltip = this.createTooltip();
    const buttons = controls.map(({ icon, tooltip: label, activate }) =>
      this.createButton(icon, label, activate, tooltip),
    );
    const totalWidth =
      buttons.length * CONTROL_SIZE + CONTROL_GAP * Math.max(0, buttons.length - 1);
    let x = -totalWidth;
    for (const button of buttons) {
      button.position.set(x, 0);
      this.addChild(button);
      x += CONTROL_SIZE + CONTROL_GAP;
    }
    this.addChild(tooltip.container);
    this.visible = true;
  }

  private createButton(
    iconName: string,
    tooltipLabel: string,
    activate: () => void,
    tooltip: { container: Container; background: Graphics; label: Text },
  ): Container {
    const button = new Container();
    const background = new Graphics();
    const icon = new Sprite(Texture.EMPTY);
    icon.anchor.set(0.5);
    icon.position.set(CONTROL_SIZE / 2);
    applyIcon(
      icon,
      iconName,
      this.theme.appTheme["popover-foreground"],
      undefined,
      ICON_SIZE,
      ICON_SIZE,
    );
    const paint = (hovered: boolean) => {
      background
        .clear()
        .circle(CONTROL_RADIUS, CONTROL_RADIUS, CONTROL_RADIUS)
        .fill({
          color: hexToNum(hovered ? this.theme.appTheme.muted : this.theme.appTheme.popover),
          alpha: 0.94,
        })
        .stroke({ color: hexToNum(this.theme.appTheme.border), width: 0.75 });
    };
    paint(false);
    button.addChild(background, icon);
    button.eventMode = "static";
    button.cursor = "pointer";
    const hitPad = isCoarsePointer() ? 6 : 1;
    button.hitArea = new Rectangle(
      -hitPad,
      -hitPad,
      CONTROL_SIZE + hitPad * 2,
      CONTROL_SIZE + hitPad * 2,
    );
    button.on("pointerenter", (event: FederatedPointerEvent) => {
      if (event.pointerType === "touch") return;
      paint(true);
      this.showTooltip(tooltip, tooltipLabel, button.x + CONTROL_SIZE / 2);
    });
    button.on("pointerleave", () => {
      paint(false);
      tooltip.container.visible = false;
    });
    button.on("pointerdown", (event: FederatedPointerEvent) => event.stopPropagation());
    button.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      tooltip.container.visible = false;
      activate();
    });
    return button;
  }

  private createTooltip(): {
    container: Container;
    background: Graphics;
    label: Text;
  } {
    const container = new Container();
    const background = new Graphics();
    const label = new Text({
      text: "",
      style: new TextStyle({
        fill: this.theme.appTheme["popover-foreground"],
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: TOOLTIP_FONT_SIZE,
        fontWeight: "600",
      }),
    });
    label.resolution = 4;
    container.eventMode = "none";
    container.visible = false;
    container.addChild(background, label);
    return { container, background, label };
  }

  private showTooltip(
    tooltip: { container: Container; background: Graphics; label: Text },
    text: string,
    centerX: number,
  ): void {
    tooltip.label.text = text;
    const width = tooltip.label.width + TOOLTIP_PAD_X * 2;
    tooltip.label.position.set(
      TOOLTIP_PAD_X,
      Math.round((TOOLTIP_HEIGHT - tooltip.label.height) / 2),
    );
    tooltip.background
      .clear()
      .roundRect(0, 0, width, TOOLTIP_HEIGHT, TOOLTIP_RADIUS)
      .fill({ color: hexToNum(this.theme.appTheme.popover), alpha: 0.97 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 0.75 });
    tooltip.container.position.set(
      Math.min(centerX - width / 2, -width),
      CONTROL_SIZE + TOOLTIP_GAP,
    );
    tooltip.container.visible = true;
  }
}
