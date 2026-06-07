export interface DisplayEvent {
  kind: string;
  cardId?: string;
  cardName?: string;
  setCode?: string;
  playerId?: string;
  activePlayerId?: string;
  activePlayerName?: string;
  turnNumber?: number;
}
