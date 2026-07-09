import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { STORAGE_KEYS } from "@/lib/constants";

export interface PublishedDeckRecord {
  hubId: string;
  localDeckId: string | null;
  name: string;
  managementToken: string;
  publishedAt: number;
}

interface PublishedDecksState {
  published: PublishedDeckRecord[];
  addPublished: (record: PublishedDeckRecord) => void;
  removePublished: (hubId: string) => void;
}

export const usePublishedDecksStore = create<PublishedDecksState>()(
  devtools(
    persist(
      (set) => ({
        published: [],
        addPublished: (record) => set((s) => ({ published: [...s.published, record] })),
        removePublished: (hubId) =>
          set((s) => ({ published: s.published.filter((p) => p.hubId !== hubId) })),
      }),
      {
        name: STORAGE_KEYS.PUBLISHED_DECKS,
        storage: createJSONStorage(() => localStorage),
      },
    ),
    { name: "PublishedDecksStore" },
  ),
);

export function findPublishedByLocalDeckId(
  published: PublishedDeckRecord[],
  localDeckId: string | null,
): PublishedDeckRecord | undefined {
  if (!localDeckId) return undefined;
  return published.find((p) => p.localDeckId === localDeckId);
}
