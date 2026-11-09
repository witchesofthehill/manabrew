import type { SelectedDeck } from "./deckSelection.types";

export const PLAYER_SEAT_ID = "player";
export const FIRST_BOT_SEAT_ID = "bot-1";
export const MAX_OFFLINE_BOTS = 3;

export interface OfflineSeat {
  id: string;
  deck: SelectedDeck | null;
  confirmed: boolean;
  touched: boolean;
}

export interface OfflineRosterState {
  seats: OfflineSeat[];
  activeSeatId: string | null;
  nextBotId: number;
}

type OfflineRosterAction =
  | { type: "select"; seatId: string }
  | { type: "assign"; seatId: string; deck: SelectedDeck }
  | { type: "suggest"; deck: SelectedDeck }
  | { type: "clear"; seatId: string }
  | { type: "add" }
  | { type: "remove"; seatId: string }
  | { type: "reset" };

function emptySeat(id: string): OfflineSeat {
  return { id, deck: null, confirmed: false, touched: false };
}

export function createOfflineRoster(playerDeck: SelectedDeck | null): OfflineRosterState {
  return {
    seats: [
      { ...emptySeat(PLAYER_SEAT_ID), deck: playerDeck, confirmed: !!playerDeck },
      emptySeat(FIRST_BOT_SEAT_ID),
    ],
    activeSeatId: playerDeck ? FIRST_BOT_SEAT_ID : PLAYER_SEAT_ID,
    nextBotId: 2,
  };
}

export function offlineRosterReducer(
  state: OfflineRosterState,
  action: OfflineRosterAction,
): OfflineRosterState {
  switch (action.type) {
    case "select":
      return state.seats.some((seat) => seat.id === action.seatId)
        ? { ...state, activeSeatId: action.seatId }
        : state;
    case "assign": {
      const target = state.seats.find((seat) => seat.id === action.seatId);
      if (!target) return state;
      const seats = state.seats.map((seat) =>
        seat.id === action.seatId
          ? { ...seat, deck: action.deck, confirmed: true, touched: true }
          : seat,
      );
      return {
        ...state,
        seats,
        activeSeatId: target.confirmed
          ? action.seatId
          : (seats.find((seat) => !seat.confirmed)?.id ?? null),
      };
    }
    case "suggest":
      return {
        ...state,
        seats: state.seats.map((seat) =>
          seat.id === FIRST_BOT_SEAT_ID && !seat.deck && !seat.touched
            ? { ...seat, deck: action.deck }
            : seat,
        ),
      };
    case "clear":
      return {
        ...state,
        activeSeatId: action.seatId,
        seats: state.seats.map((seat) =>
          seat.id === action.seatId ? { ...emptySeat(seat.id), touched: true } : seat,
        ),
      };
    case "add": {
      if (state.seats.length - 1 >= MAX_OFFLINE_BOTS) return state;
      const id = `bot-${state.nextBotId}`;
      return {
        seats: [...state.seats, emptySeat(id)],
        activeSeatId: id,
        nextBotId: state.nextBotId + 1,
      };
    }
    case "remove": {
      if (action.seatId === PLAYER_SEAT_ID || state.seats.length <= 2) return state;
      const seats = state.seats.filter((seat) => seat.id !== action.seatId);
      return {
        ...state,
        seats,
        activeSeatId:
          state.activeSeatId === action.seatId
            ? (seats.find((seat) => !seat.confirmed)?.id ?? PLAYER_SEAT_ID)
            : state.activeSeatId,
      };
    }
    case "reset":
      return { ...createOfflineRoster(null), nextBotId: state.nextBotId };
  }
}
