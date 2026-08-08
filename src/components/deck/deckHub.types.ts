import type { DeckHubColorMatch, DeckHubSort, DeckHubSource, DeckHubTagMatch } from "@/api/hub";

export type DeckHubGroup = "none" | "source" | "format" | "color" | "tag";

export interface DeckHubDiscoveryFilters {
  search: string;
  source: DeckHubSource;
  formats: string[];
  colors: string;
  colorMatch: DeckHubColorMatch;
  tags: string[];
  tagMatch: DeckHubTagMatch;
  commander: string;
  card: string;
  favorites: boolean;
  sort: DeckHubSort;
  group: DeckHubGroup;
}
