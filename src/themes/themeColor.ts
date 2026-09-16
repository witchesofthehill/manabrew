export function parseThemeColor(value: string): { hex: string; alpha: number } | null {
  const trimmed = value.trim();
  const hexMatch = trimmed.match(/^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hexMatch) {
    const raw = hexMatch[1]!;
    const full =
      raw.length <= 4
        ? raw
            .split("")
            .map((char) => char + char)
            .join("")
        : raw;
    return {
      hex: `#${full.slice(0, 6).toLowerCase()}`,
      alpha: full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1,
    };
  }
  const rgbaMatch = trimmed.match(
    /^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i,
  );
  if (!rgbaMatch || (rgbaMatch[1]!.toLowerCase() === "rgba") !== (rgbaMatch[5] != null))
    return null;
  const channels = [Number(rgbaMatch[2]), Number(rgbaMatch[3]), Number(rgbaMatch[4])];
  const alpha = rgbaMatch[5] == null ? 1 : Number(rgbaMatch[5]);
  if (channels.some((channel) => channel > 255) || alpha < 0 || alpha > 1) return null;
  return {
    hex: `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
    alpha,
  };
}

export function toPickerHexColor(value: string): string {
  return parseThemeColor(value)?.hex ?? "#000000";
}

export function hexToRgb(value: string): { r: number; g: number; b: number } {
  const raw = toPickerHexColor(value).slice(1);
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

export function formatThemeColor(hex: string, alpha: number): string {
  const normalized = toPickerHexColor(hex);
  const opacity = Math.max(0, Math.min(1, alpha));
  if (opacity === 1) return normalized;
  const { r, g, b } = hexToRgb(normalized);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function withAlpha(value: string, alpha: number): string {
  const parsed = parseThemeColor(value);
  return formatThemeColor(parsed?.hex ?? value, (parsed?.alpha ?? 1) * alpha);
}

export function compositeThemeColor(foreground: string, background: string): string {
  const front = parseThemeColor(foreground);
  const back = parseThemeColor(background);
  if (!front || !back) throw new Error("Cannot composite an invalid theme color");
  const alpha = front.alpha + back.alpha * (1 - front.alpha);
  const fg = hexToRgb(front.hex);
  const bg = hexToRgb(back.hex);
  const channel = (f: number, b: number): string =>
    Math.round(alpha === 0 ? 0 : (f * front.alpha + b * back.alpha * (1 - front.alpha)) / alpha)
      .toString(16)
      .padStart(2, "0");
  return formatThemeColor(
    `#${channel(fg.r, bg.r)}${channel(fg.g, bg.g)}${channel(fg.b, bg.b)}`,
    alpha,
  );
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function contrastLuminance(hex: string): number {
  const toLinear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = contrastLuminance(foreground);
  const backgroundLuminance = contrastLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHexColors(from: string, to: string, amount: number): string {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const channel = (left: number, right: number): string =>
    Math.round(left + (right - left) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(start.r, end.r)}${channel(start.g, end.g)}${channel(start.b, end.b)}`;
}

export function ensureTextContrast(
  color: string,
  background: string,
  fallback: string,
  minimumRatio: number,
): string {
  if (contrastRatio(color, background) >= minimumRatio) return color;
  if (contrastRatio(fallback, background) < minimumRatio) return fallback;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const amount = (low + high) / 2;
    if (contrastRatio(mixHexColors(color, fallback, amount), background) >= minimumRatio) {
      high = amount;
    } else {
      low = amount;
    }
  }
  return mixHexColors(color, fallback, high);
}

export function readableTextColor(background: string, dark: string, light: string): string {
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

export function darken(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const k = Math.max(0, Math.min(1, 1 - factor));
  const to = (n: number) =>
    Math.round(n * k)
      .toString(16)
      .padStart(2, "0");
  return formatThemeColor(`#${to(r)}${to(g)}${to(b)}`, parseThemeColor(hex)?.alpha ?? 1);
}
