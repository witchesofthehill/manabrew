import type { CardDto } from "@/protocol/game";
import { isFacelessCard } from "@/lib/gameCard";
import type { CardInspectionState } from "./cardInspection";

export interface CardBrowserItem {
  id: string;
  card: CardDto;
  description?: string;
  searchText?: string;
  position?: string;
  legal?: boolean;
  selected?: boolean;
}
export interface CardBrowserState {
  query: string;
  type: string;
  color: string;
  sort: "zone" | "name" | "mana";
  onlyActions: boolean;
  size: number;
  activeId: string | null;
  scrollTop: number;
  inspection: Record<string, CardInspectionState>;
}
export const CARD_BROWSER_GAP = 12;
export const CARD_BROWSER_MIN_SIZE = 104;
export const CARD_BROWSER_MAX_SIZE = 220;
export const CARD_BROWSER_SIZE_STEP = 8;
export const CARD_BROWSER_PICKER_SIZE = 200;
export const INITIAL_CARD_BROWSER_STATE: CardBrowserState = {
  query: "",
  type: "",
  color: "",
  sort: "zone",
  onlyActions: false,
  size: 132,
  activeId: null,
  scrollTop: 0,
  inspection: {},
};
export function createCardBrowserState(
  initial: CardBrowserState | undefined,
  picker: boolean,
  onlyActions: boolean,
): CardBrowserState {
  const state = initial ?? INITIAL_CARD_BROWSER_STATE;
  return {
    ...state,
    onlyActions,
    size: picker ? CARD_BROWSER_PICKER_SIZE : state.size,
    activeId: picker ? null : state.activeId,
  };
}
export function toggleCardBrowserRulesView(
  state: CardBrowserState,
  item: CardBrowserItem,
  defaultRules: boolean,
): CardBrowserState {
  const inspection = state.inspection[item.id] ?? {
    rules: defaultRules,
    face: item.card.isTransformed ? (1 as const) : (0 as const),
    rotated: false,
  };
  return {
    ...state,
    inspection: {
      ...state.inspection,
      [item.id]: { ...inspection, rules: !inspection.rules },
    },
  };
}
export function cardSearchText(item: CardBrowserItem): string {
  if (isFacelessCard(item.card)) return "face-down card";
  const card = item.card;
  return [
    card.identity.name,
    card.text,
    ...card.types,
    ...card.subtypes,
    ...card.keywords,
    card.manaCost,
    item.description,
    item.searchText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}
export function filterBrowserItems(
  items: CardBrowserItem[],
  state: CardBrowserState,
): CardBrowserItem[] {
  const terms = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = items.filter((item) => {
    if (state.onlyActions && !item.legal && !item.selected) return false;
    if (state.type && !item.card.types.includes(state.type)) return false;
    if (
      state.color &&
      (state.color === "C"
        ? !!item.card.color && item.card.color !== "C"
        : !item.card.color.includes(state.color))
    )
      return false;
    const text = terms.length ? cardSearchText(item) : "";
    return terms.every((term) => text.includes(term));
  });
  if (state.sort !== "zone")
    filtered.sort((a, b) =>
      state.sort === "name"
        ? a.card.identity.name.localeCompare(b.card.identity.name)
        : a.card.cmc - b.card.cmc,
    );
  return filtered;
}
