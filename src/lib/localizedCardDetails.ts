import type { ScryfallLanguage } from "@/i18n/locales";
import type { ScryfallImageUris } from "@/types/scryfall";

export interface LocalizedCardDetails {
  name: string;
  typeLine: string;
  text: string;
  imageUris?: ScryfallImageUris;
  faces?: {
    name: string;
    typeLine: string;
    text: string;
    imageUris?: ScryfallImageUris;
  }[];
}

interface CacheEntry {
  details: LocalizedCardDetails | null;
  fetchedAt: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CacheOptions {
  key?: string;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

const STORAGE_KEY = "manabrew.card-localizations.v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function validDetails(value: unknown): value is LocalizedCardDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<LocalizedCardDetails>;
  const keys = Object.keys(value).sort().join(",");
  const allowedKeys = new Set([
    "name,text,typeLine",
    "imageUris,name,text,typeLine",
    "faces,name,text,typeLine",
    "faces,imageUris,name,text,typeLine",
  ]);
  return (
    allowedKeys.has(keys) &&
    typeof details.name === "string" &&
    typeof details.typeLine === "string" &&
    typeof details.text === "string" &&
    (details.imageUris === undefined || validImageUris(details.imageUris)) &&
    (details.faces === undefined ||
      (Array.isArray(details.faces) &&
        details.faces.every(
          (face) =>
            face &&
            (Object.keys(face).sort().join(",") === "name,text,typeLine" ||
              Object.keys(face).sort().join(",") === "imageUris,name,text,typeLine") &&
            typeof face.name === "string" &&
            typeof face.typeLine === "string" &&
            typeof face.text === "string" &&
            (face.imageUris === undefined || validImageUris(face.imageUris)),
        )))
  );
}

function validImageUris(value: unknown): value is ScryfallImageUris {
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).every((uri) => typeof uri === "string")
  );
}

function cardKey(locale: string, setCode: string, collectorNumber: string): string {
  return `${locale.toLowerCase()}::${setCode.toLowerCase()}::${collectorNumber.toLowerCase()}`;
}

export function localizedCardDetailsKey(
  locale: ScryfallLanguage,
  setCode: string,
  collectorNumber: string,
): string {
  return cardKey(locale, setCode, collectorNumber);
}

export function createLocalizedCardDetailsCache(
  storage: StorageLike | null = browserStorage(),
  options: CacheOptions = {},
) {
  const key = options.key ?? STORAGE_KEY;
  const ttlMs = options.ttlMs ?? TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  let protectedKeys = new Set<string>();
  let loaded = false;

  function persist() {
    try {
      const persisted = new Map(entries);
      while (persisted.size > maxEntries) {
        const oldest = [...persisted.keys()].find((entryKey) => !protectedKeys.has(entryKey));
        persisted.delete(oldest ?? persisted.keys().next().value!);
      }
      storage?.setItem(
        key,
        JSON.stringify({ schemaVersion: 1, entries: Object.fromEntries(persisted) }),
      );
    } catch {
      return;
    }
  }

  function trim() {
    const cutoff = now() - ttlMs;
    for (const [entryKey, entry] of entries) {
      if (!Number.isFinite(entry.fetchedAt) || entry.fetchedAt <= cutoff) {
        entries.delete(entryKey);
      }
    }
    while (entries.size > maxEntries) {
      const oldest = [...entries.keys()].find((entryKey) => !protectedKeys.has(entryKey));
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = storage?.getItem(key);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        schemaVersion?: number;
        entries?: Record<string, CacheEntry>;
      };
      if (
        Object.keys(parsed).sort().join(",") !== "entries,schemaVersion" ||
        parsed.schemaVersion !== 1 ||
        !parsed.entries ||
        typeof parsed.entries !== "object" ||
        Array.isArray(parsed.entries)
      )
        return;
      for (const [entryKey, entry] of Object.entries(parsed.entries)) {
        if (
          entry &&
          Object.keys(entry).sort().join(",") === "details,fetchedAt" &&
          Number.isFinite(entry.fetchedAt) &&
          (entry.details === null || validDetails(entry.details))
        ) {
          entries.set(entryKey, entry);
        }
      }
      trim();
    } catch {
      entries.clear();
    }
  }

  return {
    setProtectedKeys(keys: Iterable<string>) {
      load();
      protectedKeys = new Set(keys);
      trim();
      persist();
    },
    get(locale: ScryfallLanguage, setCode: string, collectorNumber: string) {
      load();
      trim();
      const entryKey = cardKey(locale, setCode, collectorNumber);
      const entry = entries.get(entryKey);
      if (!entry) return undefined;
      entries.delete(entryKey);
      entries.set(entryKey, entry);
      return entry.details;
    },
    set(
      locale: ScryfallLanguage,
      setCode: string,
      collectorNumber: string,
      details: LocalizedCardDetails | null,
    ) {
      load();
      const entryKey = cardKey(locale, setCode, collectorNumber);
      entries.delete(entryKey);
      entries.set(entryKey, { details, fetchedAt: now() });
      trim();
      persist();
    },
    has(locale: ScryfallLanguage, setCode: string, collectorNumber: string) {
      load();
      trim();
      return entries.has(cardKey(locale, setCode, collectorNumber));
    },
  };
}

export const localizedCardDetailsCache = createLocalizedCardDetailsCache();
