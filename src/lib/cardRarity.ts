import type { ScryfallCard } from "@/types/scryfall";
import type { GameThemeColors } from "@/themes/gameTheme";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export type UIRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "mythic"
  | "special"
  | "land"
  | "token"
  | "unknown";
export const RARITY_ORDER: Record<UIRarity, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  land: 5,
  token: 6,
  unknown: 7,
};
export const RARITY_LABEL: Record<UIRarity, string> = {
  get mythic() {
    return i18n._(msg`Mythic`);
  },
  get rare() {
    return i18n._(msg`Rare`);
  },
  get uncommon() {
    return i18n._(msg`Uncommon`);
  },
  get common() {
    return i18n._(msg`Common`);
  },
  get special() {
    return i18n._(msg`Special`);
  },
  get land() {
    return i18n._(msg`Land`);
  },
  get token() {
    return i18n._(msg`Token`);
  },
  get unknown() {
    return i18n._(msg`Other`);
  },
};
export type RarityToken = keyof GameThemeColors["rarity"];
const RARITY_TOKEN: Partial<Record<UIRarity, RarityToken>> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  mythic: "mythic",
  special: "special",
  land: "land",
};
export function rarityToken(rarity: UIRarity): RarityToken | null {
  return RARITY_TOKEN[rarity] ?? null;
}
export function effectiveRarity(card: ScryfallCard | null | undefined): UIRarity {
  if (!card) return "unknown";
  const typeLine = card.type_line ?? "";
  if (/\bToken\b/i.test(typeLine)) return "token";
  if (/\bBasic\b.*\bLand\b/i.test(typeLine)) return "land";
  switch (card.rarity) {
    case "common":
      return "common";
    case "uncommon":
      return "uncommon";
    case "rare":
      return "rare";
    case "mythic":
      return "mythic";
    case "special":
    case "bonus":
      return "special";
    default:
      return "unknown";
  }
}
