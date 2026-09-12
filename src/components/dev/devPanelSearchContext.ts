import { createContext, useContext } from "react";

export const DevPanelSearchContext = createContext("");

export function useDevPanelSearch(): string {
  return useContext(DevPanelSearchContext);
}

export function matchesDevPanelSearch(query: string, ...terms: Array<string | number>): boolean {
  if (!query) return true;
  return terms.some((term) => String(term).toLocaleLowerCase().includes(query));
}
