import { useRef, useState } from "react";
import {
  BadgeDollarSign,
  Check,
  Layers3,
  Loader2,
  Sparkles,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { scryfallCardKey } from "@/api/scryfall";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { cardKey, useScryfallStore } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import type { ScryfallCard } from "@/types/scryfall";
import { executeDeckEdit } from "./deckEditor.history";
import {
  allocateOwnedPrintings,
  cheapestCompatiblePrinting,
  supportsPrintingFinish,
} from "./printingOptimizer";

type OptimizerPolicy = "owned" | "cheapest" | "nonfoil";

interface PrintingChange {
  cardId: string;
  name: string;
  from: string;
  to: string;
  print?: ScryfallCard;
  targetFoil?: boolean;
}

interface PrintingSkip {
  cardId: string;
  name: string;
  printing: string;
  reason: string;
}

export function PrintingOptimizerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState<OptimizerPolicy | null>(null);
  const [changes, setChanges] = useState<PrintingChange[]>([]);
  const [skipped, setSkipped] = useState<PrintingSkip[]>([]);
  const [progress, setProgress] = useState(0);
  const [proposalSessionId, setProposalSessionId] = useState<string | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<OptimizerPolicy>("owned");
  const abortControllerRef = useRef<AbortController | null>(null);
  const deck = useDeckStore((state) => state.currentDeck);
  const quantities = useCollectionStore((state) => state.quantities);

  const allCards = [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.maybeboard ?? []),
    ...(deck.commanders ?? []),
    ...(deck.companion ? [deck.companion] : []),
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
  ];
  const uniqueCards = [
    ...new Map(
      allCards.map((card) => [
        `${card.identity.name.toLowerCase()}::${!!card.identity.foil}`,
        card,
      ]),
    ).values(),
  ];

  async function buildProposal(policy: OptimizerPolicy) {
    const sessionId = useDeckStore.getState().editorSessionId;
    setProposalSessionId(sessionId);
    setLoading(policy);
    setChanges([]);
    setSkipped([]);
    setProgress(0);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    try {
      let proposal: PrintingChange[] = [];
      const unresolved: PrintingSkip[] = [];
      if (policy === "nonfoil") {
        const foilCards = allCards.filter((card) => card.identity.foil);
        const currentPrintings = await useScryfallStore.getState().fetchCardCollection(
          foilCards.map((card) => ({
            name: card.identity.name,
            setCode: card.identity.setCode,
            collectorNumber: card.identity.cardNumber,
          })),
          abortController.signal,
        );
        abortController.signal.throwIfAborted();
        for (const card of foilCards) {
          const printing = `${card.identity.setCode.toUpperCase()} #${card.identity.cardNumber}`;
          const print = currentPrintings.get(
            scryfallCardKey(card.identity.name, card.identity.setCode, card.identity.cardNumber),
          );
          if (!print) {
            unresolved.push({
              cardId: card.identity.id,
              name: card.identity.name,
              printing,
              reason: "Printing could not be resolved",
            });
          } else if (!supportsPrintingFinish(print, false)) {
            unresolved.push({
              cardId: card.identity.id,
              name: card.identity.name,
              printing,
              reason: "This printing is foil-only",
            });
          } else {
            proposal.push({
              cardId: card.identity.id,
              name: card.identity.name,
              from: `${printing} · foil`,
              to: `${printing} · non-foil`,
              targetFoil: false,
            });
          }
        }
      } else if (policy === "owned") {
        const assignments = allocateOwnedPrintings(allCards, quantities);
        const cards = await useScryfallStore
          .getState()
          .fetchCardCollection(assignments, abortController.signal);
        abortController.signal.throwIfAborted();
        proposal = assignments.flatMap((assignment) => {
          const card = allCards.find((candidate) => candidate.identity.id === assignment.cardId);
          if (!card) return [];
          const print = cards.get(
            scryfallCardKey(assignment.name, assignment.setCode, assignment.collectorNumber),
          );
          if (!print) return [];
          return [
            {
              cardId: assignment.cardId,
              name: card.identity.name,
              from: `${card.identity.setCode.toUpperCase()} #${card.identity.cardNumber}${card.identity.foil ? " · foil" : ""}`,
              to: `${print.set.toUpperCase()} #${print.collector_number}${assignment.foil ? " · foil" : ""}`,
              print,
              targetFoil: assignment.foil,
            },
          ];
        });
      } else {
        const provider = deck.editor?.priceProvider ?? "tcgplayer";
        const printsByName = await useScryfallStore.getState().getPrintings(
          uniqueCards.map((card) => ({
            name: card.identity.name,
            setCode: card.identity.setCode,
            collectorNumber: card.identity.cardNumber,
          })),
          (completed, total) => setProgress(completed / total),
          abortController.signal,
        );
        abortController.signal.throwIfAborted();
        for (const card of uniqueCards) {
          if (useDeckStore.getState().editorSessionId !== sessionId) {
            throw new Error("The open deck changed while printings were being checked");
          }
          const prints =
            printsByName.get(
              cardKey({
                name: card.identity.name,
                setCode: card.identity.setCode,
                collectorNumber: card.identity.cardNumber,
              }),
            ) ?? [];
          const cheapest = cheapestCompatiblePrinting(prints, provider, !!card.identity.foil);
          if (cheapest) {
            proposal.push(
              ...allCards
                .filter(
                  (copy) =>
                    copy.identity.name === card.identity.name &&
                    !!copy.identity.foil === !!card.identity.foil &&
                    (copy.identity.setCode.toLowerCase() !== cheapest.set ||
                      copy.identity.cardNumber !== cheapest.collector_number),
                )
                .map((copy) => ({
                  cardId: copy.identity.id,
                  name: copy.identity.name,
                  from: `${copy.identity.setCode.toUpperCase()} #${copy.identity.cardNumber}${copy.identity.foil ? " · foil" : ""}`,
                  to: `${cheapest.set.toUpperCase()} #${cheapest.collector_number}${copy.identity.foil ? " · foil" : ""}`,
                  print: cheapest,
                  targetFoil: !!copy.identity.foil,
                })),
            );
          }
          if (prints.length === 0) throw new Error(`Could not resolve ${card.identity.name}`);
        }
      }
      if (useDeckStore.getState().editorSessionId !== sessionId) {
        throw new Error("The open deck changed while printings were being checked");
      }
      setChanges(proposal);
      setSkipped(unresolved);
      if (proposal.length === 0 && unresolved.length === 0) {
        toast.info("The selected policy would not change this deck");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error instanceof Error ? error.message : "Could not optimize deck printings");
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        setLoading(null);
        setProgress(0);
      }
    }
  }

  function applyProposal() {
    if (proposalSessionId !== useDeckStore.getState().editorSessionId) {
      toast.error("The open deck changed. Build the printing proposal again.");
      setChanges([]);
      setSkipped([]);
      return;
    }
    executeDeckEdit(`Optimize ${changes.length} deck printings`, () => {
      for (const change of changes) {
        if (change.print) {
          useDeckStore.getState().updateCardPrint(change.cardId, change.print, change.targetFoil);
        } else if (change.targetFoil !== undefined) {
          useDeckStore.getState().setCardFoil(change.cardId, change.targetFoil);
        }
      }
    });
    toast.success(
      `Updated ${changes.length} card ${changes.length === 1 ? "printing" : "printings"}`,
    );
    setChanges([]);
    setSkipped([]);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          abortControllerRef.current?.abort();
          abortControllerRef.current = null;
          setLoading(null);
          setProgress(0);
          setChanges([]);
          setSkipped([]);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Optimize deck printings</DialogTitle>
          <DialogDescription>
            Choose a policy, review every proposed change, then apply it as one undoable edit.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <PolicyButton
            icon={WalletCards}
            label="Owned printings"
            detail="Match the exact copies and finishes you own"
            selected={selectedPolicy === "owned"}
            busy={loading === "owned"}
            disabled={loading !== null}
            onClick={() => setSelectedPolicy("owned")}
          />
          <PolicyButton
            icon={BadgeDollarSign}
            label="Cheapest printings"
            detail="Minimize the deck price using your chosen provider"
            selected={selectedPolicy === "cheapest"}
            busy={loading === "cheapest"}
            disabled={loading !== null}
            onClick={() => setSelectedPolicy("cheapest")}
          />
          <PolicyButton
            icon={Layers3}
            label="All non-foil"
            detail="Keep every printing and normalize the finish"
            selected={selectedPolicy === "nonfoil"}
            busy={loading === "nonfoil"}
            disabled={loading !== null}
            onClick={() => setSelectedPolicy("nonfoil")}
          />
        </div>
        {changes.length === 0 && skipped.length === 0 && !loading && (
          <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Ready to scan {allCards.length} cards</p>
              <p className="text-xs text-muted-foreground">
                Nothing changes until you review and apply the proposal.
              </p>
            </div>
            <Button
              className="shrink-0 gap-2"
              disabled={allCards.length === 0}
              onClick={() => void buildProposal(selectedPolicy)}
            >
              <Sparkles className="h-4 w-4" /> Build proposal
            </Button>
          </div>
        )}
        {loading && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin" /> Scanning available printings
              </span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(progress * 100)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(progress * 100, 4)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Large decks can take a moment. Requests are grouped and safely paced through the
              shared card-data service.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                abortControllerRef.current?.abort();
                abortControllerRef.current = null;
                setLoading(null);
                setProgress(0);
              }}
            >
              Cancel scan
            </Button>
          </div>
        )}
        {changes.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="font-medium">Proposal ready</p>
                <p className="text-xs text-muted-foreground">
                  {changes.length} {changes.length === 1 ? "copy" : "copies"} will change · one
                  undoable edit
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setChanges([]);
                  setSkipped([]);
                }}
              >
                Change goal
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
              {changes.map((change) => (
                <div
                  key={change.cardId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs"
                >
                  <span className="truncate font-medium">{change.name}</span>
                  <span className="text-right text-muted-foreground">
                    {change.from} → {change.to}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Review the exact before and after printing.
              </p>
              <Button className="gap-1" onClick={applyProposal}>
                <Check className="h-3.5 w-3.5" /> Apply {changes.length} changes
              </Button>
            </div>
          </div>
        )}
        {skipped.length > 0 && (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <TriangleAlert className="h-4 w-4" /> Could not convert {skipped.length}{" "}
                {skipped.length === 1 ? "copy" : "copies"}
              </div>
              {changes.length === 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSkipped([])}>
                  Change goal
                </Button>
              )}
            </div>
            <div className="max-h-36 overflow-y-auto divide-y divide-border/50">
              {skipped.map((item) => (
                <div
                  key={item.cardId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-xs"
                >
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="text-right text-muted-foreground">
                    {item.printing} · {item.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PolicyButton({
  icon: Icon,
  label,
  detail,
  selected,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  detail: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className={cn(
        "h-auto min-h-24 items-start justify-start gap-3 whitespace-normal p-4 text-left",
        selected && "border-primary bg-primary/5 ring-1 ring-primary",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs font-normal text-muted-foreground">{detail}</span>
      </span>
    </Button>
  );
}
