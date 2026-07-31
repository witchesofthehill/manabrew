import { getHubApiUrl } from "@/config/webRuntimeConfig";
import { platformFetch } from "@/lib/platformFetch";
import { useAuthStore } from "@/stores/useAuthStore";
import type {
  AccountDeckDetail,
  AccountDeckList,
  CreateAccountDeckRequest,
  DeckHubEntryDetail,
  DeckHubEntryList,
  DeckHubFacets,
  DeckHubTag,
  DeckVersionDetail,
  DeckVersionSummary,
  FavoriteResponse,
  HubCapabilities,
  HubDeckDetail,
  HubDeckList,
  PublishDeckHubEntryRequest,
  PublishDeckRequest,
  PublishDeckResponse,
  SaveDeckVersionRequest,
  TopDeckBucket,
  TopDeckSnapshot,
  UpdateDeckHubEntryRequest,
} from "@/api/hubTypes";

export type HubSort = "newest" | "name";
export type DeckHubSort = "newest" | "name" | "favorites";
export type DeckHubColorMatch = "exact" | "includes";
export type DeckHubTagMatch = "any" | "all";

export interface HubListParams {
  search?: string;
  format?: string;
  sort?: HubSort;
  page?: number;
  pageSize?: number;
}

export interface DeckHubEntryListParams {
  search?: string;
  formats?: string[];
  colors?: string;
  colorMatch?: DeckHubColorMatch;
  tags?: string[];
  tagMatch?: DeckHubTagMatch;
  commander?: string;
  card?: string;
  favorites?: boolean;
  sort?: DeckHubSort;
  page?: number;
  pageSize?: number;
}

const MANAGEMENT_TOKEN_HEADER = "X-Management-Token";

async function hubRequest(path: string, init?: RequestInit): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await platformFetch(`${getHubApiUrl()}${path}`, { ...init, headers });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new Error("Too many Deck Hub requests from your connection. Try again later.");
    }
    if (response.status === 401) {
      if (token && useAuthStore.getState().token === token) {
        useAuthStore.setState({ token: null, account: null, identities: [], status: "signedOut" });
      }
      throw new Error(
        token
          ? "Your Deck Hub session expired. Sign in again."
          : "Sign in to publish decks to the Deck Hub.",
      );
    }
    if (response.status === 409) {
      throw new Error(message || "This deck changed on another device. Reload it and try again.");
    }
    throw new Error(message || `Hub request failed (${response.status})`);
  }
  return response;
}

async function hubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await hubRequest(path, init);
  return (await response.json()) as T;
}

export function fetchHubDecks(params: HubListParams): Promise<HubDeckList> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.format) query.set("format", params.format);
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  return hubJson<HubDeckList>(`/api/hub/decks${suffix}`);
}

export function fetchHubDeck(id: string): Promise<HubDeckDetail> {
  return hubJson<HubDeckDetail>(`/api/hub/decks/${encodeURIComponent(id)}`);
}

export function publishDeck(request: PublishDeckRequest): Promise<PublishDeckResponse> {
  return hubJson<PublishDeckResponse>("/api/hub/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function unpublishDeck(id: string, managementToken?: string): Promise<void> {
  const headers = managementToken ? { [MANAGEMENT_TOKEN_HEADER]: managementToken } : undefined;
  await hubRequest(`/api/hub/decks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });
}

export function fetchMyDecks(): Promise<HubDeckList> {
  return hubJson<HubDeckList>("/api/hub/my-decks");
}

export function fetchHubCapabilities(): Promise<HubCapabilities | null> {
  return hubRequest("/api/hub/capabilities")
    .then((response) => response.json() as Promise<HubCapabilities>)
    .catch(() => null);
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
  if (params.formats?.length) query.set("formats", params.formats.join(","));
  if (params.colors) query.set("colors", params.colors);
  if (params.colorMatch) query.set("colorMatch", params.colorMatch);
  if (params.tags?.length) query.set("tags", params.tags.join(","));
  if (params.tagMatch) query.set("tagMatch", params.tagMatch);
  if (params.commander) query.set("commander", params.commander);
  if (params.card) query.set("card", params.card);
  if (params.favorites) query.set("favorites", "true");
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
