import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DRAFTABLE_SET_TYPES } from "@/components/limited/setFilters";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { fetchEditionInfo } from "@/api/limitedEdition";
import type { EditionInfo } from "@/api/limitedEdition";

export function useLimitedSetSelection() {
  const allSets = useScryfallStore((state) => state.sets);
  const prefetchSet = useScryfallStore((state) => state.prefetchSet);
  const locale = useScryfallStore((state) => state.locale);
  const sets = useMemo(
    () =>
      [...allSets]
        .filter(
          (set) => DRAFTABLE_SET_TYPES.has(set.set_type) && !set.digital && set.card_count > 0,
        )
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? "")),
    [allSets],
  );
  const [selectedCode, setSelectedCode] = useState("");
  const [prefetching, setPrefetching] = useState<string | null>(null);
  const [info, setInfo] = useState<EditionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState("");
  const selectionGeneration = useRef(0);
  const previousLocale = useRef(locale);
  const prepareSet = useCallback(
    async (code: string) => {
      const generation = ++selectionGeneration.current;
      const language = useScryfallStore.getState().locale;
      setPrefetching(code || null);
      if (!code) return;
      try {
        await prefetchSet(code);
      } catch (error) {
        if (
          selectionGeneration.current === generation &&
          useScryfallStore.getState().locale === language
        ) {
          useLimitedStore.setState({ lastError: String(error) });
        }
      } finally {
        if (
          selectionGeneration.current === generation &&
          useScryfallStore.getState().locale === language
        ) {
          setPrefetching(null);
        }
      }
    },
    [prefetchSet],
  );
  useEffect(
    () => () => {
      selectionGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    void prepareSet(selectedCode);
  }, [locale, selectedCode, prepareSet]);
  useEffect(() => {
    if (!selectedCode) return;
    let cancelled = false;
    fetchEditionInfo(selectedCode).then((edition) => {
      if (!cancelled) {
        setInfo(edition);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCode]);
  const onSelect = async (code: string) => {
    code = code.toLowerCase();
    setSelectedCode(code);
    if (code !== selectedCode) {
      setInfo(null);
      setSelectedVariant("");
      setLoading(Boolean(code));
    }
    await prepareSet(code);
  };
  return {
    sets,
    selectedCode,
    prefetching,
    info,
    loading,
    selectedVariant,
    onVariantChange: setSelectedVariant,
    onSelect,
  };
}
