import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import type { DestroyOptions, FederatedPointerEvent } from "pixi.js";
import type { CardStatusPresentation, CardStatusTone } from "@/components/game/cardPresentation";
import type { Theme } from "@/hooks/useTheme";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { hexToNum } from "@/pixi/colorUtils";
import { PixiRichText } from "./PixiRichText";

interface ActionsContent {
  width: number;
  maxHeight: number;
  theme: Theme;
  actions: Array<{ action: HandActionOption; shortcut: number }>;
  controls: Array<{ label: string; activate: () => void }>;
  statuses: CardStatusPresentation[];
  hint: string;
  label: string;
  onSelectAction: (action: HandActionOption) => void;
  embedded?: boolean;
}

interface ActionRow {
  top: number;
  height: number;
  background: Graphics;
}

const PAD = 10;
const GAP = 4;
const SCROLL_GUTTER = 8;
const LINE_HEIGHT = 18;
const DRAG_SLOP = 5;

function textStyle(fill: string, fontSize = 13, bold = false): TextStyle {
  return new TextStyle({
    fill,
    fontSize,
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: bold ? "700" : "400",
    lineHeight: fontSize * 1.3,
  });
}

function sameAction(left: HandActionOption, right: HandActionOption): boolean {
  return (
    left.kind === right.kind &&
    left.cardId === right.cardId &&
    left.actionId === right.actionId &&
    left.abilityIndex === right.abilityIndex &&
    left.mode === right.mode &&
    left.colorChoice === right.colorChoice &&
    left.toZoneId === right.toZoneId &&
    left.tapped === right.tapped &&
    left.isClassLevelUp === right.isClassLevelUp &&
    left.isManaAbility === right.isManaAbility &&
    (left.actionId !== undefined || left.abilityIndex !== undefined || left.label === right.label)
  );
}

function actionText(action: HandActionOption): string {
  const cost = action.cost?.trim();
  if (!cost || action.label.toLowerCase().startsWith(cost.toLowerCase())) return action.label;
  return `${cost}: ${action.label}`;
}

export class RulesPreviewActions extends Container {
  private background = new Graphics();
  private viewport = new Container();
  private content = new Container();
  private clip = new Graphics();
  private utilities = new Container();
  private scrollbar = new Graphics();
  private spec: ActionsContent | null = null;
  private rows: ActionRow[] = [];
  private focusedIndex: number | null = null;
  private hoveredIndex: number | null = null;
  private contentWidth = 0;
  private contentInset = PAD;
  private contentHeight = 0;
  private viewportHeight = 0;
  private heightValue = 0;
  private scrollOffset = 0;
  private pointerId: number | null = null;
  private tapPointerId: number | null = null;
  private pressX = 0;
  private pressY = 0;
  private pressScroll = 0;
  private touchPress = false;
  private dragMoved = false;

  constructor() {
    super();
    this.eventMode = "static";
    this.content.eventMode = this.utilities.eventMode = "passive";
    this.background.eventMode = this.clip.eventMode = this.scrollbar.eventMode = "none";
    this.viewport.addChild(this.content);
    this.viewport.mask = this.clip;
    this.addChild(this.background, this.viewport, this.clip, this.scrollbar, this.utilities);
    this.on("pointerdown", (event: FederatedPointerEvent) => {
      if (!this.spec?.embedded) event.stopPropagation();
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.tapPointerId = null;
      this.pressX = event.global.x;
      this.pressY = event.global.y;
      this.pressScroll = this.scrollOffset;
      this.touchPress = event.pointerType === "touch";
      this.dragMoved = false;
    });
    this.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      const delta = event.global.y - this.pressY;
      if (Math.hypot(event.global.x - this.pressX, delta) > DRAG_SLOP) this.dragMoved = true;
      if (this.touchPress && this.dragMoved && !this.spec?.embedded) {
        const scale = Math.hypot(this.worldTransform.c, this.worldTransform.d);
        if (scale > 0) this.setScroll(this.pressScroll - delta / scale);
      }
    });
    this.on("pointerup", (event: FederatedPointerEvent) => this.endPress(event, false));
    this.on("pointerupoutside", (event: FederatedPointerEvent) => this.endPress(event, true));
    this.on("pointercancel", (event: FederatedPointerEvent) => this.endPress(event, true));
  }

  get panelHeight(): number {
    return this.heightValue;
  }

  get focusedActionBounds(): { top: number; height: number } | null {
    if (this.focusedIndex === null) return null;
    const row = this.rows[this.focusedIndex];
    return row ? { top: row.top + this.contentInset, height: row.height } : null;
  }

  setContent(spec: ActionsContent): void {
    const previousAction =
      this.focusedIndex === null ? undefined : this.spec?.actions[this.focusedIndex]?.action;
    this.clearInput();
    this.content.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.utilities.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.rows = [];
    this.spec = spec;
    this.contentInset = spec.embedded ? 0 : PAD;
    this.contentWidth = Math.max(
      1,
      spec.width - this.contentInset * 2 - (spec.embedded ? 0 : SCROLL_GUTTER),
    );
    const matchingIndex = previousAction
      ? spec.actions.findIndex(
          ({ action }) => action === previousAction || sameAction(action, previousAction),
        )
      : -1;
    this.focusedIndex = matchingIndex >= 0 ? matchingIndex : null;
    let y = 0;
    if (spec.actions.length > 0) {
      if (spec.label) {
        y = this.addText(spec.label, y, spec.theme.appTheme["muted-foreground"], 11, true);
      }
      for (const [index, entry] of spec.actions.entries()) {
        const row = new Container();
        const background = new Graphics();
        const key = new Text({
          text: String(entry.shortcut),
          style: textStyle(spec.theme.appTheme["muted-foreground"], 11),
        });
        key.resolution = 2;
        key.anchor.set(0.5);
        key.position.set(12, 18);
        const label = new PixiRichText();
        const labelHeight = label.setContent(
          actionText(entry.action),
          textStyle(spec.theme.appTheme["popover-foreground"]),
          Math.max(1, this.contentWidth - 32),
          15,
          3,
          { parentheticalStyle: textStyle(spec.theme.appTheme["muted-foreground"]) },
        );
        const height = Math.max(40, labelHeight + 16);
        label.position.set(26, 8);
        row.position.set(0, y);
        row.addChild(background, key, label);
        row.hitArea = new Rectangle(0, 0, this.contentWidth, height);
        row.eventMode = "static";
        row.cursor = "pointer";
        row.on("pointerenter", (event: FederatedPointerEvent) => {
          if (event.pointerType === "touch" || this.pointerId !== null) return;
          this.focusedIndex = null;
          this.hoveredIndex = index;
          this.drawFocus();
        });
        row.on("pointerleave", () => {
          if (this.hoveredIndex === index) this.hoveredIndex = null;
          this.drawFocus();
        });
        row.on("pointertap", (event: FederatedPointerEvent) => {
          if (this.consumeTap(event)) this.activateAction(index);
        });
        this.rows.push({ top: y, height, background });
        this.content.addChild(row);
        y += height + GAP;
      }
    }
    if (spec.statuses.length > 0) y = this.addChips(y > 0 ? y + GAP : y);
    if (spec.hint) y = this.addText(spec.hint, y, spec.theme.appTheme["muted-foreground"], 10);
    this.contentHeight = Math.max(0, y - GAP);
    const utilityHeight = this.addControls();
    const sectionGap = this.contentHeight > 0 && utilityHeight > 0 ? GAP * 2 : 0;
    this.heightValue =
      this.contentHeight > 0 || utilityHeight > 0
        ? Math.max(
            0,
            Math.min(
              spec.maxHeight,
              this.contentHeight + utilityHeight + sectionGap + this.contentInset * 2,
            ),
          )
        : 0;
    this.viewportHeight = Math.max(
      0,
      this.heightValue - this.contentInset * 2 - utilityHeight - sectionGap,
    );
    this.utilities.position.set(
      this.contentInset,
      this.contentInset + this.viewportHeight + sectionGap,
    );
    this.visible = this.heightValue > 0;
    this.hitArea = new Rectangle(0, 0, spec.width, this.heightValue);
    this.viewport.position.set(this.contentInset, this.contentInset);
    this.viewport.hitArea = new Rectangle(0, 0, this.contentWidth, this.viewportHeight);
    this.background.clear();
    if (!spec.embedded) {
      this.background
        .roundRect(0, 0, spec.width, this.heightValue, 10)
        .fill(hexToNum(spec.theme.appTheme.popover));
    }
    if (sectionGap > 0) {
      const dividerY = this.contentInset + this.viewportHeight + GAP;
      this.background
        .moveTo(this.contentInset, dividerY)
        .lineTo(spec.width - this.contentInset, dividerY)
        .stroke({ color: hexToNum(spec.theme.appTheme.border), width: 1, alpha: 0.45 });
    }
    this.clip
      .clear()
      .rect(this.contentInset, this.contentInset, this.contentWidth, this.viewportHeight)
      .fill(hexToNum(spec.theme.appTheme.popover));
    this.drawFocus();
  }

  focusAction(delta: number): void {
    if (this.rows.length === 0) return;
    this.focusedIndex =
      this.focusedIndex === null
        ? delta < 0
          ? this.rows.length - 1
          : 0
        : (((this.focusedIndex + Math.trunc(delta)) % this.rows.length) + this.rows.length) %
          this.rows.length;
    this.drawFocus();
    const row = this.rows[this.focusedIndex]!;
    if (row.top < this.scrollOffset) this.setScroll(row.top);
    else if (row.top + row.height > this.scrollOffset + this.viewportHeight) {
      this.setScroll(
        row.height > this.viewportHeight ? row.top : row.top + row.height - this.viewportHeight,
      );
    }
  }

  activateFocusedAction(): void {
    if (this.focusedIndex !== null) {
      this.activateAction(this.focusedIndex);
      return;
    }
    if (this.hoveredIndex !== null) {
      this.activateAction(this.hoveredIndex);
      return;
    }
    this.focusAction(0);
  }

  activateShortcut(shortcut: number): boolean {
    const index = this.spec?.actions.findIndex((entry) => entry.shortcut === shortcut) ?? -1;
    if (index < 0) return false;
    this.activateAction(index);
    return true;
  }

  scrollBy(delta: number, mode: number, scale: number): void {
    const unit =
      mode === 1 ? LINE_HEIGHT : mode === 2 ? this.viewportHeight : scale > 0 ? 1 / scale : 0;
    this.setScroll(this.scrollOffset + delta * unit);
  }

  reset(): void {
    this.clearInput();
    this.spec = null;
    this.rows = [];
    this.focusedIndex = null;
    this.scrollOffset =
      this.contentWidth =
      this.contentHeight =
      this.viewportHeight =
      this.heightValue =
        0;
    this.content.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.utilities.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.content.y = 0;
    this.background.clear();
    this.clip.clear();
    this.scrollbar.clear();
    this.hitArea = new Rectangle();
    this.visible = false;
  }

  override destroy(options?: DestroyOptions): void {
    this.reset();
    super.destroy(
      typeof options === "object" ? { ...options, children: true } : { children: true },
    );
  }

  private addText(value: string, y: number, color: string, size: number, bold = false): number {
    const style = textStyle(color, size, bold);
    style.wordWrap = true;
    style.breakWords = true;
    style.wordWrapWidth = this.contentWidth;
    const text = new Text({ text: value, style });
    text.resolution = 2;
    text.position.set(0, y);
    this.content.addChild(text);
    return y + text.height + GAP;
  }

  private addChips(top: number): number {
    let x = 0;
    let y = top;
    let rowHeight = 0;
    for (const status of this.spec!.statuses) {
      const color = this.statusColor(status.tone);
      const style = textStyle(this.spec!.theme.gameTheme.textOnTinted, 10, true);
      style.wordWrap = true;
      style.breakWords = true;
      style.wordWrapWidth = Math.max(1, this.contentWidth - 16);
      const text = new Text({ text: status.label.toUpperCase(), style });
      text.resolution = 2;
      const width = Math.min(this.contentWidth, text.width + 16);
      const height = Math.max(24, text.height + 12);
      if (x > 0 && x + width > this.contentWidth) {
        x = 0;
        y += rowHeight + GAP;
        rowHeight = 0;
      }
      const chip = new Container();
      const background = new Graphics();
      background.roundRect(0, 0, width, height, 7).fill({ color: hexToNum(color), alpha: 0.9 });
      text.position.set(8, (height - text.height) / 2);
      chip.position.set(x, y);
      chip.addChild(background, text);
      this.content.addChild(chip);
      x += width + GAP;
      rowHeight = Math.max(rowHeight, height);
    }
    return y + rowHeight + GAP;
  }

  private addControls(): number {
    const spec = this.spec!;
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const control of spec.controls) {
      const style = textStyle(spec.theme.appTheme["muted-foreground"], 11);
      style.wordWrap = true;
      style.breakWords = true;
      style.wordWrapWidth = Math.max(1, this.contentWidth - 16);
      const text = new Text({ text: control.label, style });
      text.resolution = 2;
      const width = Math.min(this.contentWidth, text.width + 16);
      const height = Math.max(40, text.height + 16);
      if (x > 0 && x + width > this.contentWidth) {
        x = 0;
        y += rowHeight + GAP;
        rowHeight = 0;
      }
      const button = new Container();
      const background = new Graphics();
      text.position.set(8, (height - text.height) / 2);
      button.position.set(x, y);
      button.addChild(background, text);
      button.eventMode = "static";
      button.cursor = "pointer";
      button.hitArea = new Rectangle(0, 0, width, height);
      button.on("pointerenter", (event: FederatedPointerEvent) => {
        if (event.pointerType === "touch") return;
        background
          .clear()
          .roundRect(0, 0, width, height, 6)
          .fill({ color: hexToNum(spec.theme.appTheme.muted), alpha: 0.65 });
      });
      button.on("pointerleave", () => background.clear());
      button.on("pointertap", (event: FederatedPointerEvent) => {
        if (this.consumeTap(event)) control.activate();
      });
      this.utilities.addChild(button);
      x += width + GAP;
      rowHeight = Math.max(rowHeight, height);
    }
    return y + rowHeight;
  }

  private statusColor(tone: CardStatusTone): string {
    const theme = this.spec!.theme.gameTheme;
    if (tone in theme.cardStatus) return theme.cardStatus[tone as keyof typeof theme.cardStatus];
    if (tone === "danger") return theme.pt.lethal;
    if (tone === "positive") return theme.success;
    if (tone === "ring") return theme.badges.ring;
    if (tone === "accent") return theme.cardRing;
    return theme.counter.default;
  }

  private activateAction(index: number): void {
    const spec = this.spec;
    const entry = spec?.actions[index];
    if (spec && entry) spec.onSelectAction(entry.action);
  }

  private drawFocus(): void {
    const color = hexToNum(this.spec!.theme.gameTheme.activeAction.active);
    this.rows.forEach((row, index) => {
      const focused = index === this.focusedIndex;
      const hovered = index === this.hoveredIndex;
      row.background.clear();
      if (focused || hovered) {
        row.background
          .roundRect(0, 0, this.contentWidth, row.height, 4)
          .fill({ color, alpha: hovered ? 0.28 : 0.18 });
      }
    });
  }

  private setScroll(offset: number): void {
    const maxScroll = Math.max(0, this.contentHeight - this.viewportHeight);
    this.scrollOffset = Math.max(0, Math.min(offset, maxScroll));
    this.content.y = -this.scrollOffset;
    this.scrollbar.clear();
    if (!this.spec || maxScroll <= 0 || this.viewportHeight <= 0) return;
    const trackHeight = this.viewportHeight;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(18, (trackHeight * this.viewportHeight) / this.contentHeight),
    );
    const x = this.spec.width - (this.spec.embedded ? 2 : PAD);
    const y = this.contentInset + ((trackHeight - thumbHeight) * this.scrollOffset) / maxScroll;
    this.scrollbar
      .roundRect(x, this.contentInset, 2, trackHeight, 1)
      .fill({ color: hexToNum(this.spec.theme.appTheme.muted), alpha: 0.8 });
    this.scrollbar
      .roundRect(x - 1, y, 4, thumbHeight, 2)
      .fill(hexToNum(this.spec.theme.appTheme["muted-foreground"]));
  }

  private endPress(event: FederatedPointerEvent, cancelled: boolean): void {
    if (event.pointerId !== this.pointerId) return;
    if (!this.spec?.embedded) event.stopPropagation();
    if (Math.hypot(event.global.x - this.pressX, event.global.y - this.pressY) > DRAG_SLOP) {
      this.dragMoved = true;
    }
    this.tapPointerId = !cancelled && !this.dragMoved ? event.pointerId : null;
    this.pointerId = null;
  }

  private consumeTap(event: FederatedPointerEvent): boolean {
    event.stopPropagation();
    if (event.pointerId !== this.tapPointerId) return false;
    this.tapPointerId = null;
    return true;
  }

  private clearInput(): void {
    this.pointerId = this.tapPointerId = null;
    this.hoveredIndex = null;
    this.pressX = this.pressY = this.pressScroll = 0;
    this.touchPress = this.dragMoved = false;
  }
}
