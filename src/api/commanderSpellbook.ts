import { platformFetch } from "@/lib/platformFetch";

export const COMMANDER_SPELLBOOK_API = "https://backend.commanderspellbook.com";

interface DeckEntry {
  card: string;
  quantity: number;
}

export interface SpellbookComboCard {
  name: string;
  typeLine?: string;
  imageUriFrontNormal?: string | null;
}

export interface SpellbookCombo {
  id: string;
  description: string;
  status: string;
  identity: string;
  popularity: number | null;
  manaNeeded: string;
  manaValueNeeded: number;
  easyPrerequisites: string;
  notablePrerequisites: string;
  uses: { card: SpellbookComboCard; quantity: number }[];
  produces: { feature: { name: string } }[];
}

export interface FindMyCombosResult {
  identity: string;
  included: SpellbookCombo[];
  almostIncluded: SpellbookCombo[];
}

interface FindMyCombosResponse {
  results: FindMyCombosResult;
}

function toEntries(names: string[]): DeckEntry[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([card, quantity]) => ({ card, quantity }));
}

export async function findMyCombos(
  commanders: string[],
  main: string[],
): Promise<FindMyCombosResult> {
  const response = await platformFetch(`${COMMANDER_SPELLBOOK_API}/find-my-combos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commanders: toEntries(commanders), main: toEntries(main) }),
  });
  if (!response.ok) {
    throw new Error(`Commander Spellbook request failed (HTTP ${response.status})`);
  }
  const data: FindMyCombosResponse = await response.json();
  return data.results;
}
