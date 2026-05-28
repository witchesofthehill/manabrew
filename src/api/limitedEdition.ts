import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getPlatform, getPlatformType } from "@/platform";
import type { CubeImportResult, DraftCard } from "@/types/limited";

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

async function platformFetchText(url: string): Promise<string> {
  if (getPlatformType() === "tauri") {
    const r = await tauriFetch(url, { method: "GET" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/**
 * Re-import a cube from CubeCobra and return its card pool. Used by the
 * multiplayer-draft host to resolve `DraftConfig.cubeId` to a pool at
 * start time — the cube list isn't stored on the room so we re-fetch on
 * each draft start (small upfront latency for a much smaller wire size).
 */
export async function fetchCubePool(cubeIdOrUrl: string): Promise<DraftCard[]> {
  const platform = getPlatform();
  const url = await platform.invoke<string>("limited_cubecobra_url", { cubeIdOrUrl });
  const body = await platformFetchText(url);
  const result = await platform.invoke<CubeImportResult>("limited_import_cube", {
    request: { cubeIdOrUrl },
    body,
  });
  if (!result.pool || result.pool.length === 0) {
    throw new Error(`Cube "${cubeIdOrUrl}" came back empty`);
  }
  return result.pool;
}
