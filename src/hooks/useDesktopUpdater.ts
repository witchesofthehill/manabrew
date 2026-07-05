import { useEffect } from "react";
import { toast } from "sonner";
import type { Update } from "@tauri-apps/plugin-updater";
import { getPlatformType } from "@/platform";
import { useDesktopUpdateStore } from "@/stores/useDesktopUpdateStore";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let pendingUpdate: Update | null = null;

export async function installDesktopUpdate() {
  const { phase, setDownloading, setFailed } = useDesktopUpdateStore.getState();
  const update = pendingUpdate;
  if (!update || phase === "downloading") return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  let contentLength = 0;
  let downloaded = 0;
  setDownloading(null);
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
      } else if (event.event === "Progress" && contentLength > 0) {
        downloaded += event.data.chunkLength;
        setDownloading(Math.min(100, Math.round((downloaded / contentLength) * 100)));
      } else if (event.event === "Finished") {
        setDownloading(100);
      }
    });
    await relaunch();
  } catch (err) {
    console.error("[Updater] install failed", err);
    toast.error("Update failed to install. You can retry from the sidebar.");
    setFailed();
  }
}

export async function checkForDesktopUpdate(): Promise<boolean> {
  if (pendingUpdate) return true;
  const updater = await import("@tauri-apps/plugin-updater");
  const update = await updater.check();
  if (!update) return false;
  if (!pendingUpdate) {
    pendingUpdate = update;
    useDesktopUpdateStore.getState().setAvailable(update.version);
  }
  return true;
}

export function useDesktopUpdater() {
  useEffect(() => {
    if (getPlatformType() !== "tauri") return;

    const check = () =>
      checkForDesktopUpdate().catch((err) => console.warn("[Updater] check failed", err));

    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
