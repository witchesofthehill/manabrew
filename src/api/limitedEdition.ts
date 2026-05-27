import { getPlatform } from "@/platform";
import type { DraftCard } from "@/types/limited";

export interface EditionSlot {
  label: string;
  count: number;
}

export interface EditionInfo {
  code: string;
  name: string;
  editionType: string;
  date: string | null;
  slots: EditionSlot[];
  foilChance: number;
  foilType: string;
  variants: string[];
  hasReplacementHooks: boolean;
  boosterCovers?: number;
  prerelease?: string | null;
  alias?: string | null;
}

export async function fetchEditionInfo(setCode: string): Promise<EditionInfo | null> {
  if (!setCode) return null;
  try {
    const result = await getPlatform().invoke<EditionInfo | null>("limited_get_edition_info", {
      setCode,
    });
    if (!result) {
      // Most common cause: the set has no `Booster=` line in Forge's data
      // (e.g. masters reprints, mini-drops, supplemental products), so the
      // engine can't tell us a recipe and the UI falls back to a generic
      // 10C/3U/1RM/1L booster. Log here so we can spot real engine miscues
      // (registry never populated, alias mismatch) instead of silently
      // swallowing them like before.
      console.warn(`[limited] no Forge edition info for set ${setCode}`);
    }
    return result ?? null;
  } catch (err) {
    console.warn(`[limited] limited_get_edition_info(${setCode}) threw:`, err);
    return null;
  }
}

/**
 * Generate the full card pool for a given set from the engine's cached
 * `EditionsRegistry` — no Scryfall round-trip. The DTO shape matches what
 * `limited_start_sealed` / `limited_start_booster_draft` expect for their
 * `setup.pool` field.
 */
export async function fetchSetPool(setCode: string): Promise<DraftCard[]> {
  return getPlatform().invoke<DraftCard[]>("limited_get_set_pool", { setCode });
}
