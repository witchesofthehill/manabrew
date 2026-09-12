import { useRef } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { THEME_PRESETS } from "@/themes";
import type { ThemeDraftController } from "./useThemeDraft";

export function ThemeEditorToolbar({
  editor,
  hasInvalidColors,
}: {
  editor: ThemeDraftController;
  hasInvalidColors: boolean;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  const { draft, update } = editor;
  return (
    <header className="shrink-0 space-y-2 border-b border-border pb-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Input
          aria-label="Personal theme name"
          title="Personal theme name"
          className="h-8 w-40 shrink-0 text-xs"
          value={draft.name}
          maxLength={80}
          onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
        />
        <select
          aria-label="Base preset"
          className="h-8 w-36 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
          value={draft.presetId}
          onChange={(event) => update((current) => ({ ...current, presetId: event.target.value }))}
          title="Change the inherited palette. Your overrides stay in the draft."
        >
          {THEME_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <div className="flex shrink-0 gap-1" aria-label="Draft color mode">
          {(["light", "dark"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={draft.mode === mode ? "secondary" : "ghost"}
              aria-pressed={draft.mode === mode}
              onClick={() => update((current) => ({ ...current, mode }))}
            >
              {mode === "light" ? "Light" : "Dark"}
            </Button>
          ))}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {editor.compareCurrent
            ? "Showing saved theme"
            : editor.dirty
              ? "Unsaved draft"
              : "Saved theme"}
        </span>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        <div className="flex shrink-0 gap-1 border-r border-border pr-2 mr-1">
          <Button
            size="sm"
            variant={editor.compareCurrent ? "secondary" : "ghost"}
            aria-pressed={editor.compareCurrent}
            onClick={() => editor.setCompareCurrent(true)}
          >
            Current
          </Button>
          <Button
            size="sm"
            variant={!editor.compareCurrent ? "secondary" : "ghost"}
            aria-pressed={!editor.compareCurrent}
            onClick={() => editor.setCompareCurrent(false)}
          >
            Draft
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          title="Undo draft change"
          aria-label="Undo draft change"
          disabled={!editor.canUndo}
          onClick={editor.undo}
        >
          <Undo2 />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Redo draft change"
          aria-label="Redo draft change"
          disabled={!editor.canRedo}
          onClick={editor.redo}
        >
          <Redo2 />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={editor.discard}
          disabled={!editor.dirty && !hasInvalidColors}
        >
          Discard
        </Button>
        <Button size="sm" onClick={editor.save} disabled={hasInvalidColors || !draft.name.trim()}>
          Save personal theme
        </Button>
        <div className="ml-auto flex shrink-0 gap-1 pl-2">
          <Button size="sm" variant="ghost" onClick={() => importInput.current?.click()}>
            Import JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={editor.exportFile}
            disabled={hasInvalidColors || !draft.name.trim()}
          >
            Export JSON
          </Button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void editor.importFile(file);
            }}
          />
        </div>
      </div>
    </header>
  );
}
