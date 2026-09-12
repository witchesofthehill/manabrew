import { parseThemeColor } from "@/themes/gameTheme";

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

  const parsed = parseThemeColor(trimmed);
  if (parsed) return Number.parseInt(parsed.hex.slice(1), 16);

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
  return parseThemeColor(hex)?.alpha ?? 1;
}
