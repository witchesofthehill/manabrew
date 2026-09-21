import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  APP_THEME_COLOR_DESCRIPTIONS,
  APP_THEME_COLOR_LABELS,
  APP_THEME_GROUPS,
  GAME_THEME_COLOR_DESCRIPTIONS,
  GAME_THEME_GROUPS,
} from "@/themes/themeMetadata";
import { getGameThemeColorPaths } from "@/themes/gameTheme";
import type { GameThemeColorKey } from "@/themes";
import { ThemeColorControl } from "./ThemeColorControl";
import { ThemeContrastPreview } from "./ThemeContrastPreview";
import { getGameColor } from "./themeEditorColors";
import type { ThemeDraftController } from "./useThemeDraft";

const GAME_KEYS = getGameThemeColorPaths();
const GROUPED_GAME_KEYS = GAME_THEME_GROUPS.map((group) => ({
  ...group,
  keys: GAME_KEYS.filter(
    (key) =>
      group.exactKeys?.includes(key) || group.prefixes?.some((prefix) => key.startsWith(prefix)),
  ),
}));
const KNOWN_GAME_KEYS = new Set(GROUPED_GAME_KEYS.flatMap((group) => group.keys));
const REMAINING_GAME_GROUPS = new Map<string, GameThemeColorKey[]>();
for (const key of GAME_KEYS) {
  if (KNOWN_GAME_KEYS.has(key)) continue;
  const heading = key.includes(".") ? key.split(".")[0]! : "Other game colors";
  const keys = REMAINING_GAME_GROUPS.get(heading) ?? [];
  keys.push(key);
  REMAINING_GAME_GROUPS.set(heading, keys);
}
const ALL_GAME_GROUPS = [
  ...GROUPED_GAME_KEYS,
  ...Array.from(REMAINING_GAME_GROUPS, ([heading, keys]) => ({ heading, description: "", keys })),
];

export function ThemeTokenRail({
  editor,
  onValidityChange,
}: {
  editor: ThemeDraftController;
  onValidityChange: (token: string, invalid: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const { draft, resolved } = editor;
  const query = search.trim().toLowerCase();
  const appGroups = APP_THEME_GROUPS.map((group) => ({
    ...group,
    keys: group.keys.filter((key) =>
      [key, APP_THEME_COLOR_LABELS[key], APP_THEME_COLOR_DESCRIPTIONS[key], group.heading].some(
        (value) => value.toLowerCase().includes(query),
      ),
    ),
  })).filter((group) => group.keys.length > 0);
  const gameGroups = ALL_GAME_GROUPS.map((group) => ({
    ...group,
    keys: group.keys.filter((key) =>
      [key, GAME_THEME_COLOR_DESCRIPTIONS[key], group.heading].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    ),
  })).filter((group) => group.keys.length > 0);
  const showApp = scope !== "game" || query.length > 0;
  const showGame = scope !== "app" || query.length > 0;
  const count =
    (showApp ? appGroups.reduce((sum, group) => sum + group.keys.length, 0) : 0) +
    (showGame ? gameGroups.reduce((sum, group) => sum + group.keys.length, 0) : 0);
  return (
    <aside
      className="order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background md:order-1 md:w-[300px] md:flex-none"
      aria-label="Theme controls"
    >
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <Input
          aria-label="Search all theme tokens"
          placeholder="Search every app and game token"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 text-xs md:text-xs"
        />
        <div className="flex items-center gap-1">
          {(["all", "app", "game"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={scope === value ? "secondary" : "ghost"}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {value === "all" ? "All" : value === "app" ? "App" : "Game"}
            </Button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">{count} tokens</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        <ThemeContrastPreview theme={editor.displayed} document={editor.displayedDocument} />
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            App colors are separate for light and dark. Game colors are shared. Reset removes an
            override; alpha 0 makes a color transparent.
          </p>
          {editor.compareCurrent && (
            <p className="text-[11px] text-muted-foreground">
              The board shows your saved theme. Editing any token switches back to Draft.
            </p>
          )}
          <Button size="sm" variant="outline" onClick={editor.resetOverrides}>
            Reset all overrides
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Resets both app modes and every game color to the selected preset. Undo restores them.
          </p>
        </div>
        {count === 0 && (
          <p className="text-xs text-muted-foreground">No tokens match this search.</p>
        )}
        {showApp &&
          appGroups.map((group) => (
            <section key={group.heading} className="space-y-1">
              <h3 className="text-xs font-semibold">App · {group.heading}</h3>
              <p className="text-[11px] text-muted-foreground">{group.description}</p>
              {group.keys.map((key) => (
                <ThemeColorControl
                  key={`${key}:${draft.mode}:${draft.presetId}:${editor.revision}`}
                  token={`app.${key}`}
                  label={APP_THEME_COLOR_LABELS[key]}
                  description={APP_THEME_COLOR_DESCRIPTIONS[key]}
                  value={resolved.appTheme[key]}
                  overridden={Object.hasOwn(draft.appOverrides[draft.mode], key)}
                  onChange={(value) => editor.setAppColor(key, value)}
                  onReset={() => editor.setAppColor(key)}
                  onValidityChange={onValidityChange}
                />
              ))}
            </section>
          ))}
        {showGame &&
          gameGroups.map((group) => (
            <section key={group.heading} className="space-y-1">
              <h3 className="text-xs font-semibold">Game · {group.heading}</h3>
              {group.description && (
                <p className="text-[11px] text-muted-foreground">{group.description}</p>
              )}
              {group.keys.map((key) => (
                <ThemeColorControl
                  key={`${key}:${draft.mode}:${draft.presetId}:${editor.revision}`}
                  token={`game.${key}`}
                  label={key.split(".").at(-1)!}
                  description={GAME_THEME_COLOR_DESCRIPTIONS[key]}
                  value={getGameColor(resolved.gameTheme, key)}
                  overridden={Object.hasOwn(draft.gameOverrides, key)}
                  onChange={(value) => editor.setGameColor(key, value)}
                  onReset={() => editor.setGameColor(key)}
                  onValidityChange={onValidityChange}
                />
              ))}
            </section>
          ))}
      </div>
    </aside>
  );
}
