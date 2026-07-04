import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { STORAGE_KEYS } from "@/lib/constants";

export type StatusSeverity = "info" | "warning" | "critical";

export interface StatusNotification {
  id: string;
  severity: StatusSeverity;
  message: string;
  link?: { label: string; url: string };
}

interface StatusBannerState {
  current: StatusNotification | null;
  dismissedIds: string[];
  setCurrent: (notification: StatusNotification | null) => void;
  dismiss: (id: string) => void;
}

export const useStatusBannerStore = create<StatusBannerState>()(
  devtools(
    persist(
      (set) => ({
        current: null,
        dismissedIds: [],
        setCurrent: (current) => set({ current }),
        dismiss: (id) =>
          set((state) =>
            state.dismissedIds.includes(id) ? state : { dismissedIds: [...state.dismissedIds, id] },
          ),
      }),
      {
        name: STORAGE_KEYS.STATUS_BANNER,
        version: 1,
        partialize: (state) => ({ dismissedIds: state.dismissedIds }),
      },
    ),
    { name: "statusBanner", enabled: import.meta.env.DEV },
  ),
);
