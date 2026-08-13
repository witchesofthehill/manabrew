import { getPlatformType } from "@/platform";

// `window.open` does not reach the system browser from the desktop webview, so
// anything that hands the user off to an external page must go through the
// opener plugin there.
export async function openExternal(url: string): Promise<void> {
  if (getPlatformType() === "tauri") {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}
