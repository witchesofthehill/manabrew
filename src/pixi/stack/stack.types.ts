import type { CardDto } from "@/protocol/game";
import type { ScreenBounds, ScreenPos } from "../types";

export interface StackCardSpec {
  id: string;
  sourceId: string;
  card: CardDto;
  controllerId: string;
  isCasting: boolean;
  isTopOfStack: boolean;
  seatColor?: string;
  isValidTarget: boolean;
  isDimmed: boolean;
}

export interface StackFlashSpec {
  token: string;
  card: CardDto;
}

export interface StackSpec {
  cards: StackCardSpec[];
  flash: StackFlashSpec | null;
  showPreStackFlash: boolean;
  collapsed: boolean;
}

export interface StackCallbacks {
  onOpen: () => void;
  onTargetSpell: (spellId: string) => void;
  onHover: (stackObjectId: string | null) => void;
  onToggleCollapsed: () => void;
}

/** The seam `BoardScene` reads instead of querying stack DOM nodes: arrow
 *  anchors (by stack-object id and by casting source id) and fly-from-stack
 *  seeds. `getBounds` is the pile's screen rect, used by the overlay canvas to
 *  gate pointer-events (the stack never reflows the board beneath it). All
 *  coordinates are canvas-local CSS pixels, shared with the board canvas. */
export interface StackAnchorProvider {
  getAnchor(stackObjectId: string): ScreenPos | null;
  getCastingAnchor(sourceCardId: string): ScreenPos | null;
  getSeeds(): Array<{ cardId: string; x: number; y: number; scale: number }>;
  getBounds(): ScreenBounds | null;
}
