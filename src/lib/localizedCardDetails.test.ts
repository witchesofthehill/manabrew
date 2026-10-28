import { describe, expect, it, vi } from "vitest";
import { createLocalizedCardDetailsCache, type LocalizedCardDetails } from "./localizedCardDetails";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const details: LocalizedCardDetails = {
  name: "Fulmine",
  typeLine: "Istantaneo",
  text: "Fulmine infligge 3 danni a qualsiasi bersaglio.",
};

describe("localized card detail cache", () => {
  it("keys details by locale and requested printing", () => {
    const cache = createLocalizedCardDetailsCache(memoryStorage());
    cache.set("it", "lea", "161", details);

    expect(cache.get("it", "LEA", "161")).toEqual(details);
    expect(cache.get("es", "lea", "161")).toBeUndefined();
    expect(cache.get("it", "m10", "146")).toBeUndefined();
  });

  it("expires entries from the original fetch time", () => {
    const now = vi.fn(() => 1_000);
    const cache = createLocalizedCardDetailsCache(memoryStorage(), { now, ttlMs: 50 });
    cache.set("it", "lea", "161", details);
    now.mockReturnValue(1_051);

    expect(cache.get("it", "lea", "161")).toBeUndefined();
  });

  it("keeps at most the configured number of newest entries", () => {
    const cache = createLocalizedCardDetailsCache(memoryStorage(), { maxEntries: 2 });
    cache.set("it", "lea", "161", details);
    cache.set("it", "m10", "146", details);
    cache.set("it", "2ed", "179", details);

    expect(cache.get("it", "lea", "161")).toBeUndefined();
    expect(cache.get("it", "m10", "146")).toEqual(details);
    expect(cache.get("it", "2ed", "179")).toEqual(details);
  });

  it("keeps visible printing metadata pinned while trimming other entries", () => {
    const cache = createLocalizedCardDetailsCache(memoryStorage(), { maxEntries: 1 });
    cache.set("it", "lea", "161", details);
    cache.setProtectedKeys(["it::lea::161"]);
    cache.set("it", "m10", "146", details);

    expect(cache.get("it", "lea", "161")).toEqual(details);
    expect(cache.get("it", "m10", "146")).toBeUndefined();
    cache.setProtectedKeys([]);
    expect(cache.get("it", "lea", "161")).toEqual(details);
  });

  it("keeps persisted entries within the configured cap even when active keys are pinned", () => {
    const storage = memoryStorage();
    const cache = createLocalizedCardDetailsCache(storage, { maxEntries: 1 });
    cache.setProtectedKeys(["it::lea::161", "it::m10::146"]);
    cache.set("it", "lea", "161", details);
    cache.set("it", "m10", "146", details);

    expect(cache.get("it", "lea", "161")).toEqual(details);
    expect(cache.get("it", "m10", "146")).toEqual(details);
    const saved = JSON.parse(storage.getItem("manabrew.card-localizations.v1")!);
    expect(Object.keys(saved.entries)).toHaveLength(1);
  });

  it("persists only display metadata and the original fetch timestamp", () => {
    const storage = memoryStorage();
    const first = createLocalizedCardDetailsCache(storage, { now: () => 12_345 });
    first.set("it", "lea", "161", details);
    const second = createLocalizedCardDetailsCache(storage, { now: () => 12_346 });

    expect(second.get("it", "lea", "161")).toEqual(details);
    const saved = storage.getItem("manabrew.card-localizations.v1")!;
    expect(saved).toContain('"fetchedAt":12345');
    expect(saved).toContain('"schemaVersion":1');
    expect(saved).not.toContain("oracle_id");
    expect(saved).not.toContain("image_uris");
  });

  it("ignores unsupported persisted schemas and tolerates blocked storage", () => {
    const storage = memoryStorage();
    storage.setItem(
      "manabrew.card-localizations.v1",
      JSON.stringify({ schemaVersion: 2, entries: { "it::lea::161": { details, fetchedAt: 10 } } }),
    );
    const cache = createLocalizedCardDetailsCache(storage);
    expect(cache.get("it", "lea", "161")).toBeUndefined();

    const blocked = createLocalizedCardDetailsCache({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => blocked.set("it", "lea", "161", details)).not.toThrow();
    expect(blocked.get("it", "lea", "161")).toEqual(details);
  });
});
