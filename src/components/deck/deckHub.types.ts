import type { DeckHubColorMatch, DeckHubSort, DeckHubTagMatch } from "@/api/hub";

export type DeckHubView = "grid" | "list";
export type DeckHubGroup = "none" | "format" | "color" | "tag";

export interface DeckHubDiscoveryFilters {
  search: string;
  formats: string[];
  colors: string;
  colorMatch: DeckHubColorMatch;
  tags: string[];
  tagMatch: DeckHubTagMatch;
  commander: string;
  card: string;
  favorites: boolean;
  sort: DeckHubSort;
  view: DeckHubView;
  group: DeckHubGroup;
}
