import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardPaste, FileUp, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { verifyCardPrintings } from "@/api/hub";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { collectionCardKey } from "@/lib/collection";
import {
  collectionQuantitiesFromPreview,
  parseCollectionFile,
  previewCollectionImport,
  type CollectionImportMapping,
} from "@/lib/collectionImport";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface CollectionImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (quantities: Record<string, number>, mode: "merge" | "replace") => Promise<void>;
}
const SOURCE_LABELS = {
  get manabox() {
    return i18n._(msg`ManaBox`);
  },
  get moxfield() {
    return i18n._(msg`Moxfield`);
  },
  get archidekt() {
    return i18n._(msg`Archidekt`);
  },
  get generic() {
    return i18n._(msg`Custom CSV`);
  },
};
function printingValidationKey(
  name: string,
  setCode: string,
  collectorNumber: string,
  foil?: boolean,
): string {
  return collectionCardKey(name, setCode, collectorNumber, foil);
}
export function CollectionImportDialog({
  open,
  onOpenChange,
  onImport,
}: CollectionImportDialogProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<CollectionImportMapping>({
    nameColumn: null,
    quantityColumn: null,
    setColumn: null,
    collectorNumberColumn: null,
    foilColumn: null,
  });
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [previewFilter, setPreviewFilter] = useState<"all" | "ready" | "skipped">("all");
  const [saving, setSaving] = useState(false);
  const [printingValidation, setPrintingValidation] = useState<Record<string, boolean | "error">>(
    {},
  );
  const [validatingPrintings, setValidatingPrintings] = useState(false);
  const [printingValidationError, setPrintingValidationError] = useState(false);
  const [printingValidationAttempt, setPrintingValidationAttempt] = useState(0);
  const [printingValidationProgress, setPrintingValidationProgress] = useState({
    completed: 0,
    total: 0,
  });
  const parsed = useMemo(() => (text.trim() ? parseCollectionFile(text) : null), [text]);
  const preview = useMemo(
    () => (parsed ? previewCollectionImport(parsed, mapping) : []),
    [mapping, parsed],
  );
  const exactRows = useMemo(
    () => preview.filter((row) => row.valid && row.setCode && row.collectorNumber),
    [preview],
  );
  const uniqueExactRows = useMemo(
    () =>
      Array.from(
        new Map(
          exactRows.map((row) => [
            printingValidationKey(row.name, row.setCode!, row.collectorNumber!, row.foil),
            row,
          ]),
        ).entries(),
      ),
    [exactRows],
  );
  useEffect(() => {
    let active = true;
    if (uniqueExactRows.length === 0) {
      setPrintingValidation({});
      setValidatingPrintings(false);
      setPrintingValidationError(false);
      setPrintingValidationProgress({ completed: 0, total: 0 });
      return;
    }
    setPrintingValidation({});
    setValidatingPrintings(true);
    setPrintingValidationError(false);
    setPrintingValidationProgress({ completed: 0, total: uniqueExactRows.length });
    const validate = async () => {
      const verifiedKeys = new Set<string>();
      try {
        await verifyCardPrintings(
          {
            identifiers: uniqueExactRows.map(([, row]) => ({
              name: row.name,
              setCode: row.setCode!,
              collectorNumber: row.collectorNumber!,
              foil: row.foil,
            })),
          },
          (matched, offset, total) => {
            if (!active) return;
            const batch = Object.fromEntries(
              matched.map((isMatch, index) => {
                const key = uniqueExactRows[offset + index][0];
                verifiedKeys.add(key);
                return [key, isMatch];
              }),
            );
            setPrintingValidation((current) => ({ ...current, ...batch }));
            setPrintingValidationProgress({ completed: offset + matched.length, total });
          },
        );
        if (!active) return;
        setPrintingValidationError(false);
      } catch {
        if (!active) return;
        setPrintingValidation((current) => ({
          ...current,
          ...Object.fromEntries(
            uniqueExactRows
              .filter(([key]) => !verifiedKeys.has(key))
              .map(([key]) => [key, "error"]),
          ),
        }));
        setPrintingValidationError(true);
      }
      setValidatingPrintings(false);
    };
    void validate();
    return () => {
      active = false;
    };
  }, [printingValidationAttempt, uniqueExactRows]);
  const validatedPreview = useMemo(
    () =>
      preview.map((row) => {
        if (!row.valid || !row.setCode || !row.collectorNumber) return row;
        const validation =
          printingValidation[
            printingValidationKey(row.name, row.setCode, row.collectorNumber, row.foil)
          ];
        if (validation === true) return row;
        return {
          ...row,
          valid: false,
          reason:
            validation === false
              ? "Printing not found"
              : validation === "error"
                ? "Verification failed"
                : "Checking printing…",
        };
      }),
    [preview, printingValidation],
  );
  const validRows = validatedPreview.filter((row) => row.valid);
  const invalidRows = validatedPreview.length - validRows.length;
  const filteredPreview = validatedPreview.filter((row) => {
    if (previewFilter === "ready") return row.valid;
    if (previewFilter === "skipped") return !row.valid;
    return true;
  });
  const imported = useMemo(
    () => collectionQuantitiesFromPreview(validatedPreview),
    [validatedPreview],
  );
  function loadText(nextText: string, nextFileName = "Pasted data") {
    const nextParsed = parseCollectionFile(nextText);
    setText(nextText);
    setFileName(nextFileName);
    setMapping(nextParsed.mapping);
    setPreviewFilter("all");
  }
  async function pasteFromClipboard() {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (clipboard.trim()) loadText(clipboard);
    } catch {
      toast.error(i18n._(msg`Couldn't read the clipboard \u2014 paste into a file instead`));
    }
  }
  async function applyImport() {
    if (Object.keys(imported).length === 0 || saving) return;
    setSaving(true);
    try {
      await onImport(imported, mode);
      toast.success(i18n._(msg`Imported ${Object.keys(imported).length} collection entries`));
      resetAndClose();
    } catch {
      toast.error(i18n._(msg`Collection import failed`));
    } finally {
      setSaving(false);
    }
  }
  function resetAndClose() {
    setText("");
    setFileName("");
    setMapping({
      nameColumn: null,
      quantityColumn: null,
      setColumn: null,
      collectorNumberColumn: null,
      foilColumn: null,
    });
    setMode("merge");
    setPreviewFilter("all");
    onOpenChange(false);
  }
  function closeDialog() {
    if (!saving) resetAndClose();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else closeDialog();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans>Import collection</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Import ManaBox, Moxfield, Archidekt, or any CSV/TSV file. Review and customize the
              columns before saving. Set and collector number preserve each exact printing.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void file.text().then((contents) => loadText(contents, file.name));
            event.target.value = "";
          }}
        />

        {!parsed ? (
          <div className="grid gap-3 py-6 sm:grid-cols-2">
            <button
              type="button"
              className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center hover:border-primary/60 hover:bg-primary/5"
              onClick={() => fileInput.current?.click()}
            >
              <FileUp className="h-8 w-8 text-primary" />
              <span className="font-medium">
                <Trans>Choose an export file</Trans>
              </span>
              <span className="text-xs text-muted-foreground">
                <Trans>CSV, TSV, or text</Trans>
              </span>
            </button>
            <button
              type="button"
              className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center hover:border-primary/60 hover:bg-primary/5"
              onClick={() => void pasteFromClipboard()}
            >
              <ClipboardPaste className="h-8 w-8 text-primary" />
              <span className="font-medium">
                <Trans>Paste from clipboard</Trans>
              </span>
              <span className="text-xs text-muted-foreground">
                <Trans>Copy rows from a spreadsheet</Trans>
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    {SOURCE_LABELS[parsed.source]} · {parsed.rows.length} rows detected
                  </Trans>
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                <Trans>Choose another file</Trans>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ColumnPicker
                label={i18n._(msg`Card name`)}
                required
                headers={parsed.headers}
                value={mapping.nameColumn}
                onChange={(nameColumn) => setMapping((current) => ({ ...current, nameColumn }))}
              />
              <ColumnPicker
                label={i18n._(msg`Set code`)}
                headers={parsed.headers}
                value={mapping.setColumn}
                onChange={(setColumn) => setMapping((current) => ({ ...current, setColumn }))}
              />
              <ColumnPicker
                label={i18n._(msg`Collector number`)}
                headers={parsed.headers}
                value={mapping.collectorNumberColumn}
                onChange={(collectorNumberColumn) =>
                  setMapping((current) => ({ ...current, collectorNumberColumn }))
                }
              />
              <ColumnPicker
                label={i18n._(msg`Foil`)}
                headers={parsed.headers}
                value={mapping.foilColumn}
                onChange={(foilColumn) => setMapping((current) => ({ ...current, foilColumn }))}
              />
              <ColumnPicker
                label={i18n._(msg`Quantity`)}
                headers={parsed.headers}
                value={mapping.quantityColumn}
                noneLabel="Use 1 for every row"
                onChange={(quantityColumn) =>
                  setMapping((current) => ({ ...current, quantityColumn }))
                }
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  <Trans>Import preview</Trans>
                </h3>
                <div className="flex items-center gap-3 text-xs">
                  {printingValidationError && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setPrintingValidationAttempt((attempt) => attempt + 1)}
                    >
                      <Trans>Retry verification</Trans>
                    </Button>
                  )}
                  <span className="flex items-center gap-1 text-legality-legal">
                    <Trans>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} ready
                    </Trans>
                  </span>
                  {invalidRows > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <Trans>
                        <TriangleAlert className="h-3.5 w-3.5" /> {invalidRows} skipped
                      </Trans>
                    </span>
                  )}
                </div>
              </div>
              {exactRows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Exact printings are verified with Scryfall before import. Large collections may
                    take a while to finish checking.
                    {validatingPrintings && printingValidationProgress.total > 0
                      ? ` ${printingValidationProgress.completed.toLocaleString()}/${printingValidationProgress.total.toLocaleString()} checked.`
                      : ""}
                  </Trans>
                </p>
              )}
              <div className="flex flex-wrap gap-1" aria-label={i18n._(msg`Filter import preview`)}>
                <Button
                  size="sm"
                  variant={previewFilter === "all" ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setPreviewFilter("all")}
                >
                  <Trans>All {validatedPreview.length}</Trans>
                </Button>
                <Button
                  size="sm"
                  variant={previewFilter === "ready" ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs text-legality-legal"
                  onClick={() => setPreviewFilter("ready")}
                >
                  <Trans>Ready {validRows.length}</Trans>
                </Button>
                <Button
                  size="sm"
                  variant={previewFilter === "skipped" ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs text-destructive"
                  onClick={() => setPreviewFilter("skipped")}
                >
                  <Trans>Skipped {invalidRows}</Trans>
                </Button>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">
                        <Trans>Row</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Card name</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Printing</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Finish</Trans>
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        <Trans>Quantity</Trans>
                      </th>
                      <th className="px-3 py-2 font-medium">
                        <Trans>Status</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreview.slice(0, 100).map((row) => (
                      <tr key={row.rowNumber} className="border-b last:border-0">
                        <td className="px-3 py-2 text-muted-foreground">{row.rowNumber}</td>
                        <td className="max-w-80 truncate px-3 py-2">{row.name || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {row.setCode && row.collectorNumber
                            ? `${row.setCode.toUpperCase()} #${row.collectorNumber}`
                            : "Any printing"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {row.foil === true ? "Foil" : row.foil === false ? "Non-foil" : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.valid ? row.quantity : "—"}
                        </td>
                        <td
                          className={
                            row.valid
                              ? "px-3 py-2 text-legality-legal"
                              : "px-3 py-2 text-destructive"
                          }
                        >
                          {row.valid ? "Ready" : row.reason}
                        </td>
                      </tr>
                    ))}
                    {filteredPreview.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          <Trans>
                            No {previewFilter === "all" ? "" : `${previewFilter} `}rows to show.
                          </Trans>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredPreview.length > 100 && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Showing the first 100 of {filteredPreview.length} {previewFilter} rows. All
                    valid rows will be imported.
                  </Trans>
                </p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">
                <Trans>Import behavior</Trans>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ImportMode
                  checked={mode === "merge"}
                  title={i18n._(msg`Add to collection`)}
                  description={i18n._(msg`Add imported quantities to cards you already own.`)}
                  onChange={() => setMode("merge")}
                />
                <ImportMode
                  checked={mode === "replace"}
                  title={i18n._(msg`Replace collection`)}
                  description={i18n._(msg`Remove current entries and use only this import.`)}
                  onChange={() => setMode("replace")}
                />
              </div>
            </fieldset>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog} disabled={saving}>
            <Trans>Cancel</Trans>
          </Button>
          {parsed && (
            <Button
              onClick={() => void applyImport()}
              disabled={
                saving ||
                validatingPrintings ||
                mapping.nameColumn === null ||
                validRows.length === 0
              }
            >
              {(saving || validatingPrintings) && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving
                ? i18n._(msg`Importing\u2026`)
                : validatingPrintings
                  ? i18n._(msg`Checking printings\u2026`)
                  : i18n._(msg`Import ${Object.keys(imported).length} entries`)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ColumnPicker({
  label,
  required = false,
  headers,
  value,
  noneLabel = "Do not import",
  onChange,
}: {
  label: string;
  required?: boolean;
  headers: string[];
  value: number | null;
  noneLabel?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium">
      {label} {required && <span className="text-destructive">*</span>}
      <select
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
      >
        <option value="">{noneLabel}</option>
        {headers.map((header, index) => (
          <option key={`${header}-${index}`} value={index}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
function ImportMode({
  checked,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  title: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type="radio" name="collection-import-mode" checked={checked} onChange={onChange} />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
