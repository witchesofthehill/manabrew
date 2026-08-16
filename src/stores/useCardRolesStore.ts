import { create } from "zustand";

import { getPlatform } from "@/platform";
import type { DeckCard } from "@/protocol/deck";

export const CARD_ROLE_LABELS: Record<string, string> = {
  "card-draw": "Card draw",
  counterspell: "Counterspell",
  counters: "Counters",
  discard: "Discard",
  interaction: "Interaction",
  lifegain: "Lifegain",
  protection: "Protection",
  ramp: "Ramp",
  recursion: "Recursion",
  removal: "Removal",
  "token-maker": "Token maker",
  tutor: "Tutor",
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
