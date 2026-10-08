import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardHoverPreview } from "@/components/game/CardHoverPreview";
import {
  LIMITED_GATHERER_URL,
  LIMITED_RULES_URL,
  LIMITED_SET_GUIDES,
} from "@/components/limited/limitedSetGuides";
import { LimitedGuideSection } from "@/components/limited/LimitedGuideSection";
import { useCardPreview } from "@/hooks/useCardPreview";
import { refToDeckCard } from "@/lib/limited.utils";
import { deckCardToPreviewDto, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";

export type LimitedReferenceFormat = "set" | "mixed" | "cube";

interface LimitedSetReferenceProps {
  cards: DraftCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setCodes?: string[];
  format?: LimitedReferenceFormat;
}

export function LimitedSetReference({
  cards,
  open,
  onOpenChange,
  setCodes = [],
  format = "set",
}: LimitedSetReferenceProps) {
  const sets = useScryfallStore((state) => state.sets);
  const [selection, setSelection] = useState("");
  const [browseAll, setBrowseAll] = useState(false);
  const [inspection, setInspection] = useState<{ name: string; error: boolean } | null>(null);
  const request = useRef(0);
  const preview = useCardPreview([open, selection, browseAll]);
  const [previewPortalTarget, setPreviewPortalTarget] = useState<HTMLDivElement | null>(null);
  const contextCodes = useMemo(
    () => [
      ...new Set(
        [...setCodes, ...cards.map((card) => card.setCode)]
          .map((code) => code.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    [cards, setCodes],
  );
  const choices = browseAll
    ? [...new Set([...contextCodes, ...Object.keys(LIMITED_SET_GUIDES)])]
    : contextCodes;
  const selectedCode = choices.includes(selection) ? selection : (choices[0] ?? "");
  const guide = Object.hasOwn(LIMITED_SET_GUIDES, selectedCode)
    ? LIMITED_SET_GUIDES[selectedCode]
    : undefined;
  const setName =
    guide?.name ??
    sets.find((set) => set.code === selectedCode)?.name ??
    selectedCode.toUpperCase();
  const mixed = format !== "set" || contextCodes.length > 1;

  const inspect = async (name: string, anchor: HTMLElement) => {
    const revision = ++request.current;
    const stillOwned = preview.claimOwnership();
    setInspection({ name, error: false });
    const exact =
      cards.find((card) => card.name === name && card.setCode.toLowerCase() === selectedCode) ??
      cards.find((card) => card.name === name);
    try {
      const entry = await useScryfallStore
        .getState()
        .getCard(
          exact
            ? { name: exact.name, setCode: exact.setCode, cardNumber: exact.cardNumber }
            : { name },
        );
      if (request.current !== revision || !stillOwned() || !anchor.isConnected) return;
      const deckCard = exact
        ? refToDeckCard(exact, entry)
        : scryfallToDeckCard({
            ...entry.info,
            image_uris: entry.info.image_uris ?? entry.uris,
          });
      preview.showSticky(deckCardToPreviewDto(deckCard), undefined, undefined, anchor);
      setInspection(null);
    } catch {
      if (request.current === revision && stillOwned()) setInspection({ name, error: true });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        request.current += 1;
        setInspection(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        ref={setPreviewPortalTarget}
        className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Set reference</DialogTitle>
          <DialogDescription>
            Bundled set themes and rules notes. Card inspection uses shared card metadata; uncached
            cards and external sources need a connection.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect
            value={selectedCode}
            onValueChange={(code) => {
              request.current += 1;
              setInspection(null);
              setSelection(code);
            }}
            aria-label="Reference set"
            className="min-w-0 flex-1"
          >
            {choices.length === 0 && <AppSelectOption value="">No set selected</AppSelectOption>}
            {choices.map((code) => (
              <AppSelectOption key={code} value={code}>
                {(Object.hasOwn(LIMITED_SET_GUIDES, code)
                  ? LIMITED_SET_GUIDES[code].name
                  : undefined) ??
                  sets.find((set) => set.code === code)?.name ??
                  code.toUpperCase()}
                {Object.hasOwn(LIMITED_SET_GUIDES, code) ? " · Guide" : " · Rules links only"}
              </AppSelectOption>
            ))}
          </AppSelect>
          <Button
            variant={browseAll ? "selected" : "outline"}
            aria-pressed={browseAll}
            onClick={() => setBrowseAll(!browseAll)}
          >
            All bundled guides
          </Button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 text-sm">
          {mixed && (
            <p className="rounded border border-border bg-muted/30 p-3">
              {format === "cube" ? "Cube reference" : "Mixed-set reference"}. These are the original
              sets' themes, not an archetype map for this pool. Use the actual cards and cube design
              to judge which synergies exist.
            </p>
          )}
          {!selectedCode ? (
            <p>
              No printing set is available yet. Select a set in setup or open All bundled guides to
              read the available references.
            </p>
          ) : (
            <section className="space-y-3">
              <h2 className="text-base font-semibold">{setName}</h2>
              <details className="rounded border border-border p-3" open>
                <summary className="min-h-8 cursor-pointer font-medium">
                  Coverage and sources
                </summary>
                <p className="my-2 text-muted-foreground">
                  {guide?.coverage ??
                    "No authored set guide is bundled for this set. Current card text, individual rulings and the official rules remain available below. No set-specific archetype or pick advice is inferred."}
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Guide text is bundled for offline reading. Card buttons inspect an exact pool
                  printing when available, otherwise shared default metadata. Historical articles
                  may predate rules changes; current Oracle text and rules take precedence.
                </p>
                <ul className="space-y-2">
                  {guide?.sources.map((source) => (
                    <li key={source.url}>
                      <a
                        className="text-primary underline underline-offset-4"
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.title} ↗
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      className="text-primary underline underline-offset-4"
                      href={LIMITED_RULES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Wizards · Current Magic rules ↗
                    </a>
                  </li>
                  <li>
                    <a
                      className="text-primary underline underline-offset-4"
                      href={LIMITED_GATHERER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Wizards · Gatherer card text and rulings ↗
                    </a>
                  </li>
                </ul>
              </details>
              {guide && (
                <>
                  {guide.archetypes.length > 0 && (
                    <LimitedGuideSection
                      title="Original set archetypes"
                      topics={guide.archetypes}
                      onInspect={inspect}
                    />
                  )}
                  <LimitedGuideSection
                    title="Mechanics"
                    topics={guide.mechanics}
                    onInspect={inspect}
                  />
                  <LimitedGuideSection
                    title="Interactions and rules notes"
                    topics={guide.interactions}
                    onInspect={inspect}
                  />
                </>
              )}
            </section>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p role="status" className="text-xs text-muted-foreground">
            {inspection
              ? inspection.error
                ? `Card details unavailable for ${inspection.name}. Reconnect and select the card to retry.`
                : `Loading ${inspection.name}…`
              : "Select a card name to inspect it."}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              request.current += 1;
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
        <CardHoverPreview preview={preview} portalTarget={previewPortalTarget} />
      </DialogContent>
    </Dialog>
  );
}
