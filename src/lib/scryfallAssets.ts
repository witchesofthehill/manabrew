const ASSET_BASE = import.meta.env.VITE_SCRYFALL_ASSET_BASE;

// Keep in sync with keyFor in scripts/sync-scryfall-assets.mjs.
const MIRRORED_HOSTS: ReadonlyArray<[origin: string, prefix: string]> = [
  ["https://svgs.scryfall.io/", ""],
  ["https://backs.scryfall.io/", "backs/"],
];

export const scryfallAssetsMirrored = Boolean(ASSET_BASE);

export function scryfallAssetUrl(url: string): string {
  if (!ASSET_BASE) return url;
  for (const [origin, prefix] of MIRRORED_HOSTS) {
    if (url.startsWith(origin)) {
      return `${ASSET_BASE}${prefix}${url.slice(origin.length).split("?")[0]}`;
    }
  }
  return url;
}
