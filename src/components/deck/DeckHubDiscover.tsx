import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DeckHubFilters } from "@/components/deck/DeckHubFilters";
import { DeckHubResults } from "@/components/deck/DeckHubResults";
import { availableEngines, hubEntryEngines, supportsAvailableEngine } from "@/lib/engines";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubEntrySummary } from "@/api/hubTypes";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { isFeatureEnabled } from "@/featureFlags";
import type { DeckHubEntryListParams } from "@/api/hub";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface DeckHubDiscoverProps {
  onOpen: (id: string) => void;
}

function csv(value: string | null) {
  return value?.split(",").filter(Boolean) ?? [];
}

export function DeckHubDiscover({ onOpen }: DeckHubDiscoverProps) {
  const ironsmithRuntimeOn = usePreferencesStore((state) => state.ironsmithRuntimeEnabled);
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
    group:
      searchParams.get("group") === "source" ||
      searchParams.get("group") === "format" ||
      searchParams.get("group") === "color" ||
      searchParams.get("group") === "tag"
        ? (searchParams.get("group") as DeckHubDiscoveryFilters["group"])
        : "none",
  };

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
    void fetchFacets();
  }, [fetchFacets]);

  const entryParams = useMemo<DeckHubEntryListParams>(
    () => ({
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
      engines: availableEngines(),
      sort: filters.sort,
      pageSize: PAGE_SIZE,
    }),
    [
      debouncedSearch,
      filters.card,
      filters.colorMatch,
      filters.colors,
      filters.commander,
      filters.favorites,
      filters.source,
      filters.sort,
      filters.tagMatch,
      formats,
      tags,
    ],
  );

  useEffect(() => {
    void fetchEntries({ ...entryParams, page: 1 });
  }, [entryParams, fetchEntries, ironsmithRuntimeOn, refreshKey, viewerAccountId]);

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
      ["group", "group", patch.group],
    ];
    for (const [filterKey, queryKey, value] of values) {
      if (value === undefined) continue;
      const defaults =
        (filterKey === "colorMatch" && value === "exact") ||
        (filterKey === "source" && value === "all") ||
        (filterKey === "tagMatch" && value === "any") ||
        (filterKey === "sort" && value === "newest") ||
        (filterKey === "group" && value === "none") ||
        value === false ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (defaults) next.delete(queryKey);
      else next.set(queryKey, Array.isArray(value) ? value.join(",") : String(value));
    }
    next.delete("format");
    next.delete("tag");
    next.delete("view");
    next.delete("page");
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

  const activeFilterCount =
    Number(Boolean(search)) +
    Number(filters.source !== "all") +
    Number(formats.length > 0) +
    Number(Boolean(filters.colors)) +
    Number(tags.length > 0) +
    Number(Boolean(filters.commander)) +
    Number(Boolean(filters.card)) +
    Number(filters.favorites);
  const total = entries?.total ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <DeckHubFilters
        filters={filters}
        facets={facets}
        activeFilterCount={activeFilterCount}
        favoritesEnabled={accountsEnabled}
        onChange={changeFilters}
        onClear={clearFilters}
      />
      <DeckHubResults
        entries={(entries?.entries ?? []).filter((entry) =>
          supportsAvailableEngine(hubEntryEngines(entry)),
        )}
        loading={entriesLoading}
        loaded={entries !== null}
        error={entriesError}
        total={total}
        hasFilters={activeFilterCount > 0}
        resetKey={JSON.stringify(entryParams)}
        group={filters.group}
        onOpen={onOpen}
        onAuthor={(author) => changeFilters({ search: author })}
        onFavorite={accountsEnabled ? favorite : undefined}
        onLoadMore={() =>
          void fetchEntries({ ...entryParams, page: (entries?.page ?? 1) + 1 }, true)
        }
        onClear={clearFilters}
        onRetry={() => setRefreshKey((value) => value + 1)}
      />
    </div>
  );
}
