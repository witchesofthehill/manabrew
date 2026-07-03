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

export interface StackAnchorProvider {
  getAnchor(stackObjectId: string): ScreenPos | null;
  getCastingAnchor(sourceCardId: string): ScreenPos | null;
  getSeeds(): Array<{ cardId: string; x: number; y: number; scale: number }>;
  getBounds(): ScreenBounds | null;
}
