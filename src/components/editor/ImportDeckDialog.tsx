import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platformFetch } from "@/lib/platformFetch";
import { Loader2, ArrowLeft, Download, Search as SearchIcon } from "lucide-react";
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
import {
  fetchArchidektDeck,
  searchArchidekt,
  type ArchidektDeck,
  type ArchidektSearchResult,
} from "@/lib/archidekt";
import { fetchDeckBySource, fetchResultBySource, parseDeckUrl } from "@/lib/deckImport";
import { GAME_FORMATS } from "@/lib/formats";

export type ImportDeckDialogMode = "url" | "search";

interface ImportDeckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ImportDeckDialogMode;
  onImport: (deck: ArchidektDeck) => void | Promise<void>;
}

type Step = "input" | "loading" | "results" | "preview" | "importing";

const requestOpts = { fetch: platformFetch as unknown as typeof fetch };

export function ImportDeckDialog({ open, onOpenChange, mode, onImport }: ImportDeckDialogProps) {
  const [step, setStep] = useState<Step>("input");
  const [urlInput, setUrlInput] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("");
  const [results, setResults] = useState<ArchidektSearchResult[]>([]);
  const [selected, setSelected] = useState<ArchidektSearchResult | null>(null);
  const [deck, setDeck] = useState<ArchidektDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetState = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep("input");
    setUrlInput("");
    setQueryInput("");
    setFormatFilter("");
    setResults([]);
    setSelected(null);
    setDeck(null);
    setError(null);
  }, []);

  useEffect(() => {
    // Reset all internal state whenever the dialog closes so the next open starts clean.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) resetState();
  }, [open, resetState]);

  const title = mode === "url" ? "Import from URL" : "Search Archidekt";
  const description =
    mode === "url"
      ? "Paste an Archidekt or Moxfield deck URL to preview and import it."
      : "Search Archidekt for a deck, then preview and import it.";

  const runSearch = useCallback(async (query: string, formatId: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStep("loading");
    setError(null);
    try {
      const found = await searchArchidekt(trimmed, {
        ...requestOpts,
        signal: controller.signal,
        formatId: formatId || undefined,
      });
      if (controller.signal.aborted) return;
      if (found.length === 0) {
        setError("No decks found.");
        setStep("input");
        return;
      }
      setResults(found);
      setStep("results");
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStep("input");
    }
  }, []);

  // Search flow: we already know the source is archidekt; fetch the deck body
  // only (result metadata already came back from the search call).
  const loadArchidektSearchPick = useCallback(
    async (id: string, knownResult: ArchidektSearchResult) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStep("loading");
      setError(null);
      try {
        const fetched = await fetchArchidektDeck(id, { ...requestOpts, signal: controller.signal });
        if (controller.signal.aborted) return;
        setSelected(knownResult);
        setDeck(fetched);
        setStep("preview");
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStep(results.length > 0 ? "results" : "input");
      }
    },
    [results.length],
  );

  const handleUrlSubmit = useCallback(async () => {
    const parsed = parseDeckUrl(urlInput);
    if (!parsed) {
      setError("Not a valid Archidekt or Moxfield URL.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStep("loading");
    setError(null);
    try {
      const [result, fetched] = await Promise.all([
        fetchResultBySource(parsed.source, parsed.id, {
          ...requestOpts,
          signal: controller.signal,
        }),
        fetchDeckBySource(parsed.source, parsed.id, { ...requestOpts, signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setSelected(result);
      setDeck(fetched);
      setStep("preview");
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStep("input");
    }
  }, [urlInput]);

  const handleImportClick = useCallback(async () => {
    if (!deck || !selected) return;
    setStep("importing");
    setError(null);
    try {
      await onImport(deck);
      toast.success(`Imported "${selected.name}"`);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStep("preview");
    }
  }, [deck, selected, onImport, onOpenChange]);

  const handleBack = useCallback(() => {
    setError(null);
    if (mode === "search" && results.length > 0) {
      setSelected(null);
      setDeck(null);
      setStep("results");
    } else {
      setStep("input");
    }
  }, [mode, results.length]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block accidental close (Esc / overlay click) while the import is running.
        if (!next && step === "importing") return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {error && step !== "loading" && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {step === "loading" && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-10 text-sm gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div className="text-center">
                <div className="font-medium">Importing {selected?.name ?? "deck"}…</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Resolving card data from Scryfall
                </div>
              </div>
            </div>
          )}

          {step === "input" && mode === "url" && (
            <UrlInput value={urlInput} onChange={setUrlInput} onSubmit={handleUrlSubmit} />
          )}

          {step === "input" && mode === "search" && (
            <SearchInput
              value={queryInput}
              onChange={setQueryInput}
              formatValue={formatFilter}
              onFormatChange={setFormatFilter}
              onSubmit={() => runSearch(queryInput, formatFilter)}
            />
          )}

          {step === "results" && (
            <ResultList
              results={results}
              onSelect={(r) => loadArchidektSearchPick(r.id, r)}
              onRefine={() => setStep("input")}
            />
          )}

          {step === "preview" && deck && selected && <DeckPreview result={selected} deck={deck} />}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t">
          <div>
            {(step === "preview" || (step === "results" && mode === "search")) && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={step === "importing"}
            >
              Cancel
            </Button>
            {step === "input" && mode === "url" && (
              <Button size="sm" onClick={handleUrlSubmit} disabled={!urlInput.trim()}>
                Fetch deck
              </Button>
            )}
            {step === "input" && mode === "search" && (
              <Button
                size="sm"
                onClick={() => runSearch(queryInput, formatFilter)}
                disabled={!queryInput.trim()}
              >
                <SearchIcon className="h-3.5 w-3.5 mr-1" /> Search
              </Button>
            )}
            {(step === "preview" || step === "importing") && deck && (
              <Button size="sm" onClick={handleImportClick} disabled={step === "importing"}>
                <Download className="h-3.5 w-3.5 mr-1" /> Import deck
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UrlInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium">Archidekt URL</label>
      <Input
        autoFocus
        placeholder="https://archidekt.com/decks/… or https://moxfield.com/decks/…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        Supports Archidekt and Moxfield deck URLs.
      </p>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  formatValue,
  onFormatChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  formatValue: string;
  onFormatChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium">Deck name</label>
      <div className="flex gap-2">
        <Input
          autoFocus
          className="flex-1"
          placeholder="e.g. jund wildfire"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <select
          value={formatValue}
          onChange={(e) => onFormatChange(e.target.value)}
          title="Filter by format"
          className="h-9 text-xs pointer-coarse:text-base rounded-md border bg-background px-2 cursor-pointer shrink-0"
        >
          <option value="">All formats</option>
          {GAME_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.shortName ?? f.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Searches Archidekt by deck name, sorted by views.
      </p>
    </div>
  );
}

function ResultList({
  results,
  onSelect,
  onRefine,
}: {
  results: ArchidektSearchResult[];
  onSelect: (r: ArchidektSearchResult) => void;
  onRefine: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{results.length} results</span>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onRefine}>
          Refine search
        </Button>
      </div>
      <ul className="divide-y rounded-md border">
        {results.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r)}
              className={cn(
                "w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors",
                "flex flex-col gap-0.5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{r.name}</span>
                {r.format && (
                  <span className="text-[10px] text-muted-foreground shrink-0">{r.format}</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                by {r.author}
                {r.description
                  ? ` · ${r.description}`
                  : r.tags.length
                    ? ` · ${r.tags.join(", ")}`
                    : ""}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeckPreview({ result, deck }: { result: ArchidektSearchResult; deck: ArchidektDeck }) {
  const totalCount = useMemo(() => deck.cards.reduce((s, c) => s + c.count, 0), [deck.cards]);
  const sorted = useMemo(
    () => [...deck.cards].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [deck.cards],
  );
  const colors = deck.colors.join("") || "—";
  const descFirst = deck.description.split("\n").find((l) => l.trim()) ?? "";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{deck.name}</h3>
        <div className="text-[11px] text-muted-foreground">
          by {result.author}
          {result.format ? ` · ${result.format}` : ""}
          {` · ${colors}`}
          {` · ${deck.cards.length} unique / ${totalCount} total`}
        </div>
        {descFirst && <p className="text-[11px] text-muted-foreground line-clamp-2">{descFirst}</p>}
      </div>

      <div className="rounded-md border">
        <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground border-b">
          Cards ({sorted.length})
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 p-2 max-h-64 overflow-y-auto text-[11px]">
          {sorted.map((card) => (
            <div
              key={card.name}
              className="flex gap-2 py-0.5 cursor-default rounded hover:bg-accent/50 px-1"
            >
              <span className="text-muted-foreground w-6 text-right shrink-0">{card.count}×</span>
              <span className="truncate">{card.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
