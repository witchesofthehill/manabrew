import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/dev/designSystem/kit";
import { THEME_PRESETS, type GameThemeColorKey, type ThemeColors } from "@/themes";
import { compositeThemeColor, contrastRatio, getGameThemeColorPaths } from "@/themes/gameTheme";
import type { Theme } from "@/hooks/useTheme";
import type { ThemeDocument } from "@/themes/themeDocument";
import { getGameColor } from "./themeEditorColors";

const APP_PAIRS: { label: string; foreground: keyof ThemeColors; background: keyof ThemeColors }[] =
  [
    { label: "Page text", foreground: "foreground", background: "background" },
    { label: "Card text", foreground: "card-foreground", background: "card" },
    { label: "Popover text", foreground: "popover-foreground", background: "popover" },
    {
      label: "Primary and priority action",
      foreground: "primary-foreground",
      background: "primary",
    },
    { label: "Secondary action", foreground: "secondary-foreground", background: "secondary" },
    { label: "Accent text", foreground: "accent-foreground", background: "accent" },
    {
      label: "Destructive action",
      foreground: "destructive-foreground",
      background: "destructive",
    },
    { label: "Muted text on page", foreground: "muted-foreground", background: "background" },
    { label: "Muted text on muted", foreground: "muted-foreground", background: "muted" },
    { label: "Selected text", foreground: "selection-foreground", background: "selection" },
  ];
const TINTED_KEYS = getGameThemeColorPaths().filter((key) =>
  ["counter.", "pt."].some((prefix) => key.startsWith(prefix)),
);

function ContrastPair({
  label,
  foreground,
  background,
  backdrop,
}: {
  label: string;
  foreground: string;
  background: string;
  backdrop: string;
}) {
  const surface = compositeThemeColor(background, backdrop);
  const ink = compositeThemeColor(foreground, surface);
  const ratio = contrastRatio(ink, surface);
  return (
    <div className="flex items-center gap-2 py-1.5 text-[11px]">
      <span
        className="rounded px-1.5 py-1 font-medium"
        style={{ color: ink, backgroundColor: surface }}
      >
        Aa
      </span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      <span className="shrink-0 text-right tabular-nums">
        {ratio.toFixed(2)}:1
        <span className="block text-[10px] text-muted-foreground">
          {ratio >= 4.5 ? "AA text" : ratio >= 3 ? "Large text only" : "Low text contrast"}
        </span>
      </span>
    </div>
  );
}

export function ThemeContrastPreview({
  theme,
  document,
}: {
  theme: Theme;
  document: ThemeDocument;
}) {
  const { appTheme: app, gameTheme: game } = theme;
  const preset = THEME_PRESETS.find((item) => item.id === document.presetId)!;
  const page = compositeThemeColor(app.background, preset[document.mode].background);
  const canvas = compositeThemeColor(game.canvas.background, page);
  const canvasPairs: {
    label: string;
    foreground: GameThemeColorKey;
    background: GameThemeColorKey;
  }[] = [
    { label: "Empty-zone label", foreground: "textMuted", background: "canvas.background" },
    { label: "Loading card name", foreground: "textGhost", background: "cardPlaceholder.fill" },
    ...(["attackAction", "defenseAction", "cancel"] as const).map((action) => ({
      label: `Prompt ${action}`,
      foreground: `promptForeground.${action}` as const,
      background: `promptAction.${action}` as const,
    })),
    ...TINTED_KEYS.map((background) => ({
      label: background,
      foreground: "textOnTinted" as const,
      background,
    })),
  ];
  return (
    <details className="border-b border-border pb-3">
      <summary className="cursor-pointer text-xs font-medium">
        React examples and text contrast
      </summary>
      <div className="space-y-3 pt-3">
        <Panel className="space-y-2 p-3 text-card-foreground">
          <div className="flex flex-wrap gap-1">
            <Button size="sm">Primary</Button>
            <Button size="sm" variant="secondary">
              Secondary
            </Button>
            <Button size="sm" variant="destructive">
              Delete
            </Button>
            <Button size="sm" variant="outline">
              Secondary outline
            </Button>
            <Button size="sm" disabled>
              Disabled
            </Button>
          </div>
          <Input
            aria-label="Theme input example"
            placeholder="Focus or type here"
            className="h-8 text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Muted text. Hover buttons or focus the input to inspect accents and rings.
          </p>
        </Panel>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Text pairs use 4.5:1 for normal text and 3:1 for large text. Alpha is composited over the
          page or canvas. Decorative borders and shadows are not text failures.
        </p>
        <div className="divide-y divide-border">
          {APP_PAIRS.map((pair) => (
            <ContrastPair
              key={pair.label}
              label={pair.label}
              foreground={app[pair.foreground]}
              background={app[pair.background]}
              backdrop={pair.background === "background" ? preset[document.mode].background : page}
            />
          ))}
          {canvasPairs.map((pair) => (
            <ContrastPair
              key={pair.label}
              label={pair.label}
              foreground={getGameColor(game, pair.foreground)}
              background={getGameColor(game, pair.background)}
              backdrop={pair.background === "canvas.background" ? page : canvas}
            />
          ))}
        </div>
      </div>
    </details>
  );
}
