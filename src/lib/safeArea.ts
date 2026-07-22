export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function getSafeAreaInsets(): SafeAreaInsets {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: read("--safe-area-inset-top"),
    right: read("--safe-area-inset-right"),
    bottom: read("--safe-area-inset-bottom"),
    left: read("--safe-area-inset-left"),
  };
}
