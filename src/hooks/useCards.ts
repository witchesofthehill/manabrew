import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { ScryfallListResponse } from "@/types/scryfall";

type CardSearchStatus = "pending" | "error" | "success";

interface CardSearchData {
  pages: ScryfallListResponse[];
}

export function useCardSearch(query: string, order?: string, dir?: string) {
  const requestIdRef = useRef(0);
  const [pages, setPages] = useState<ScryfallListResponse[]>([]);
  const [status, setStatus] = useState<CardSearchStatus>("pending");
  const [error, setError] = useState<Error | null>(null);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setPages([]);
    setError(null);

    if (query.length === 0) {
      setStatus("pending");
      setIsFetchingNextPage(false);
      return;
    }

    setStatus("pending");
    setIsFetchingNextPage(true);
    useScryfallStore
      .getState()
      .searchCards(query, 1, order, dir)
      .then((page) => {
        if (requestId !== requestIdRef.current) return;
        setPages([page]);
        setStatus("success");
      })
      .catch((caught) => {
        if (requestId !== requestIdRef.current) return;
        setError(caught instanceof Error ? caught : new Error("Failed to fetch cards"));
        setStatus("error");
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setIsFetchingNextPage(false);
      });
  }, [query, order, dir]);

  const hasNextPage = pages.at(-1)?.has_more ?? false;

  const fetchNextPage = useCallback(async () => {
    if (query.length === 0 || isFetchingNextPage) return;
    const nextPage = pages.length + 1;
    setIsFetchingNextPage(true);
    try {
      const page = await useScryfallStore.getState().searchCards(query, nextPage, order, dir);
      setPages((current) => [...current, page]);
      setStatus("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Failed to fetch cards"));
      setStatus("error");
    } finally {
      setIsFetchingNextPage(false);
    }
  }, [dir, isFetchingNextPage, order, pages.length, query]);

  const data = useMemo<CardSearchData | undefined>(
    () => (pages.length > 0 ? { pages } : undefined),
    [pages],
  );

  return {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  };
}
