import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DeckHubFilters } from "@/components/deck/DeckHubFilters";
import { DeckHubResults } from "@/components/deck/DeckHubResults";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { isFeatureEnabled } from "@/featureFlags";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface DeckHubDiscoverProps {
  domainV2: boolean;
  onOpen: (id: string) => void;
}

function csv(value: string | null) {
  return value?.split(",").filter(Boolean) ?? [];
}

function positivePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function DeckHubDiscover({ domainV2, onOpen }: DeckHubDiscoverProps) {
  const accountsEnabled = isFeatureEnabled("accounts");
  const [searchParams, setSearchParams] = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(querySearch);
  const [debouncedSearch, setDebouncedSearch] = useState(querySearch);
  const [refreshKey, setRefreshKey] = useState(0);
  const formatsValue = searchParams.get("formats") ?? searchParams.get("format") ?? "";
  const tagsValue = searchParams.get("tags") ?? searchParams.get("tag") ?? "";
  const formats = useMemo(() => csv(formatsValue), [formatsValue]);
  const tags = useMemo(() => csv(tagsValue), [tagsValue]);
  const page = positivePage(searchParams.get("page"));
  const filters: DeckHubDiscoveryFilters = {
    search,
    source:
      searchParams.get("source") === "community" || searchParams.get("source") === "presets"
        ? (searchParams.get("source") as DeckHubDiscoveryFilters["source"])
        : "all",
    formats,
    colors: searchParams.get("colors") ?? "",
    colorMatch: searchParams.get("colorMatch") === "includes" ? "includes" : "exact",
    tags,
    tagMatch: searchParams.get("tagMatch") === "all" ? "all" : "any",
    commander: searchParams.get("commander") ?? "",
    card: searchParams.get("card") ?? "",
    favorites: accountsEnabled && searchParams.get("favorites") === "true",
    sort:
      searchParams.get("sort") === "name"
        ? "name"
        : searchParams.get("sort") === "favorites"
          ? "favorites"
          : "newest",
    view: searchParams.get("view") === "list" ? "list" : "grid",
    group:
      searchParams.get("group") === "source" ||
      searchParams.get("group") === "format" ||
      searchParams.get("group") === "color" ||
      searchParams.get("group") === "tag"
        ? (searchParams.get("group") as DeckHubDiscoveryFilters["group"])
        : "none",
  };

  const list = useHubStore((state) => state.list);
  const listLoading = useHubStore((state) => state.listLoading);
  const listError = useHubStore((state) => state.listError);
  const fetchDecks = useHubStore((state) => state.fetchDecks);
  const entries = useHubStore((state) => state.entries);
  const entriesLoading = useHubStore((state) => state.entriesLoading);
  const entriesError = useHubStore((state) => state.entriesError);
  const fetchEntries = useHubStore((state) => state.fetchEntries);
  const facets = useHubStore((state) => state.facets);
  const fetchFacets = useHubStore((state) => state.fetchFacets);
  const setFavorite = useHubStore((state) => state.setFavorite);
  const signedIn = useAuthStore((state) => accountsEnabled && state.status === "signedIn");
  const viewerAccountId = useAuthStore((state) =>
    accountsEnabled ? (state.account?.id ?? null) : null,
  );
  const showSignIn = useSignInDialog((state) => state.show);

  useEffect(() => {
    setSearch(querySearch);
    setDebouncedSearch(querySearch);
  }, [querySearch]);

  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [debouncedSearch, search]);

  useEffect(() => {
    if (querySearch === debouncedSearch) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set("q", debouncedSearch);
    else next.delete("q");
    next.delete("page");
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, querySearch, searchParams, setSearchParams]);

  useEffect(() => {
    if (domainV2) void fetchFacets();
  }, [domainV2, fetchFacets]);

  useEffect(() => {
    if (domainV2) {
      void fetchEntries({
        search: debouncedSearch || undefined,
        source: filters.source,
        formats,
        colors: filters.colors || undefined,
        colorMatch: filters.colorMatch,
        tags,
        tagMatch: filters.tagMatch,
        commander: filters.commander || undefined,
        card: filters.card || undefined,
        favorites: filters.favorites,
        sort: filters.sort,
        page,
        pageSize: PAGE_SIZE,
      });
      return;
    }
    void fetchDecks({
      search: debouncedSearch || undefined,
      format: formats[0],
      sort: filters.sort === "name" ? "name" : "newest",
      page,
      pageSize: PAGE_SIZE,
    });
  }, [
    debouncedSearch,
    domainV2,
    fetchDecks,
    fetchEntries,
    filters.card,
    filters.colorMatch,
    filters.colors,
    filters.commander,
    filters.favorites,
    filters.source,
    filters.sort,
    filters.tagMatch,
    formats,
    page,
    refreshKey,
    tags,
    viewerAccountId,
  ]);

  function changeFilters(patch: Partial<DeckHubDiscoveryFilters>) {
    if (patch.favorites && (!accountsEnabled || !signedIn)) {
      if (!accountsEnabled) return;
      showSignIn();
      return;
    }
    if (patch.search !== undefined) {
      setSearch(patch.search);
      if (!patch.search) setDebouncedSearch("");
    }
    const next = new URLSearchParams(searchParams);
    const values: [keyof DeckHubDiscoveryFilters, string, unknown][] = [
      ["formats", "formats", patch.formats],
      ["source", "source", patch.source],
      ["colors", "colors", patch.colors],
      ["colorMatch", "colorMatch", patch.colorMatch],
      ["tags", "tags", patch.tags],
      ["tagMatch", "tagMatch", patch.tagMatch],
      ["commander", "commander", patch.commander],
      ["card", "card", patch.card],
      ["favorites", "favorites", patch.favorites],
      ["sort", "sort", patch.sort],
      ["view", "view", patch.view],
      ["group", "group", patch.group],
    ];
    for (const [filterKey, queryKey, value] of values) {
      if (value === undefined) continue;
      const defaults =
        (filterKey === "colorMatch" && value === "exact") ||
        (filterKey === "source" && value === "all") ||
        (filterKey === "tagMatch" && value === "any") ||
        (filterKey === "sort" && value === "newest") ||
        (filterKey === "view" && value === "grid") ||
        (filterKey === "group" && value === "none") ||
        value === false ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (defaults) next.delete(queryKey);
      else next.set(queryKey, Array.isArray(value) ? value.join(",") : String(value));
    }
    next.delete("format");
    next.delete("tag");
    if (patch.view === undefined && patch.group === undefined) next.delete("page");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }

  function clearFilters() {
    changeFilters({
      search: "",
      source: "all",
      formats: [],
      colors: "",
      colorMatch: "exact",
      tags: [],
      tagMatch: "any",
      commander: "",
      card: "",
      favorites: false,
    });
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) next.set("page", String(nextPage));
    else next.delete("page");
    setSearchParams(next);
  }

  function favorite(entry: DeckHubEntrySummary) {
    if (!accountsEnabled) return;
    if (!signedIn) {
      showSignIn();
      return;
    }
    void setFavorite(entry.id, !entry.favorited)
      .then(() => {
        if (filters.favorites) setRefreshKey((value) => value + 1);
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Failed to update favorite"),
      );
  }

  const activeList = domainV2 ? entries : list;
  const activeFilterCount =
    Number(Boolean(search)) +
    Number(filters.source !== "all") +
    Number(formats.length > 0) +
    Number(Boolean(filters.colors)) +
    Number(tags.length > 0) +
    Number(Boolean(filters.commander)) +
    Number(Boolean(filters.card)) +
    Number(filters.favorites);
  const total = activeList?.total ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DeckHubFilters
        filters={filters}
        facets={facets}
        domainV2={domainV2}
        activeFilterCount={activeFilterCount}
        favoritesEnabled={accountsEnabled}
        signedIn={signedIn}
        onChange={changeFilters}
        onClear={clearFilters}
      />
      <DeckHubResults
        entries={entries?.entries ?? []}
        legacyDecks={list?.decks ?? []}
        domainV2={domainV2}
        loading={domainV2 ? entriesLoading : listLoading}
        loaded={activeList !== null}
        error={domainV2 ? entriesError : listError}
        total={total}
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        hasFilters={activeFilterCount > 0}
        view={filters.view}
        group={filters.group}
        onOpen={onOpen}
        onFavorite={accountsEnabled ? favorite : undefined}
        onPage={setPage}
        onClear={clearFilters}
        onRetry={() => setRefreshKey((value) => value + 1)}
      />
    </div>
  );
}
