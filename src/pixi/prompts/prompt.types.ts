import type { PromptActionSpec } from "@/components/game/game.types";
import type { DeckCard } from "@/protocol/deck";
import type { CardDto, PlayerDto } from "@/protocol/game";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { Prompt, PromptOutput } from "@/protocol";

export interface DamageOrderPromptSpec {
  attackerName: string;
  blockerCards: CardDto[];
  order: string[];
  onToggle: (cardId: string) => void;
  onUndo: () => void;
  onAuto: () => void;
  onConfirm: () => void;
}

export interface GameOverPromptSpec {
  winnerId: string | null | undefined;
  me: PlayerDto;
  opponents: PlayerDto[];
  turn: number;
  onEndGame: () => void;
}

export interface PromptOverlaySpec {
  currentPrompt: Prompt | null;
  localPlayerId: string;
  gameView: ClientGameView;
  sourceDeckCard?: DeckCard;
  action: PromptActionSpec;
  damageOrder: DamageOrderPromptSpec | null;
  gameOver: GameOverPromptSpec | null;
  modalHidden: boolean;
  respond: (output: PromptOutput["output"]) => void;
  onHideModal: () => void;
  onShowModal: () => void;
}
