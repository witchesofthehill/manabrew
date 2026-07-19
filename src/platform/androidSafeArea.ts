// Android's System WebView does not surface the status/navigation-bar insets to
// CSS env(safe-area-inset-*), so the Tauri shell (gen/android MainActivity)
// measures them natively and exposes them via a JS interface. Mirror them onto
// the --safe-area-inset-* custom properties the app already styles against;
// no-op on every other platform, which keeps its env()-backed defaults.
export function initAndroidSafeArea(): void {
  const bridge = window.__ANDROID_SAFE_AREA__;
  if (!bridge) return;

  const root = document.documentElement;
  const apply = () => {
    const insets = JSON.parse(bridge.getInsets()) as {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    root.style.setProperty("--safe-area-inset-top", `${insets.top}px`);
    root.style.setProperty("--safe-area-inset-right", `${insets.right}px`);
    root.style.setProperty("--safe-area-inset-bottom", `${insets.bottom}px`);
    root.style.setProperty("--safe-area-inset-left", `${insets.left}px`);
  };

  apply();
  window.addEventListener("android-safe-area-changed", apply);
  window.addEventListener("orientationchange", apply);
  window.addEventListener("resize", apply);
}
