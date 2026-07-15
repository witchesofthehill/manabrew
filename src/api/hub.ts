import { getHubApiUrl } from "@/config/webRuntimeConfig";
import { platformFetch } from "@/lib/platformFetch";
import type {
  HubDeckDetail,
  HubDeckList,
  PublishDeckRequest,
  PublishDeckResponse,
  TopDeckStat,
} from "@/api/hubTypes";

export type HubSort = "newest" | "name";
export type TopDecksWindow = "7d" | "30d" | "all";

export interface HubListParams {
  search?: string;
  format?: string;
  sort?: HubSort;
  page?: number;
  pageSize?: number;
}

const MANAGEMENT_TOKEN_HEADER = "X-Management-Token";

async function hubRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await platformFetch(`${getHubApiUrl()}${path}`, init);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new Error("Too many publishes from your connection — try again later.");
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

export async function unpublishDeck(id: string, managementToken: string): Promise<void> {
  await hubRequest(`/api/hub/decks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { [MANAGEMENT_TOKEN_HEADER]: managementToken },
  });
}

export function fetchTopDecks(window: TopDecksWindow, limit = 25): Promise<TopDeckStat[]> {
  return hubJson<TopDeckStat[]>(`/api/stats/top-decks?window=${window}&limit=${limit}`);
}
