export interface ScryfallImageUris {
  small: string;
  normal: string;
  large: string;
  png: string;
  art_crop: string;
  border_crop: string;
}

export interface ScryfallCard {
  id: string; // UUID
  oracle_id: string;
  multiverse_ids?: number[];
  mtgo_id?: number;
  mtgo_foil_id?: number;
  tcgplayer_id?: number;
  cardmarket_id?: number;
  name: string;
  lang: string;
  released_at: string;
  uri: string;
  scryfall_uri: string;
  layout: string;
  highres_image: boolean;
  image_status: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  card_faces?: Array<{
    name: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  }>;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  legalities: Record<string, "legal" | "not_legal" | "restricted" | "banned">;
  games: string[];
  reserved: boolean;
  foil: boolean;
  nonfoil: boolean;
  finishes: string[];
  oversized: boolean;
  promo: boolean;
  reprint: boolean;
  variation: boolean;
  set_id: string;
  set: string;
  set_name: string;
  set_type: string;
  set_uri: string;
  set_search_uri: string;
  scryfall_set_uri: string;
  rulings_uri: string;
  prints_search_uri: string;
  collector_number: string;
  digital: boolean;
  rarity: string;
  card_back_id: string;
  artist: string;
  artist_ids: string[];
  illustration_id: string;
  border_color: string;
  frame: string;
  full_art: boolean;
  textless: boolean;
  booster: boolean;
  story_spotlight: boolean;
  edhrec_rank?: number;
  penny_rank?: number;
  prices: {
    usd?: string;
    usd_foil?: string;
    eur?: string;
    eur_foil?: string;
    tix?: string;
  };
  related_uris: Record<string, string>;
  purchase_uris: Record<string, string>;
  all_parts?: Array<{
    object: string;
    id: string;
    component: "token" | "combo_piece" | "meld_part" | "meld_result";
    name: string;
    type_line: string;
    uri: string;
  }>;
}

export interface ScryfallListResponse {
  object: "list";
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

export interface ScryfallRuling {
  object: "ruling";
  oracle_id: string;
  source: string;
  published_at: string;
  comment: string;
}

export interface ScryfallRulingsResponse {
  object: "list";
  has_more: boolean;
  data: ScryfallRuling[];
}

export interface ScryfallSet {
  object: "set";
  id: string;
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  digital: boolean;
  icon_svg_uri: string;
  parent_set_code?: string;
}

export const MANA_CODES = [
  "T",
  "Q",
  "E",
  "P",
  "PW",
  "CHAOS",
  "A",
  "TK",
  "X",
  "Y",
  "Z",
  "0",
  "½",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "100",
  "1000000",
  "∞",
  "W/U",
  "W/B",
  "B/R",
  "B/G",
  "U/B",
  "U/R",
  "R/G",
  "R/W",
  "G/W",
  "G/U",
  "B/G/P",
  "B/R/P",
  "G/U/P",
  "G/W/P",
  "R/G/P",
  "R/W/P",
  "U/B/P",
  "U/R/P",
  "W/B/P",
  "W/U/P",
  "C/W",
  "C/U",
  "C/B",
  "C/R",
  "C/G",
  "2/W",
  "2/U",
  "2/B",
  "2/R",
  "2/G",
  "H",
  "W/P",
  "U/P",
  "B/P",
  "R/P",
  "G/P",
  "C/P",
  "HW",
  "HR",
  "W",
  "U",
  "B",
  "R",
  "G",
  "C",
  "S",
  "L",
  "D",
] as const;

export type ManaCode = (typeof MANA_CODES)[number];

export const MANA_CODE_SET = new Set<string>(MANA_CODES);

export const MANA_CODE_FILE_OVERRIDES: Partial<Record<ManaCode, string>> = {
  "½": "HALF",
  "∞": "INFINITY",
};
