function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function hexToNum(color: string): number {
  const trimmed = color.trim();

  const bare = trimmed.replace("#", "");
  if (/^[\da-fA-F]{3}$/.test(bare)) {
    return parseInt(
      bare
        .split("")
        .map((c) => c + c)
        .join(""),
      16,
    );
  }
  if (/^[\da-fA-F]{6}$/.test(bare)) return parseInt(bare, 16);

  const rgbaMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgbaMatch) {
    const r = Math.min(255, parseInt(rgbaMatch[1]!, 10));
    const g = Math.min(255, parseInt(rgbaMatch[2]!, 10));
    const b = Math.min(255, parseInt(rgbaMatch[3]!, 10));
    return (r << 16) | (g << 8) | b;
  }

  const hslMatch =
    trimmed.match(/^(?:hsl\(\s*)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)?$/i) ??
    trimmed.match(/^hsl\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/i);
  if (hslMatch) {
    const [r, g, b] = hslToRgb(
      parseFloat(hslMatch[1]!),
      parseFloat(hslMatch[2]!),
      parseFloat(hslMatch[3]!),
    );
    return (r << 16) | (g << 8) | b;
  }

  return 0;
}

export function colorAlpha(hex: string): number {
  const rgbaMatch = hex.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (rgbaMatch && rgbaMatch[1] != null) return parseFloat(rgbaMatch[1]);
  return 1;
}
