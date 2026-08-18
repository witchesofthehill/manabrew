export function getClientPlatform(): "web" | "pwa" | "desktop" | "mobile" {
  const tauri =
    typeof window !== "undefined" &&
    ((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined ||
      (window as Window & { __TAURI__?: unknown }).__TAURI__ !== undefined);
  if (tauri) {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "desktop";
  }
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "web";
}
