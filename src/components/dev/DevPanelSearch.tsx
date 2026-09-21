import type { ReactNode } from "react";

import {
  DevPanelSearchContext,
  matchesDevPanelSearch,
  useDevPanelSearch,
} from "./devPanelSearchContext";

interface DevPanelSearchProviderProps {
  query: string;
  children: ReactNode;
}

export function DevPanelSearchProvider({ query, children }: DevPanelSearchProviderProps) {
  return (
    <DevPanelSearchContext.Provider value={query.trim().toLocaleLowerCase()}>
      {children}
    </DevPanelSearchContext.Provider>
  );
}

interface DevSearchableProps {
  terms: Array<string | number>;
  children: ReactNode;
}

export function DevSearchable({ terms, children }: DevSearchableProps) {
  const query = useDevPanelSearch();
  return matchesDevPanelSearch(query, ...terms) ? children : null;
}
