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

function fallbackRoles(card: DeckCard): string[] {
  const text = card.text.toLowerCase();
  const roles = new Set<string>();
  if (card.types.includes("Land") || text.includes("add {")) roles.add("ramp");
  if (/draw (?:a|two|three|\d+) cards?/.test(text)) roles.add("card-draw");
  if (/destroy target|exile target|deals? \d+ damage to any target/.test(text)) {
    roles.add("interaction");
    roles.add("removal");
  }
  if (/search your library/.test(text)) roles.add("tutor");
  if (/return target .* from your graveyard/.test(text)) roles.add("recursion");
  if (/hexproof|indestructible|protection from/.test(text)) roles.add("protection");
  return [...roles];
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
          return [key, engineRoles.length > 0 ? engineRoles : fallbackRoles(card)] as const;
        } catch {
          return [key, fallbackRoles(card)] as const;
        }
      }),
    );
    set((state) => {
      const roles = { ...state.roles };
      const pending = new Set(state.pending);
      for (const [key, cardRoles] of results) {
        roles[key] = cardRoles;
        pending.delete(key);
      }
      return { roles, pending };
    });
  },
}));

export function useCardRoles(name: string): string[] {
  return useCardRolesStore((state) => state.roles[normalize(name)] ?? EMPTY_ROLES);
}
