import { create } from "zustand";
import { getPlatform } from "@/platform";
import type { DeckCard } from "@/protocol/deck";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const CARD_ROLE_LABELS: Record<string, string> = {
  get "card-draw"() {
    return i18n._(msg`Card draw`);
  },
  get counterspell() {
    return i18n._(msg`Counterspell`);
  },
  get counters() {
    return i18n._(msg`Counters`);
  },
  get discard() {
    return i18n._(msg`Discard`);
  },
  get interaction() {
    return i18n._(msg`Interaction`);
  },
  get lifegain() {
    return i18n._(msg`Lifegain`);
  },
  get protection() {
    return i18n._(msg`Protection`);
  },
  get ramp() {
    return i18n._(msg`Ramp`);
  },
  get recursion() {
    return i18n._(msg`Recursion`);
  },
  get removal() {
    return i18n._(msg`Removal`);
  },
  get "token-maker"() {
    return i18n._(msg`Token maker`);
  },
  get tutor() {
    return i18n._(msg`Tutor`);
  },
};
interface CardRolesState {
  roles: Record<string, string[]>;
  pending: Set<string>;
  ensureAnalyzed: (cards: DeckCard[]) => Promise<void>;
}
const EMPTY_ROLES: string[] = [];
function normalize(name: string): string {
  return name.toLowerCase();
}
export const useCardRolesStore = create<CardRolesState>((set, get) => ({
  roles: {},
  pending: new Set(),
  ensureAnalyzed: async (cards) => {
    const unique = new Map(cards.map((card) => [normalize(card.identity.name), card]));
    const missing = [...unique].filter(
      ([key]) => get().roles[key] === undefined && !get().pending.has(key),
    );
    if (missing.length === 0) return;
    set((state) => ({ pending: new Set([...state.pending, ...missing.map(([key]) => key)]) }));
    const platform = getPlatform();
    const results = await Promise.all(
      missing.map(async ([key, card]) => {
        try {
          const engineRoles = await platform.invoke<string[]>("card_roles", {
            name: card.identity.name,
          });
          return [key, engineRoles] as const;
        } catch {
          return [key, null] as const;
        }
      }),
    );
    set((state) => {
      const roles = { ...state.roles };
      const pending = new Set(state.pending);
      for (const [key, cardRoles] of results) {
        if (cardRoles) roles[key] = cardRoles;
        pending.delete(key);
      }
      return { roles, pending };
    });
  },
}));
export function useCardRoles(name: string): string[] {
  return useCardRolesStore((state) => state.roles[normalize(name)] ?? EMPTY_ROLES);
}
