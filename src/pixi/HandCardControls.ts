import { getUiControlHeight, getUiFontSize, UI_FONT_FAMILY } from "@/themes/typography";
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
import { applyIcon } from "./panelIcons";
import { hexToNum } from "./colorUtils";

const CONTROL_SIZE = 20;
const CONTROL_GAP = 4;
const CONTROL_INSET = 5;
const ICON_SIZE = 12;
const TOOLTIP_GAP = 4;
const TOOLTIP_PAD_X = 6;
const TOOLTIP_RADIUS = 5;

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
  private controlSize: number;
  private readonly baseControlSize: number;
  private buttons: Container[] = [];
  private availableWidth = Infinity;
  private buttonsHeight = 0;

  constructor(theme: Theme, controlSize = CONTROL_SIZE) {
    super();
    this.theme = theme;
    this.baseControlSize = controlSize;
    this.controlSize = Math.max(controlSize, getUiControlHeight());
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
    this.availableWidth = Math.max(0, cardWidth * scaleX - CONTROL_INSET * 2);
    this.layoutButtons();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.redraw();
  }

  private redraw(): void {
    this.controlSize = Math.max(this.baseControlSize, getUiControlHeight());
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.buttons.length = 0;
    const spec = this.spec;
    if (!spec) {
      this.visible = false;
      return;
    }

    const controls = [
      {
        icon: spec.rulesView ? "card-play" : "spell-book",
        tooltip: spec.rulesView ? `Show card` : `Show rules`,
        activate: spec.onToggleRules,
      },
      ...(spec.showFaceControl
        ? [
            {
              icon: "cycle",
              tooltip: spec.horizontal
                ? spec.alternateFace
                  ? `Return upright`
                  : `Rotate to read`
                : spec.alternateFace
                  ? `Show front face`
                  : `Show back face`,
              activate: spec.onToggleFace,
            },
          ]
        : []),
    ];
    const tooltip = this.createTooltip();
    this.buttons = controls.map(({ icon, tooltip: label, activate }) =>
      this.createButton(icon, label, activate, tooltip),
    );
    for (const button of this.buttons) this.addChild(button);
    this.layoutButtons();
    this.addChild(tooltip.container);
    this.visible = true;
  }

  private layoutButtons(): void {
    const totalWidth =
      this.buttons.length * this.controlSize + CONTROL_GAP * Math.max(0, this.buttons.length - 1);
    const vertical = totalWidth > this.availableWidth;
    this.buttonsHeight = vertical ? totalWidth : this.controlSize;
    for (let index = 0; index < this.buttons.length; index++) {
      this.buttons[index]!.position.set(
        vertical ? -this.controlSize : -totalWidth + index * (this.controlSize + CONTROL_GAP),
        vertical ? index * (this.controlSize + CONTROL_GAP) : 0,
      );
    }
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
    icon.position.set(this.controlSize / 2);
    const iconSize = this.controlSize === CONTROL_SIZE ? ICON_SIZE : 14;
    applyIcon(
      icon,
      iconName,
      this.theme.appTheme["popover-foreground"],
      undefined,
      iconSize,
      iconSize,
    );
    const paint = (hovered: boolean) => {
      background
        .clear()
        .circle(this.controlSize / 2, this.controlSize / 2, this.controlSize / 2)
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
    const hitPad = 1;
    button.hitArea = new Rectangle(
      -hitPad,
      -hitPad,
      this.controlSize + hitPad * 2,
      this.controlSize + hitPad * 2,
    );
    button.on("pointerenter", (event: FederatedPointerEvent) => {
      if (event.pointerType === "touch") return;
      paint(true);
      this.showTooltip(tooltip, tooltipLabel, button.x + this.controlSize / 2);
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
        fontFamily: UI_FONT_FAMILY,
        fontSize: getUiFontSize("meta"),
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
    const height = tooltip.label.height + 8;
    const width = tooltip.label.width + TOOLTIP_PAD_X * 2;
    tooltip.label.position.set(TOOLTIP_PAD_X, Math.round((height - tooltip.label.height) / 2));
    tooltip.background
      .clear()
      .roundRect(0, 0, width, height, TOOLTIP_RADIUS)
      .fill({ color: hexToNum(this.theme.appTheme.popover), alpha: 0.97 })
      .stroke({ color: hexToNum(this.theme.appTheme.border), width: 0.75 });
    tooltip.container.position.set(
      Math.min(centerX - width / 2, -width),
      this.buttonsHeight + TOOLTIP_GAP,
    );
    tooltip.container.visible = true;
  }
}
