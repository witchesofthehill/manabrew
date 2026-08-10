import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type DesktopUpdatePhase = "idle" | "available" | "downloading";

interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  version: string | null;
  progress: number | null;
  calloutDismissed: boolean;
  setAvailable: (version: string) => void;
  setDownloading: (progress: number | null) => void;
  setFailed: () => void;
  dismissCallout: () => void;
}

export const useDesktopUpdateStore = create<DesktopUpdateState>()(
  devtools(
    (set) => ({
      phase: "idle",
      version: null,
      progress: null,
      calloutDismissed: false,
      setAvailable: (version) => set({ phase: "available", version, progress: null }),
      setDownloading: (progress) => set({ phase: "downloading", progress }),
      setFailed: () => set({ phase: "available", progress: null }),
      dismissCallout: () => set({ calloutDismissed: true }),
    }),
    { name: "desktopUpdate", enabled: import.meta.env.DEV },
  ),
);
