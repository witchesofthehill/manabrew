import type { SelectedDeck } from "./deckSelection.types";

export const PLAYER_SEAT_ID = "player";
export const FIRST_BOT_SEAT_ID = "bot-1";
export const MAX_OFFLINE_BOTS = 3;

export interface OfflineSeat {
  id: string;
  deck: SelectedDeck | null;
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
  return { id, deck: null, touched: false };
}

export function createOfflineRoster(playerDeck: SelectedDeck | null): OfflineRosterState {
  return {
    seats: [{ ...emptySeat(PLAYER_SEAT_ID), deck: playerDeck }, emptySeat(FIRST_BOT_SEAT_ID)],
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
        seat.id === action.seatId ? { ...seat, deck: action.deck, touched: true } : seat,
      );
      return {
        ...state,
        seats,
        activeSeatId: target.deck ? action.seatId : (seats.find((seat) => !seat.deck)?.id ?? null),
      };
    }
    case "suggest": {
      const target = state.seats.find((seat) => seat.id === FIRST_BOT_SEAT_ID);
      if (!target || target.deck || target.touched) return state;
      const seats = state.seats.map((seat) =>
        seat.id === FIRST_BOT_SEAT_ID ? { ...seat, deck: action.deck } : seat,
      );
      return {
        ...state,
        seats,
        activeSeatId:
          state.activeSeatId === FIRST_BOT_SEAT_ID
            ? (seats.find((seat) => !seat.deck)?.id ?? null)
            : state.activeSeatId,
      };
    }
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
            ? (seats.find((seat) => !seat.deck)?.id ?? PLAYER_SEAT_ID)
            : state.activeSeatId,
      };
    }
    case "reset":
      return { ...createOfflineRoster(null), nextBotId: state.nextBotId };
  }
}
