import { Container, FederatedPointerEvent, Graphics, Point, Rectangle } from "pixi.js";
import type { CardInteractionPanel } from "@/lib/cardRenderGeometry";
import {
  RULES_CARD_CONSTRAINTS,
  type RulesPreviewFrameStyle,
} from "@/pixi/cardPreview/rulesPreviewFrame";
import { FACE_WIDTH } from "card-glint/magic/presentation";
import { hexToNum } from "@/pixi/colorUtils";

const SCROLL_DRAG_SLOP = 5;
const NATIVE_RULES_FONT_SIZE = 20.25;
const NATIVE_BODY_INSET = 1;
export const RULES_PREVIEW_FONT_SIZE =
  (NATIVE_RULES_FONT_SIZE * RULES_CARD_CONSTRAINTS.width) / FACE_WIDTH;

export class RulesPreviewBody {
  readonly container = new Container();
  readonly background = new Graphics();
  readonly chrome = new Container();
  readonly scroller = new Container();
  private readonly textViewport = new Container();
  private readonly markerViewport = new Container();
  readonly markerContent = new Container();
  readonly markerMask = new Graphics();
  readonly markerRegion = new Rectangle();
  sagaRail: CardInteractionPanel["sagaRail"];
  classLevelBand: CardInteractionPanel["classLevelBand"];
  planeswalker: CardInteractionPanel["planeswalker"];
  readonly content = new Container();
  readonly mask = new Graphics();
  readonly track = new Graphics();
  readonly thumb = new Graphics();
  readonly footer = new Container();
  readonly statBounds = new Rectangle();
  readonly region = new Rectangle();
  readonly reminderRegions: Rectangle[] = [];
  private readonly clipOrigin = new Point();
  private readonly clipPoint = new Point();
  private readonly transformedClipBounds = {
    panel: new Rectangle(),
    actions: new Rectangle(),
  };
  readonly screenBounds = {
    id: "",
    faceIndex: 0,
    kind: "face" as "face" | "level",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
  };
  width = 0;
  height = 0;
  contentX = 4;
  contentWidth = 1;
  bodyTop = 4;
  bodyHeight = 1;
  usableHeight = 1;
  contentHeight = 0;
  scrollOffset = 0;
  highlightedRowTop: number | null = null;
  tapCancelled = false;
  private readonly nativeExclusions: Rectangle[] = [];
  private laidOut = false;
  private pointerId: number | null = null;
  private readonly dragStart = new Point();
  private readonly dragPrevious = new Point();
  private readonly dragLocal = new Point();
  private dragMoved = false;
  readonly panel: CardInteractionPanel;
  frame: RulesPreviewFrameStyle;
  private readonly changed: () => void;
  private readonly cancelPress: () => void;
  private readonly beginInteraction: (pointerId: number) => void;

  constructor(
    panel: CardInteractionPanel,
    frame: RulesPreviewFrameStyle,
    changed: () => void,
    cancelPress: () => void,
    beginInteraction: (pointerId: number) => void,
  ) {
    this.panel = panel;
    this.frame = frame;
    this.changed = changed;
    this.cancelPress = cancelPress;
    this.beginInteraction = beginInteraction;
    this.textViewport.mask = this.mask;
    this.textViewport.addChild(this.content);
    this.markerViewport.mask = this.markerMask;
    this.markerViewport.addChild(this.markerContent);
    this.scroller.addChild(this.markerViewport, this.textViewport);
    this.container.addChild(
      this.background,
      this.chrome,
      this.scroller,
      this.mask,
      this.markerMask,
      this.track,
      this.thumb,
      this.footer,
    );
    this.scroller.eventMode = "static";
    this.scroller.on("pointerdown", (event: FederatedPointerEvent) => {
      this.beginInteraction(event.pointerId);
      this.tapCancelled = false;
      if (event.pointerType !== "touch") return;
      event.stopPropagation();
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.dragStart.copyFrom(event.global);
      this.dragPrevious.copyFrom(event.global);
      this.dragMoved = false;
    });
    this.scroller.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      this.dragMoved ||=
        Math.hypot(event.global.x - this.dragStart.x, event.global.y - this.dragStart.y) >
        SCROLL_DRAG_SLOP;
      if (!this.dragMoved) return;
      this.tapCancelled = true;
      this.scroller.toLocal(this.dragPrevious, undefined, this.dragLocal);
      const previousY = this.dragLocal.y;
      this.scroller.toLocal(event.global, undefined, this.dragLocal);
      this.setScroll(this.scrollOffset + previousY - this.dragLocal.y);
      this.dragPrevious.copyFrom(event.global);
    });
    const endDrag = (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      this.tapCancelled ||= this.dragMoved || event.type === "pointercancel";
      this.pointerId = null;
    };
    this.scroller.on("pointerup", endDrag);
    this.scroller.on("pointerupoutside", endDrag);
    this.scroller.on("pointercancel", endDrag);
    this.scroller.on("pointertapcapture", (event: FederatedPointerEvent) => {
      if (this.tapCancelled) event.stopImmediatePropagation();
    });
    this.scroller.on("pointertap", (event: FederatedPointerEvent) => {
      if (event.pointerType === "touch") event.stopPropagation();
    });
    this.scroller.hitArea = { contains: (x, y) => this.containsLocal(x, y) };
  }

  configure(scale: number, scanOverlay: boolean): void {
    const region = this.panel.region;
    this.region.set(
      region.x * scale,
      region.y * scale,
      region.width * scale,
      region.height * scale,
    );
    const sideways = Math.abs(region.angle % 180) === 90;
    this.width = sideways ? this.region.height : this.region.width;
    this.height = sideways ? this.region.width : this.region.height;
    this.container.position.set(
      this.region.x + this.region.width / 2,
      this.region.y + this.region.height / 2,
    );
    this.container.pivot.set(this.width / 2, this.height / 2);
    this.container.angle = region.angle;
    this.contentX = scanOverlay ? 16 : NATIVE_BODY_INSET;
    this.contentWidth = Math.max(1, this.width - this.contentX * 2);
    this.bodyTop = scanOverlay ? 8 : NATIVE_BODY_INSET;
    this.bodyHeight = Math.max(
      1,
      this.height - this.bodyTop - (scanOverlay ? 4 : NATIVE_BODY_INSET),
    );
    const planeswalker = scanOverlay ? undefined : this.panel.planeswalker;
    if (planeswalker) {
      this.contentX = 0;
      this.contentWidth = this.width;
      this.bodyTop = (planeswalker.ink.top - region.y) * scale;
      this.bodyHeight = (planeswalker.ink.bottom - planeswalker.ink.top) * scale;
      const localX = (x: number) => (x - region.x) * scale;
      this.planeswalker = {
        badge: {
          ...planeswalker.badge,
          x: localX(planeswalker.badge.x),
          width: planeswalker.badge.width * scale,
          height: planeswalker.badge.height * scale,
          fontSize: planeswalker.badge.fontSize * scale,
          numeralOffsetX: planeswalker.badge.numeralOffsetX * scale,
          numeralOffsetY: {
            plus: planeswalker.badge.numeralOffsetY.plus * scale,
            zero: planeswalker.badge.numeralOffsetY.zero * scale,
            minus: planeswalker.badge.numeralOffsetY.minus * scale,
          },
          numeralMaxWidth: planeswalker.badge.numeralMaxWidth * scale,
        },
        text: {
          x: localX(planeswalker.text.x),
          width: planeswalker.text.width * scale,
        },
        staticText: {
          x: localX(planeswalker.staticText.x),
          width: planeswalker.staticText.width * scale,
        },
        separator: {
          x: localX(planeswalker.separator.x),
          width: planeswalker.separator.width * scale,
          height: planeswalker.separator.height * scale,
        },
        colon: {
          ...planeswalker.colon,
          x: localX(planeswalker.colon.x),
          fontSize: planeswalker.colon.fontSize * scale,
          offsetY: planeswalker.colon.offsetY * scale,
        },
        minimumRowHeight: planeswalker.minimumRowHeight * scale,
        ink: {
          top: this.bodyTop,
          bottom: this.bodyTop + this.bodyHeight,
        },
      };
    }
    if (!scanOverlay && this.panel.classLevelBand) {
      this.classLevelBand = {
        ...this.panel.classLevelBand,
        height: this.panel.classLevelBand.height * scale,
        fontSize: this.panel.classLevelBand.fontSize * scale,
      };
    }
    const sagaRail = scanOverlay ? undefined : this.panel.sagaRail;
    if (sagaRail) {
      this.sagaRail = {
        marker: {
          ...sagaRail.marker,
          x: (sagaRail.marker.x - region.x) * scale - this.contentX,
          centerX: (sagaRail.marker.centerX - region.x) * scale - this.contentX,
          width: sagaRail.marker.width * scale,
          height: sagaRail.marker.height * scale,
          numeralOffsetY: sagaRail.marker.numeralOffsetY * scale,
          gap: sagaRail.marker.gap * scale,
          fontSize: sagaRail.marker.fontSize * scale,
          minimumRowHeight: sagaRail.marker.minimumRowHeight * scale,
        },
        text: {
          x: (sagaRail.text.x - region.x) * scale - this.contentX,
          y: (sagaRail.text.y - region.y) * scale - this.bodyTop,
          width: sagaRail.text.width * scale,
        },
        reminder: {
          x: (sagaRail.reminder.x - region.x) * scale - this.contentX,
          y: (sagaRail.reminder.y - region.y) * scale - this.bodyTop,
          width: sagaRail.reminder.width * scale,
        },
      };
      this.markerRegion.set(
        sagaRail.marker.x * scale,
        this.region.y,
        sagaRail.marker.width * scale,
        this.region.height,
      );
    }
    const radians = (region.angle * Math.PI) / 180;
    const cosine = Math.round(Math.cos(radians));
    const sine = Math.round(Math.sin(radians));
    this.nativeExclusions.length = 0;
    this.reminderRegions.length = 0;
    for (const exclusion of this.panel.exclusions) {
      if (exclusion.role === "reminder")
        this.reminderRegions.push(
          new Rectangle(
            exclusion.x * scale,
            exclusion.y * scale,
            exclusion.width * scale,
            exclusion.height * scale,
          ),
        );
      const dx = (exclusion.x + exclusion.width / 2) * scale - this.container.x;
      const dy = (exclusion.y + exclusion.height / 2) * scale - this.container.y;
      const width =
        (Math.abs(cosine) * exclusion.width + Math.abs(sine) * exclusion.height) * scale;
      const height =
        (Math.abs(sine) * exclusion.width + Math.abs(cosine) * exclusion.height) * scale;
      const bounds = new Rectangle(
        this.width / 2 + dx * cosine + dy * sine - width / 2 - 4,
        this.height / 2 - dx * sine + dy * cosine - height / 2 - 4,
        width + 8,
        height + 8,
      );
      this.nativeExclusions.push(bounds);
    }
  }

  layout(): void {
    if (this.laidOut) return;
    this.laidOut = true;
    this.scroller.position.set(this.contentX, this.bodyTop);
    const bottom = this.bodyTop + this.bodyHeight;
    const right = this.contentX + this.contentWidth;
    const exclusions = this.footer.visible
      ? [...this.nativeExclusions, this.statBounds]
      : this.nativeExclusions;
    const edges = [this.bodyTop, bottom];
    this.usableHeight = this.bodyHeight;
    for (const exclusion of exclusions) {
      if (
        exclusion.x < right &&
        exclusion.right > this.contentX &&
        exclusion.y < bottom &&
        exclusion.bottom > this.bodyTop
      ) {
        this.usableHeight = Math.min(this.usableHeight, Math.max(1, exclusion.y - this.bodyTop));
      }
      edges.push(Math.max(this.bodyTop, Math.min(bottom, exclusion.y)));
      edges.push(Math.max(this.bodyTop, Math.min(bottom, exclusion.bottom)));
    }
    edges.sort((a, b) => a - b);
    this.mask.clear();
    for (let index = 1; index < edges.length; index += 1) {
      const top = edges[index - 1]!;
      const height = edges[index]! - top;
      if (height <= 0) continue;
      const cuts = exclusions
        .filter((exclusion) => exclusion.y < top + height && exclusion.bottom > top)
        .sort((a, b) => a.x - b.x);
      let left = this.contentX;
      for (const cut of cuts) {
        const cutLeft = Math.max(this.contentX, Math.min(right, cut.x));
        if (cutLeft > left) this.mask.rect(left, top, cutLeft - left, height);
        left = Math.max(left, Math.min(right, cut.right));
      }
      if (right > left) this.mask.rect(left, top, right - left, height);
    }
    this.mask.fill(hexToNum(this.frame.paper));
    if (this.sagaRail) {
      this.markerMask
        .rect(
          this.sagaRail.marker.x + this.contentX,
          this.bodyTop,
          this.sagaRail.marker.width,
          this.bodyHeight,
        )
        .fill(hexToNum(this.frame.paper));
    }
    this.setScroll(this.scrollOffset);
  }

  private containsLocal(x: number, y: number): boolean {
    return (
      x >= Math.min(0, this.sagaRail?.marker.x ?? 0) &&
      x <= this.contentWidth &&
      y >= 0 &&
      y <= this.bodyHeight &&
      !this.nativeExclusions.some((exclusion) =>
        exclusion.contains(x + this.contentX, y + this.bodyTop),
      ) &&
      (!this.footer.visible || !this.statBounds.contains(x + this.contentX, y + this.bodyTop))
    );
  }

  get clipScreenBounds() {
    const local = this.mask.getLocalBounds();
    this.mask.toGlobal(this.clipOrigin, this.clipPoint);
    const transform = this.mask.worldTransform;
    const leftX = transform.a * local.x + transform.c * local.y + transform.tx;
    const topY = transform.b * local.x + transform.d * local.y + transform.ty;
    const widthX = transform.a * local.width;
    const widthY = transform.b * local.width;
    for (let index = 0; index < 2; index += 1) {
      const target =
        index === 0 ? this.transformedClipBounds.panel : this.transformedClipBounds.actions;
      const height =
        index === 0
          ? local.height
          : Math.max(0, Math.min(local.height, this.bodyTop + this.usableHeight - local.y));
      const heightX = transform.c * height;
      const heightY = transform.d * height;
      const x = leftX + Math.min(0, widthX) + Math.min(0, heightX);
      const y = topY + Math.min(0, widthY) + Math.min(0, heightY);
      const right = leftX + Math.max(0, widthX) + Math.max(0, heightX);
      const bottom = topY + Math.max(0, widthY) + Math.max(0, heightY);
      target.set(x, y, right - x, bottom - y);
    }
    return this.transformedClipBounds;
  }

  containsScreen(x: number, y: number): boolean {
    this.scroller.toLocal({ x, y }, undefined, this.dragLocal);
    return this.container.visible && this.containsLocal(this.dragLocal.x, this.dragLocal.y);
  }

  scrollBy(delta: number, mode: number): void {
    this.tapCancelled = true;
    this.cancelPress();
    const transform = this.scroller.worldTransform;
    const scale = Math.hypot(transform.c, transform.d);
    const unit =
      mode === 1
        ? RULES_PREVIEW_FONT_SIZE
        : mode === 2
          ? this.usableHeight
          : scale > 0
            ? 1 / scale
            : 0;
    this.setScroll(this.scrollOffset + delta * unit);
  }

  scrollIntoView(top: number, height: number): void {
    if (top < this.scrollOffset) this.setScroll(top);
    else if (top + height > this.scrollOffset + this.usableHeight)
      this.setScroll(height > this.usableHeight ? top : top + height - this.usableHeight);
  }

  setScroll(offset: number): void {
    const maxScroll = Math.max(0, this.contentHeight - this.usableHeight);
    const previousOffset = this.scrollOffset;
    this.scrollOffset = Math.max(0, Math.min(offset, maxScroll));
    this.content.y = -this.scrollOffset;
    this.markerContent.y = -this.scrollOffset;
    this.track.clear();
    this.thumb.clear();
    if (maxScroll > 0 && this.bodyHeight > 0) {
      const trackX = this.width - 3;
      const trackY = this.bodyTop + 5;
      let trackBottom = this.bodyTop + this.bodyHeight - 5;
      for (const exclusion of this.nativeExclusions)
        if (exclusion.x < trackX + 3 && exclusion.right > trackX - 1 && exclusion.y > trackY)
          trackBottom = Math.min(trackBottom, exclusion.y);
      const trackHeight = Math.max(0, trackBottom - trackY);
      const thumbHeight = Math.min(
        trackHeight,
        Math.max(28, trackHeight * (this.usableHeight / this.contentHeight)),
      );
      const thumbY =
        trackY + Math.max(0, trackHeight - thumbHeight) * (this.scrollOffset / maxScroll);
      this.track
        .roundRect(trackX, trackY, 2, trackHeight, 1)
        .fill({ color: hexToNum(this.frame.ink), alpha: 0.12 });
      this.thumb
        .roundRect(trackX - 1, thumbY, 4, thumbHeight, 2)
        .fill({ color: hexToNum(this.frame.mutedInk), alpha: 0.85 });
    }
    if (this.scrollOffset !== previousOffset) {
      this.tapCancelled = true;
      this.cancelPress();
      this.changed();
    }
  }

  cancelInteraction(): void {
    this.pointerId = null;
    this.dragMoved = false;
    this.tapCancelled = true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
