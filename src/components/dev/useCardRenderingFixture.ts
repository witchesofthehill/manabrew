import { useEffect, useState } from "react";
import { useScryfallStore, type ScryfallEntry } from "@/stores/useScryfallStore";
import type { CardRenderingFixture } from "./cardRendering.data";

type Entry = NonNullable<ScryfallEntry["card"]>;

export function useCardRenderingFixture(fixture: CardRenderingFixture) {
  const [result, setResult] = useState<{
    id: string;
    locale: string;
    entry?: Entry;
    error?: string;
  }>();
  const locale = useScryfallStore((state) => state.locale);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const store = useScryfallStore.getState();
      const lookup = fixture.lookup;
      const query =
        fixture.query ??
        (lookup?.name && lookup.setCode && !lookup.collectorNumber
          ? `!"${lookup.name}" set:${lookup.setCode} unique:prints`
          : undefined);
      const match = query
        ? (await store.searchCards(query, 1, "released", "asc")).data[0]
        : undefined;
      if (query && !match) throw new Error("No printing matched this fixture.");
      const entry = await store.getCard(match ? { id: match.id } : lookup!);
      if (!cancelled) setResult({ id: fixture.id, locale, entry });
    };
    void load().catch((cause: unknown) => {
      if (!cancelled)
        setResult({
          id: fixture.id,
          locale,
          error: cause instanceof Error ? cause.message : String(cause),
        });
    });
    return () => {
      cancelled = true;
    };
  }, [fixture, locale]);
  return result?.id === fixture.id && result.locale === locale ? result : undefined;
}
