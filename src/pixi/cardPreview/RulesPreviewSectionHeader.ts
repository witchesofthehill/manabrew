import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import { hexToNum } from "@/pixi/colorUtils";
import type { RulesPreviewFrameStyle } from "./rulesPreviewFrame";

export const PREVIEW_SECTION_HEADER_HEIGHT = 32;
const DRAG_SLOP = 5;

interface SectionHeaderOptions {
  title: string;
  width: number;
  collapsed: boolean;
  frame: RulesPreviewFrameStyle;
  collapsedAccent?: string;
  fontSize?: number;
  onToggle: () => void;
}

export class RulesPreviewSectionHeader extends Container {
  private background = new Graphics();
  private pointerId: number | null = null;
  private pressX = 0;
  private pressY = 0;
  private dragMoved = false;
  private focused = false;
  private options: SectionHeaderOptions;

  constructor(options: SectionHeaderOptions) {
    super();
    const { title, width, collapsed, collapsedAccent, frame } = options;
    this.options = options;
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(0, 0, width, PREVIEW_SECTION_HEADER_HEIGHT);
    const label = new Text({
      text: title,
      style: new TextStyle({
        fill: collapsed && collapsedAccent ? collapsedAccent : frame.mutedInk,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: options.fontSize ?? 11,
        fontWeight: "600",
      }),
    });
    label.resolution = 2;
    label.position.set(18, (PREVIEW_SECTION_HEADER_HEIGHT - label.height) / 2);
    const chevron = new Graphics();
    if (collapsed) chevron.moveTo(4, 12).lineTo(8, 16).lineTo(4, 20);
    else chevron.moveTo(2, 14).lineTo(6, 18).lineTo(10, 14);
    chevron.stroke({
      color: hexToNum(collapsed && collapsedAccent ? collapsedAccent : frame.mutedInk),
      width: 1.5,
    });
    this.addChild(this.background, chevron, label);
    if (collapsed && collapsedAccent) {
      const cue = new Graphics();
      cue.circle(width - 7, PREVIEW_SECTION_HEADER_HEIGHT / 2, 3);
      cue.fill(hexToNum(collapsedAccent));
      this.addChild(cue);
    }
    this.drawBackground(false);
    this.on("pointerenter", () => this.drawBackground(true));
    this.on("pointerleave", () => this.drawBackground(false));
    this.on("pointerdown", (event: FederatedPointerEvent) => {
      this.pointerId = event.pointerId;
      this.pressX = event.global.x;
      this.pressY = event.global.y;
      this.dragMoved = false;
    });
    this.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      if (Math.hypot(event.global.x - this.pressX, event.global.y - this.pressY) > DRAG_SLOP) {
        this.dragMoved = true;
      }
    });
    this.on("pointerupoutside", () => {
      this.pointerId = null;
    });
    this.on("pointercancel", () => {
      this.pointerId = null;
    });
    this.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const tapped =
        event.pointerId === this.pointerId &&
        !this.dragMoved &&
        Math.hypot(event.global.x - this.pressX, event.global.y - this.pressY) <= DRAG_SLOP;
      this.pointerId = null;
      if (tapped) options.onToggle();
    });
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.drawBackground(false);
  }

  private drawBackground(hovered: boolean): void {
    const { width, frame } = this.options;
    this.background
      .clear()
      .rect(0, 0, width, PREVIEW_SECTION_HEADER_HEIGHT)
      .fill(hexToNum(frame.paper));
    if (hovered || this.focused) {
      this.background.rect(0, 0, width, PREVIEW_SECTION_HEADER_HEIGHT).fill(hexToNum(frame.raised));
    }
  }
}
