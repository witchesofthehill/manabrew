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

export function friendlyCubeError(err: unknown, input: string): string {
  const msg = String(err ?? "");
  if (/404|not.?found|http 404/i.test(msg)) {
    return `Cube "${input}" not found on CubeCobra. Double-check the id or URL.`;
  }
  if (/network|failed to fetch|timeout|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    return "Network error reaching CubeCobra. Check your connection and try again.";
  }
  if (/parse|deserial|JSON|malformed|invalid/i.test(msg)) {
    return `CubeCobra returned an unexpected response for "${input}". The cube may be private or its format unsupported.`;
  }
  if (/empty|0 cards/i.test(msg)) {
    return `Cube "${input}" appears empty.`;
  }
  return msg.length > 200 ? `${msg.slice(0, 197)}…` : msg;
}

async function importCubeRaw(cubeIdOrUrl: string): Promise<CubeImportResult> {
  const platform = getPlatform();
  const url = await platform.invoke<string>("limited_cubecobra_url", { cubeIdOrUrl });
  const body = await platformFetchText(url);
  return platform.invoke<CubeImportResult>("limited_import_cube", {
    request: { cubeIdOrUrl },
    body,
  });
}

export async function fetchCubeMetadata(cubeIdOrUrl: string): Promise<CubeImportResult> {
  try {
    return await importCubeRaw(cubeIdOrUrl);
  } catch (err) {
    throw new Error(friendlyCubeError(err, cubeIdOrUrl), { cause: err });
  }
}

export async function fetchCubePool(cubeIdOrUrl: string): Promise<DraftCard[]> {
  const result = await fetchCubeMetadata(cubeIdOrUrl);
  if (!result.pool || result.pool.length === 0) {
    throw new Error(`Cube "${cubeIdOrUrl}" came back empty`);
  }
  return result.pool;
}
