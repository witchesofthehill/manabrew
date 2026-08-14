import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { fetchCardCollection, getCardPrints, scryfallCardKey } from "@/api/scryfall";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseCollectionCardKey } from "@/lib/collection";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";
import { executeDeckEdit } from "./deckEditor.history";

type OptimizerPolicy = "owned" | "cheapest" | "nonfoil";

interface PrintingChange {
  name: string;
  from: string;
  to: string;
  print?: ScryfallCard;
  targetFoil?: boolean;
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
  const [progress, setProgress] = useState(0);
  const [proposalSessionId, setProposalSessionId] = useState<string | null>(null);
  const deck = useDeckStore((state) => state.currentDeck);
  const quantities = useCollectionStore((state) => state.quantities);

  const uniqueCards = [
    ...new Map(
      [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])].map((card) => [
        card.identity.name.toLowerCase(),
        card,
      ]),
    ).values(),
  ];

  async function buildProposal(policy: OptimizerPolicy) {
    const sessionId = useDeckStore.getState().editorSessionId;
    setProposalSessionId(sessionId);
    setLoading(policy);
    setChanges([]);
    setProgress(0);
    try {
      let proposal: PrintingChange[] = [];
      if (policy === "nonfoil") {
        proposal = uniqueCards
          .filter((card) => card.identity.foil)
          .map((card) => ({
            name: card.identity.name,
            from: `${card.identity.setCode.toUpperCase()} #${card.identity.cardNumber} · foil`,
            to: `${card.identity.setCode.toUpperCase()} #${card.identity.cardNumber} · non-foil`,
            targetFoil: false,
          }));
      } else if (policy === "owned") {
        const owned = Object.entries(quantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([key]) => parseCollectionCardKey(key))
          .filter(
            (identity) =>
              identity.setCode &&
              identity.collectorNumber &&
              uniqueCards.some(
                (card) => card.identity.name.toLowerCase() === identity.name.toLowerCase(),
              ),
          );
        const cards = await fetchCardCollection(owned);
        proposal = uniqueCards.flatMap((card) => {
          const identity = owned.find(
            (candidate) =>
              candidate.name.toLowerCase() === card.identity.name.toLowerCase() &&
              (candidate.setCode !== card.identity.setCode.toLowerCase() ||
                candidate.collectorNumber !== card.identity.cardNumber.toLowerCase() ||
                candidate.foil !== (card.identity.foil ?? false)),
          );
          if (!identity?.setCode || !identity.collectorNumber) return [];
          const print = cards.get(
            scryfallCardKey(identity.name, identity.setCode, identity.collectorNumber),
          );
          if (!print) return [];
          return [
            {
              name: card.identity.name,
              from: `${card.identity.setCode.toUpperCase()} #${card.identity.cardNumber}`,
              to: `${print.set.toUpperCase()} #${print.collector_number}${identity.foil ? " · foil" : ""}`,
              print,
              targetFoil: identity.foil ?? false,
            },
          ];
        });
      } else {
        const provider = deck.editor?.priceProvider ?? "tcgplayer";
        for (const [index, card] of uniqueCards.entries()) {
          if (useDeckStore.getState().editorSessionId !== sessionId) {
            throw new Error("The open deck changed while printings were being checked");
          }
          const resolved = await useScryfallStore.getState().getCard({ name: card.identity.name });
          let page = await getCardPrints(resolved.info.prints_search_uri);
          const prints = [...(page.data ?? [])];
          while (page.has_more && page.next_page) {
            page = await getCardPrints(page.next_page);
            prints.push(...(page.data ?? []));
          }
          const priceOf = (print: ScryfallCard) => {
            if (provider === "cardhoarder") return Number(print.prices.tix);
            if (provider === "cardmarket") {
              return Number(card.identity.foil ? print.prices.eur_foil : print.prices.eur);
            }
            return Number(card.identity.foil ? print.prices.usd_foil : print.prices.usd);
          };
          const cheapest = prints
            .filter((print) => Number.isFinite(priceOf(print)) && priceOf(print) > 0)
            .sort((left, right) => priceOf(left) - priceOf(right))[0];
          if (
            cheapest &&
            (cheapest.set !== card.identity.setCode.toLowerCase() ||
              cheapest.collector_number !== card.identity.cardNumber)
          ) {
            proposal.push({
              name: card.identity.name,
              from: `${card.identity.setCode.toUpperCase()} #${card.identity.cardNumber}`,
              to: `${cheapest.set.toUpperCase()} #${cheapest.collector_number}`,
              print: cheapest,
            });
          }
          setProgress((index + 1) / uniqueCards.length);
        }
      }
      if (useDeckStore.getState().editorSessionId !== sessionId) {
        throw new Error("The open deck changed while printings were being checked");
      }
      setChanges(proposal);
      if (proposal.length === 0) toast.info("The selected policy would not change this deck");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not optimize deck printings");
    } finally {
      setLoading(null);
      setProgress(0);
    }
  }

  function applyProposal() {
    if (proposalSessionId !== useDeckStore.getState().editorSessionId) {
      toast.error("The open deck changed. Build the printing proposal again.");
      setChanges([]);
      return;
    }
    executeDeckEdit(`Optimize ${changes.length} deck printings`, () => {
      for (const change of changes) {
        if (change.print) useDeckStore.getState().updatePrint(change.name, change.print);
        const currentDeck = useDeckStore.getState().currentDeck;
        const current = [
          ...currentDeck.cards,
          ...currentDeck.sideboard,
          ...(currentDeck.commanders ?? []),
        ].find((card) => card.identity.name === change.name);
        if (change.targetFoil !== undefined && !!current?.identity.foil !== change.targetFoil) {
          useDeckStore.getState().toggleFoil(change.name);
        }
      }
    });
    toast.success(
      `Updated ${changes.length} card ${changes.length === 1 ? "printing" : "printings"}`,
    );
    setChanges([]);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && loading) return;
        if (!next) setChanges([]);
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
        <div className="grid gap-2 sm:grid-cols-3">
          <PolicyButton
            label="Owned printings"
            detail="Prefer a printing in your collection"
            busy={loading === "owned"}
            disabled={loading !== null}
            onClick={() => void buildProposal("owned")}
          />
          <PolicyButton
            label="Cheapest printings"
            detail="Find the lowest listed paper price"
            busy={loading === "cheapest"}
            disabled={loading !== null}
            onClick={() => void buildProposal("cheapest")}
          />
          <PolicyButton
            label="All non-foil"
            detail="Keep the art and remove foil finishes"
            busy={loading === "nonfoil"}
            disabled={loading !== null}
            onClick={() => void buildProposal("nonfoil")}
          />
        </div>
        {loading === "cheapest" && (
          <p className="text-xs text-muted-foreground">
            Checking printings… {Math.round(progress * 100)}%
          </p>
        )}
        {changes.length > 0 && (
          <div className="space-y-3">
            <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
              {changes.map((change) => (
                <div
                  key={change.name}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs"
                >
                  <span className="truncate font-medium">{change.name}</span>
                  <span className="text-right text-muted-foreground">
                    {change.from} → {change.to}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button className="gap-1" onClick={applyProposal}>
                <Check className="h-3.5 w-3.5" /> Apply {changes.length} changes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PolicyButton({
  label,
  detail,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  detail: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-auto justify-start gap-2 py-3 text-left"
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs font-normal text-muted-foreground">{detail}</span>
      </span>
    </Button>
  );
}
