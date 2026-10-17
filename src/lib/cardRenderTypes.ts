import type { CardFaceSnapshot } from "@/lib/cardRenderSnapshot";

export type CardCanvas = HTMLCanvasElement;

export interface CardSnapshot extends CardFaceSnapshot {
  card_faces?: readonly CardFaceSnapshot[];
  keywords?: string[];
  rarity?: string;
  set?: string;
  collector_number?: string;
  frame?: string;
  frame_effects?: string[];
  border_color?: string;
  security_stamp?: string;
  full_art?: boolean;
  textless?: boolean;
  promo_types?: string[];
  lang?: string;
  released_at?: string;
}
