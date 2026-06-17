import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardPaste, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseDeckListText, type ParsedDeckEntry } from "@/lib/deckImport";

interface ImportDeckTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (
    entries: ParsedDeckEntry[],
    name: string,
    onProgress: (fraction: number) => void,
  ) => Promise<void>;
}

const DEFAULT_IMPORT_NAME = "Imported Deck";

const GUIDE_STEPS = [
  "Open your deck on Moxfield.",
  "Click the ••• menu, then Export.",
  'Choose "Copy Plain Text" and copy it to your clipboard.',
];

export function ImportDeckTextDialog({ open, onOpenChange, onImport }: ImportDeckTextDialogProps) {
  const [text, setText] = useState("");
  const [name, setName] = useState(DEFAULT_IMPORT_NAME);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) return;
    setText("");
    setName(DEFAULT_IMPORT_NAME);
    setImporting(false);
    setProgress(0);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const entries = useMemo(() => parseDeckListText(text), [text]);
  const mainCount = entries.reduce((s, e) => (e.side || e.maybe ? s : s + e.count), 0);
  const sideCount = entries.reduce((s, e) => (e.side ? s + e.count : s), 0);
  const maybeCount = entries.reduce((s, e) => (e.maybe ? s + e.count : s), 0);
  const valid = entries.length > 0;
  const dirty = text.trim().length > 0;

  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) setText(clip);
    } catch {
      toast.error("Couldn't read the clipboard — paste manually instead");
    }
  }, []);

  const handleImportClick = useCallback(async () => {
    if (!valid || importing) return;
    setImporting(true);
    setProgress(0);
    try {
      await onImport(entries, name, setProgress);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
      setImporting(false);
    }
  }, [valid, importing, entries, name, onImport, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && importing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a deck</DialogTitle>
          <DialogDescription>
            {importing
              ? `Building "${name.trim() || DEFAULT_IMPORT_NAME}"…`
              : "Copy your deck as text from Moxfield, then paste it below."}
          </DialogDescription>
        </DialogHeader>

        {importing ? (
          <div className="space-y-3 py-10">
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="text-center text-sm font-medium tabular-nums">
              {Math.round(progress * 100)}%
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <ol className="space-y-1.5">
                {GUIDE_STEPS.map((label, i) => (
                  <li key={label} className="flex items-start gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-xs leading-5 text-muted-foreground">{label}</span>
                  </li>
                ))}
              </ol>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Deck name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={DEFAULT_IMPORT_NAME}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">Deck list</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={pasteFromClipboard}
                  >
                    <ClipboardPaste className="h-3 w-3" /> Paste
                  </Button>
                </div>
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"4 Lightning Bolt\n2 Counterspell\n…"}
                  className={cn(
                    "flex min-h-[176px] w-full resize-none rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    valid ? "border-legality-legal/60" : "border-input",
                  )}
                />
              </div>

              {valid ? (
                <div
                  key={mainCount + sideCount + maybeCount}
                  className="flex items-center gap-2 rounded-md border border-legality-legal/40 bg-legality-legal/10 px-3 py-2 text-legality-legal duration-300 animate-in fade-in zoom-in-95"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">Looks good!</span>
                  <span className="text-xs text-muted-foreground">
                    {mainCount} main
                    {sideCount > 0 ? ` · ${sideCount} sideboard` : ""}
                    {maybeCount > 0 ? ` · ${maybeCount} maybeboard` : ""} · {entries.length} unique
                  </span>
                </div>
              ) : dirty ? (
                <p className="text-xs text-destructive">Wrong format</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleImportClick}
                disabled={!valid}
                className={cn("gap-1 transition-all", valid && "ring-2 ring-primary/40")}
              >
                <Download className="h-3.5 w-3.5" />
                Import{valid ? ` ${mainCount + sideCount + maybeCount} cards` : ""}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
