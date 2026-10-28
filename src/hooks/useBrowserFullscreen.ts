import { useSyncExternalStore } from "react";
import { toggleBrowserFullscreen } from "@/lib/browserFullscreen";

function subscribe(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function getSnapshot(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

export function useBrowserFullscreen() {
  const isFullscreen = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return { isFullscreen, toggleFullscreen: toggleBrowserFullscreen };
}
