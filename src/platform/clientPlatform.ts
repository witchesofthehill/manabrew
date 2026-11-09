import { classifyAcquisition, type AcquisitionSource } from "@/lib/acquisitionSource";

export function getClientPlatform(): "web" | "pwa" | "desktop" | "mobile" {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "web";
  const tauri =
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined ||
    (window as Window & { __TAURI__?: unknown }).__TAURI__ !== undefined;
  if (tauri) {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "desktop";
  }
  const standalone =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "web";
}

const initialAcquisitionSource: AcquisitionSource =
  typeof window === "undefined" || typeof document === "undefined"
    ? "direct"
    : classifyAcquisition(window.location.href, document.referrer);

export function getAcquisitionSource(): AcquisitionSource {
  return initialAcquisitionSource;
}
