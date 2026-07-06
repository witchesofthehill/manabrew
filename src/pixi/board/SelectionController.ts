import { Container, Text } from "pixi.js";
import { MarqueeHandler } from "../MarqueeHandler";
import { hexToNum } from "../colorUtils";
import { SELECTION_BADGE_STYLE } from "../textStyles";
import { Z_SELECTION_BADGE } from "../constants";
import type { ScreenPos } from "../types";
import type { SelectionHost } from "./types";

/**
 * Owns local-player battlefield selection: the drag-marquee, the selected-id
 * set, the "N selected" badge, and selection-ring refresh. Reads
 * battlefield sprites through `SelectionHost`. Drag
 * start/end feed the selected set in via `setSelected`.
 */
export class SelectionController {
  private host: SelectionHost;
  private marquee: MarqueeHandler;
  private badge: Text;
  private selected = new Set<string>();

  constructor(host: SelectionHost, parent: Container) {
    this.host = host;
    this.marquee = new MarqueeHandler();
    parent.addChild(this.marquee.graphics);
    this.badge = new Text({ text: "", style: SELECTION_BADGE_STYLE });
    this.badge.visible = false;
    this.badge.zIndex = Z_SELECTION_BADGE;
    parent.addChild(this.badge);
  }

  getSelected(): Set<string> {
    return this.selected;
  }

  setSelected(ids: Set<string>): void {
    this.selected = ids;
  }

  has(cardId: string): boolean {
    return this.selected.has(cardId);
  }

  clear(): void {
    this.selected.clear();
  }

  /** Redraw the badge + re-apply selection rings (after a selection change). */
  refresh(): void {
    this.drawBadge();
    this.refreshRings();
  }

  startMarquee(x: number, y: number, additive: boolean): void {
    this.marquee.start(x, y, additive);
  }

  isMarqueeActive(): boolean {
    return this.marquee.isActive;
  }

  moveMarquee(x: number, y: number): void {
    this.marquee.move(x, y);
  }

  endMarquee(cardPositions: Map<string, ScreenPos>): void {
    this.selected = this.marquee.end(cardPositions, this.selected);
    this.refresh();
  }

  destroy(): void {
    this.marquee.destroy();
  }

  private drawBadge(): void {
    if (this.selected.size === 0) {
      this.badge.visible = false;
      return;
    }
    this.badge.text = `${this.selected.size} selected`;
    this.badge.visible = true;
    const zone = this.host.getPlayZone();
    this.badge.x = this.host.isCompact()
      ? zone.x + zone.width / 2 - this.badge.width / 2
      : zone.x + zone.width - this.badge.width - 8;
    this.badge.y = zone.y + 6;
  }

  private refreshRings(): void {
    if (!this.host.canRefreshRings()) return;
    for (const entry of this.host.getEntries().values()) {
      if (this.selected.has(entry.sprite.card.id)) {
        entry.sprite.setRing(hexToNum(this.host.getTheme().gameTheme.cardRing));
      } else {
        this.host.applyRing(entry.sprite);
      }
    }
  }
}
