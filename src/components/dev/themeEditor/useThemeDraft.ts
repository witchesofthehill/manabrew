import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme as useColorMode } from "next-themes";
import {
  getThemeDocument,
  resolveThemeDocument,
  saveThemeDocument,
  setThemePreview,
} from "@/hooks/useTheme";
import { parseThemeDocument, type ThemeDocument } from "@/themes/themeDocument";
import type { GameThemeColorKey, ThemeColors } from "@/themes";
import type { Theme } from "@/hooks/useTheme";

interface DraftHistory {
  past: ThemeDocument[];
  present: ThemeDocument;
  future: ThemeDocument[];
}

export interface ThemeDraftController {
  draft: ThemeDocument;
  resolved: Theme;
  displayed: Theme;
  displayedDocument: ThemeDocument;
  dirty: boolean;
  compareCurrent: boolean;
  setCompareCurrent: (current: boolean) => void;
  error: string | null;
  status: string;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  update: (change: (current: ThemeDocument) => ThemeDocument) => void;
  undo: () => void;
  redo: () => void;
  setAppColor: (key: keyof ThemeColors, value?: string) => void;
  setGameColor: (key: GameThemeColorKey, value?: string) => void;
  save: () => void;
  discard: () => void;
  resetOverrides: () => void;
  importFile: (file: File) => Promise<void>;
  exportFile: () => void;
}

export function useThemeDraft(): ThemeDraftController {
  const { resolvedTheme, setTheme } = useColorMode();
  const [baseline, setBaseline] = useState(() =>
    getThemeDocument(resolvedTheme === "light" ? "light" : "dark"),
  );
  const [history, setHistory] = useState<DraftHistory>(() => ({
    past: [],
    present: baseline,
    future: [],
  }));
  const [compareCurrent, setCompareCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const draft = history.present;
  const resolved = useMemo(() => resolveThemeDocument(draft), [draft]);
  const displayed = useMemo(
    () => (compareCurrent ? resolveThemeDocument(baseline) : resolved),
    [compareCurrent, baseline, resolved],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  useEffect(() => {
    setThemePreview(compareCurrent ? baseline : draft);
  }, [draft, baseline, compareCurrent]);
  useEffect(() => () => setThemePreview(null), []);

  const update = useCallback((change: (current: ThemeDocument) => ThemeDocument) => {
    setHistory((current) => {
      const next = change(current.present);
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current;
      return { past: [...current.past.slice(-99), current.present], present: next, future: [] };
    });
    setCompareCurrent(false);
    setError(null);
    setStatus("");
  }, []);

  function undo() {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
    setCompareCurrent(false);
    setRevision((value) => value + 1);
    setStatus("");
  }

  function redo() {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
    setCompareCurrent(false);
    setRevision((value) => value + 1);
    setStatus("");
  }

  function setAppColor(key: keyof ThemeColors, value?: string) {
    update((current) => {
      const overrides = { ...current.appOverrides[current.mode] };
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      return { ...current, appOverrides: { ...current.appOverrides, [current.mode]: overrides } };
    });
  }

  function setGameColor(key: GameThemeColorKey, value?: string) {
    update((current) => {
      const gameOverrides = { ...current.gameOverrides };
      if (value === undefined) delete gameOverrides[key];
      else gameOverrides[key] = value;
      return { ...current, gameOverrides };
    });
  }

  function save() {
    try {
      const document = parseThemeDocument(draft);
      saveThemeDocument(document);
      setTheme(document.mode);
      setBaseline(document);
      setHistory({ past: [], present: document, future: [] });
      setCompareCurrent(false);
      setError(null);
      setStatus("Personal theme saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this theme.");
    }
  }

  function discard() {
    setHistory({ past: [], present: baseline, future: [] });
    setCompareCurrent(false);
    setRevision((value) => value + 1);
    setError(null);
    setStatus("Draft discarded. Showing your saved theme.");
  }

  function resetOverrides() {
    update((current) => ({ ...current, appOverrides: { light: {}, dark: {} }, gameOverrides: {} }));
    setRevision((value) => value + 1);
  }

  async function importFile(file: File) {
    try {
      const document = parseThemeDocument(JSON.parse(await file.text()));
      update(() => document);
      setRevision((value) => value + 1);
      setStatus("Theme imported into the draft. Save to keep it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this theme file.");
    }
  }

  function exportFile() {
    try {
      const document = parseThemeDocument(draft);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(document, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${document.name.replace(/[^a-z0-9_-]+/gi, "-") || "personal-theme"}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setError(null);
      setStatus("Draft exported as version 1 JSON.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export this theme.");
    }
  }

  return {
    draft,
    resolved,
    displayed,
    dirty,
    compareCurrent,
    setCompareCurrent,
    error,
    status,
    revision,
    displayedDocument: compareCurrent ? baseline : draft,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    update,
    undo,
    redo,
    setAppColor,
    setGameColor,
    save,
    discard,
    resetOverrides,
    importFile,
    exportFile,
  };
}
