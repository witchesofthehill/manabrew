export const CARD_FOIL_MODES = [
  { id: "regular", label: "No foil" },
  { id: "foil", label: "Foil" },
] as const;
export type CardFoilMode = (typeof CARD_FOIL_MODES)[number]["id"];
export const DEFAULT_CARD_FOIL_MODE: CardFoilMode = "foil";
