import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardPaste, Download } from "lucide-react";
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
import { DEFAULT_IMPORT_NAME } from "@/lib/constants";
import { GAME_FORMATS } from "@/lib/formats";
import { cn } from "@/lib/utils";
import {
  isDetectedCommander,
  parseDeckListText,
  suggestedDeckName,
  type ParsedDeckEntry,
} from "@/lib/deckImport";
import type { DeckFormat } from "@/protocol/deck";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface ImportDeckTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "create" | "add";
  onImport: (
    entries: ParsedDeckEntry[],
    name: string,
    formatId: DeckFormat | undefined,
    onProgress: (fraction: number) => void,
  ) => Promise<boolean | void>;
}
const GUIDE_STEPS = [
  msg`Open your deck on Moxfield.`,
  msg`Click the ••• menu, then Export.`,
  msg`Choose "Copy Plain Text" and copy it to your clipboard.`,
];
const IMPORT_FORMATS = GAME_FORMATS.filter((format) => format.id !== "oathbreaker");
export function ImportDeckTextDialog({
  open,
  onOpenChange,
  onImport,
  mode = "create",
}: ImportDeckTextDialogProps) {
  const [text, setText] = useState("");
  const [customName, setCustomName] = useState<string | null>(null);
  const [formatId, setFormatId] = useState<DeckFormat | "">("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (open) return;
    setText("");
    setCustomName(null);
    setFormatId("");
    setImporting(false);
    setProgress(0);
    setReviewing(false);
  }, [open]);
  const entries = useMemo(() => parseDeckListText(text), [text]);
  const name = customName ?? suggestedDeckName(entries);
  const mainCount = entries.reduce(
    (s, e) => (e.side || e.maybe || isDetectedCommander(e) ? s : s + e.count),
    0,
  );
  const sideCount = entries.reduce(
    (s, e) => (e.side && !isDetectedCommander(e) ? s + e.count : s),
    0,
  );
  const maybeCount = entries.reduce(
    (s, e) => (e.maybe && !isDetectedCommander(e) ? s + e.count : s),
    0,
  );
  const commanderCount = entries.reduce((s, e) => (isDetectedCommander(e) ? s + e.count : s), 0);
  const valid = entries.length > 0;
  const dirty = text.trim().length > 0;
  const unrecognizedLines = useMemo(() => {
    const parsedNames = new Set(entries.map((entry) => entry.name.toLowerCase()));
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+x?\s+/i.test(line))
      .filter((line) => ![...parsedNames].some((name) => line.toLowerCase().includes(name)));
  }, [entries, text]);
  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) setText(clip);
    } catch {
      toast.error(i18n._(msg`Couldn't read the clipboard \u2014 paste manually instead`));
    }
  }, []);
  const handleImportClick = useCallback(async () => {
    if (!valid || importing) return;
    setImporting(true);
    setProgress(0);
    try {
      const applied = await onImport(entries, name, formatId || undefined, setProgress);
      if (applied !== false) onOpenChange(false);
      else setImporting(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n._(msg`Import failed`));
      setImporting(false);
    }
  }, [valid, importing, entries, name, formatId, onImport, onOpenChange]);
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
          <DialogTitle>
            {mode === "add" ? i18n._(msg`Add cards from a list`) : i18n._(msg`Import a deck`)}
          </DialogTitle>
          <DialogDescription>
            {importing
              ? mode === "add"
                ? i18n._(msg`Adding cards to this deck\u2026`)
                : i18n._(msg`Building "${name.trim() || DEFAULT_IMPORT_NAME}"…`)
              : mode === "add"
                ? i18n._(msg`Paste a deck list to merge its cards into this deck.`)
                : i18n._(msg`Copy your deck as text from Moxfield, then paste it below.`)}
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
        ) : reviewing ? (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => setReviewing(false)}
                >
                  <Trans>
                    <ArrowLeft className="h-3.5 w-3.5" /> Edit list
                  </Trans>
                </Button>
                <span className="text-xs text-muted-foreground">
                  <Trans>
                    {mainCount + sideCount + maybeCount + commanderCount} cards · {entries.length}{" "}
                    entries
                  </Trans>
                </span>
              </div>
              <div className="max-h-[45dvh] overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Qty</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Card</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Destination</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Printing</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {entries.map((entry, index) => (
                      <tr
                        key={`${entry.name}-${entry.setCode ?? ""}-${entry.collectorNumber ?? ""}-${index}`}
                      >
                        <td className="px-3 py-2 font-mono">{entry.count}</td>
                        <td className="px-3 py-2 font-medium">{entry.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {isDetectedCommander(entry)
                            ? i18n._(msg`Command zone`)
                            : entry.side
                              ? i18n._(msg`Sideboard`)
                              : entry.maybe
                                ? i18n._(msg`Maybeboard`)
                                : i18n._(msg`Main deck`)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.setCode
                            ? `${entry.setCode.toUpperCase()}${entry.collectorNumber ? ` #${entry.collectorNumber}` : ""}${entry.foil ? i18n._(msg` · foil`) : ""}`
                            : entry.foil
                              ? i18n._(msg`Foil · default printing`)
                              : i18n._(msg`Default printing`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unrecognizedLines.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {unrecognizedLines.length === 1
                    ? i18n._(msg`One card line was not recognized and will be skipped.`)
                    : i18n._(
                        msg`${unrecognizedLines.length} card lines were not recognized and will be skipped.`,
                      )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Exact set, collector number, and foil finish are preserved when supplied.
                  Unavailable printings are reported after verification.
                </Trans>
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t pt-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                <Trans>Cancel</Trans>
              </Button>
              <Button size="sm" className="gap-1" onClick={() => void handleImportClick()}>
                <Download className="h-3.5 w-3.5" />
                {mode === "add" ? i18n._(msg`Confirm addition`) : i18n._(msg`Confirm import`)}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              {mode === "create" && (
                <ol className="space-y-1.5">
                  {GUIDE_STEPS.map((label, i) => (
                    <li key={label.id} className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {i18n._(label)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {mode === "create" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      <Trans>Deck name</Trans>
                    </label>
                    <Input
                      value={name}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder={DEFAULT_IMPORT_NAME}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      <Trans>Format</Trans>
                    </label>
                    <select
                      value={formatId}
                      onChange={(e) =>
                        setFormatId(
                          IMPORT_FORMATS.find((format) => format.id === e.target.value)?.id ?? "",
                        )
                      }
                      className="h-9 w-full cursor-pointer rounded-md border bg-background px-2 text-xs pointer-coarse:text-base"
                    >
                      <option value="">
                        <Trans>Auto-detect</Trans>
                      </option>
                      {IMPORT_FORMATS.map((format) => (
                        <option key={format.id} value={format.id}>
                          {format.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">
                    <Trans>Deck list</Trans>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={pasteFromClipboard}
                  >
                    <Trans>
                      <ClipboardPaste className="h-3 w-3" /> Paste
                    </Trans>
                  </Button>
                </div>
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setReviewing(false);
                  }}
                  placeholder={"4 Lightning Bolt\n2 Counterspell\n…"}
                  className={cn(
                    "flex min-h-[176px] w-full resize-none rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    valid ? "border-legality-legal/60" : "border-input",
                  )}
                />
              </div>

              {valid ? (
                <div
                  key={mainCount + sideCount + maybeCount + commanderCount}
                  className="flex items-center gap-2 rounded-md border border-legality-legal/40 bg-legality-legal/10 px-3 py-2 text-legality-legal"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">
                    <Trans>Looks good!</Trans>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <Trans>
                      {commanderCount > 0 ? `${commanderCount} commander · ` : ""}
                      {mainCount} main
                      {sideCount > 0 ? ` · ${sideCount} sideboard` : ""}
                      {maybeCount > 0 ? ` · ${maybeCount} maybeboard` : ""} · {entries.length}{" "}
                      unique
                    </Trans>
                  </span>
                </div>
              ) : dirty ? (
                <p className="text-xs text-destructive">
                  <Trans>No recognizable card entries yet</Trans>
                </p>
              ) : null}
              {mode === "add" && commanderCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Commander entries fill an empty command zone. If it already has a commander,
                    they are added to the main deck instead.
                  </Trans>
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                size="sm"
                onClick={() => setReviewing(true)}
                disabled={!valid}
                className={cn("gap-1 transition-all", valid && "ring-2 ring-primary/40")}
              >
                <Download className="h-3.5 w-3.5" />
                {mode === "add" ? i18n._(msg`Review addition`) : i18n._(msg`Review import`)}
                {valid
                  ? i18n._(msg` ${mainCount + sideCount + maybeCount + commanderCount} cards`)
                  : ""}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
