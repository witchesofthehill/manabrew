export interface TableRoomDeckSelection {
  selectedUsername: string | null;
  onSelectSeat: (username: string) => void;
  busy: boolean;
}
