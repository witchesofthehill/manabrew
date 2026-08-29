import type { EngineGameStats } from "@/lib/engineTelemetry";
import { getHubApiUrl } from "@/config/webRuntimeConfig";
import { platformFetch } from "@/lib/platformFetch";
import { getAccessToken, useAuthStore } from "@/stores/useAuthStore";
import type {
  AccountDeckDetail,
  AccountDeckList,
  CardCollection,
  CreateAccountDeckRequest,
  DeckHubEntryDetail,
  DeckHubEntryList,
  DeckHubFacets,
  DeckHubTag,
  DeckPlayReportRequest,
  DeckVersionDetail,
  DeckVersionSummary,
  FavoriteResponse,
  HubCapabilities,
  PublishDeckHubEntryRequest,
  SaveDeckVersionRequest,
  TopDeckBucket,
  TopDeckSnapshot,
  UpdateDeckHubEntryRequest,
  VerifyCardPrintingsRequest,
  VerifyCardPrintingsResponse,
} from "@/api/hubTypes";
import type { EngineKind } from "@/protocol";

export type DeckHubSort = "community" | "newest" | "name" | "favorites";
export type DeckHubColorMatch = "exact" | "includes";
export type DeckHubTagMatch = "any" | "all";
export type DeckHubSource = "all" | "community" | "presets";

export interface DeckHubEntryListParams {
  search?: string;
  source?: DeckHubSource;
  formats?: string[];
  colors?: string;
  colorMatch?: DeckHubColorMatch;
  tags?: string[];
  tagMatch?: DeckHubTagMatch;
  commander?: string;
  card?: string;
  favorites?: boolean;
  owned?: boolean;
  engines?: EngineKind[];
  sort?: DeckHubSort;
  page?: number;
  pageSize?: number;
}

export class HubRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function hubRequest(path: string, init?: RequestInit): Promise<Response> {
  const refreshToken = useAuthStore.getState().refreshToken;
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await platformFetch(`${getHubApiUrl()}${path}`, { ...init, headers });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new HubRequestError(
        response.status,
        "Too many Community requests from your connection. Try again later.",
      );
    }
    if (response.status === 401) {
      if (token && useAuthStore.getState().refreshToken === refreshToken) {
        useAuthStore.setState({
          refreshToken: null,
          account: null,
          identities: [],
          status: "signedOut",
        });
      }
      throw new HubRequestError(
        response.status,
        token ? "Your session expired. Sign in again." : "Sign in to publish decks to Community.",
      );
    }
    if (response.status === 409) {
      throw new HubRequestError(
        response.status,
        message || "This deck changed on another device. Reload it and try again.",
      );
    }
    throw new HubRequestError(
      response.status,
      message || `Hub request failed (${response.status})`,
    );
  }
  return response;
}

export async function hubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await hubRequest(path, init);
  return (await response.json()) as T;
}

export function fetchHubCapabilities(): Promise<HubCapabilities> {
  return hubJson<HubCapabilities>("/api/hub/capabilities");
}

export function fetchAccountCollection(): Promise<CardCollection> {
  return hubJson<CardCollection>("/api/collection");
}

export async function verifyCardPrintings(
  request: VerifyCardPrintingsRequest,
  onBatch?: (matched: boolean[], offset: number, total: number) => void,
): Promise<VerifyCardPrintingsResponse> {
  const matched: boolean[] = [];
  for (let index = 0; index < request.identifiers.length; index += 5_000) {
    const identifiers = request.identifiers.slice(index, index + 5_000);
    const response = await hubJson<VerifyCardPrintingsResponse>("/api/cards/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers }),
    });
    if (response.matched.length !== identifiers.length) {
      throw new Error("Card verification returned an incomplete response");
    }
    matched.push(...response.matched);
    onBatch?.(response.matched, index, request.identifiers.length);
  }
  return { matched };
}

export function saveAccountCollection(collection: CardCollection): Promise<CardCollection> {
  return hubRequest("/api/collection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collection),
  }).then(async (response) => {
    if (response.status === 204) {
      return { ...collection, version: (collection.version ?? 0) + 1 };
    }
    return (await response.json()) as CardCollection;
  });
}

export function fetchAccountDecks(): Promise<AccountDeckList> {
  return hubJson<AccountDeckList>("/api/decks");
}

export function createAccountDeck(request: CreateAccountDeckRequest): Promise<AccountDeckDetail> {
  return hubJson<AccountDeckDetail>("/api/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function fetchAccountDeck(id: string): Promise<AccountDeckDetail> {
  return hubJson<AccountDeckDetail>(`/api/decks/${encodeURIComponent(id)}`);
}

export function forkPresetDeck(presetKey: string): Promise<AccountDeckDetail> {
  return hubJson<AccountDeckDetail>(`/api/presets/${encodeURIComponent(presetKey)}/fork`, {
    method: "POST",
  });
}

export function saveAccountDeck(
  id: string,
  request: SaveDeckVersionRequest,
): Promise<AccountDeckDetail> {
  return hubJson<AccountDeckDetail>(`/api/decks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function deleteAccountDeck(id: string): Promise<void> {
  await hubRequest(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function fetchDeckVersions(id: string): Promise<DeckVersionSummary[]> {
  return hubJson<DeckVersionSummary[]>(`/api/decks/${encodeURIComponent(id)}/versions`);
}

export function fetchDeckVersion(id: string, versionNo: number): Promise<DeckVersionDetail> {
  return hubJson<DeckVersionDetail>(`/api/decks/${encodeURIComponent(id)}/versions/${versionNo}`);
}

export function fetchDeckHubEntries(params: DeckHubEntryListParams): Promise<DeckHubEntryList> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.source && params.source !== "all") query.set("source", params.source);
  if (params.formats?.length) query.set("formats", params.formats.join(","));
  if (params.colors) query.set("colors", params.colors);
  if (params.colorMatch) query.set("colorMatch", params.colorMatch);
  if (params.tags?.length) query.set("tags", params.tags.join(","));
  if (params.tagMatch) query.set("tagMatch", params.tagMatch);
  if (params.commander) query.set("commander", params.commander);
  if (params.card) query.set("card", params.card);
  if (params.favorites) query.set("favorites", "true");
  if (params.owned) query.set("owned", "true");
  if (params.engines?.length) query.set("engines", params.engines.join(","));
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  return hubJson<DeckHubEntryList>(`/api/deckhub/entries${suffix}`);
}

export function fetchDeckHubFacets(): Promise<DeckHubFacets> {
  return hubJson<DeckHubFacets>("/api/deckhub/facets");
}

export function fetchDeckHubEntry(entryRef: string): Promise<DeckHubEntryDetail> {
  return hubJson<DeckHubEntryDetail>(`/api/deckhub/entries/${encodeURIComponent(entryRef)}`);
}

export function createDeckHubEntry(
  request: PublishDeckHubEntryRequest,
): Promise<DeckHubEntryDetail> {
  return hubJson<DeckHubEntryDetail>("/api/deckhub/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export function updateDeckHubEntry(
  id: string,
  request: UpdateDeckHubEntryRequest,
): Promise<DeckHubEntryDetail> {
  return hubJson<DeckHubEntryDetail>(`/api/deckhub/entries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function removeDeckHubEntry(id: string): Promise<void> {
  await hubRequest(`/api/deckhub/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function fetchDeckHubTags(): Promise<DeckHubTag[]> {
  return hubJson<DeckHubTag[]>("/api/deckhub/tags");
}

export function setDeckHubFavorite(id: string, favorite: boolean): Promise<FavoriteResponse> {
  return hubJson<FavoriteResponse>(`/api/deckhub/entries/${encodeURIComponent(id)}/favorite`, {
    method: favorite ? "PUT" : "DELETE",
  });
}

export function fetchTopDeckBuckets(): Promise<TopDeckBucket[]> {
  return hubJson<TopDeckBucket[]>("/api/deckhub/top/buckets");
}

export function fetchTopDeckSnapshot(bucket: string, date?: string): Promise<TopDeckSnapshot> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return hubJson<TopDeckSnapshot>(`/api/deckhub/top/${encodeURIComponent(bucket)}${query}`);
}

export async function recordEngineStats(stats: EngineGameStats): Promise<void> {
  await hubRequest("/api/stats/engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stats),
  });
}

export async function recordDeckPlay(request: DeckPlayReportRequest): Promise<void> {
  await hubRequest("/api/deckhub/plays", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
