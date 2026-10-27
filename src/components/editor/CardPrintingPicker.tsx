import { useState, useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  cardKey,
  getArchivedTokenPrints,
  useScryfallStore,
  useSetLookup,
} from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";
import { isHorizontalCard } from "@/lib/cardLayout";
import { HorizontalCardImage } from "@/components/game/HorizontalCardImage";
import { ScryfallImg } from "@/components/ScryfallImg";
import { cn } from "@/lib/utils";
import type { DeckCard, DeckCardIdentity } from "@/protocol/deck";

export function CardPrintingPicker({
  cardName,
  token,
  printing,
  disabled = false,
  layout = "grid",
  onSelect,
}: {
  cardName: string;
  token?: DeckCard;
  printing?: DeckCardIdentity;
  disabled?: boolean;
  layout?: "grid" | "row";
  onSelect: (print: ScryfallCard) => void;
}) {
  const [prints, setPrints] = useState<ScryfallCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setLookup = useSetLookup();
  const resolvedName = token?.identity.name ?? cardName;
  useEffect(() => {
    let mounted = true;
    async function fetchPrints() {
      setIsLoading(true);
      setError(null);
      try {
        if (token) {
          const tokenPrints = await getArchivedTokenPrints(token);
          if (mounted) setPrints(tokenPrints);
          return;
        }
        const prints = await useScryfallStore.getState().getPrintings([{ name: resolvedName }]);
        if (mounted) setPrints(prints.get(cardKey({ name: resolvedName })) ?? []);
      } catch {
        if (mounted) setError("Failed to fetch printings.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void fetchPrints();
    return () => {
      mounted = false;
    };
  }, [resolvedName, token]);

  if (isLoading)
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="text-ui-body">Loading printings…</span>
      </div>
    );
  if (error)
    return (
      <p role="alert" className="py-8 text-center text-ui-body text-destructive">
        {error}
      </p>
    );
  if (prints.length === 0)
    return (
      <p role="status" className="py-8 text-center text-ui-body text-muted-foreground">
        No printings available.
      </p>
    );

  return (
    <div
      className={cn(
        layout === "row"
          ? "flex min-w-0 items-start gap-3 overflow-x-auto overscroll-x-contain p-1"
          : "grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-4",
      )}
    >
      {prints.map((print) => {
        const face = print.card_faces
          ? print.card_faces.find(
              (face) => face.name.toLowerCase() === resolvedName.toLowerCase(),
            ) || print.card_faces[0]
          : null;
        const imageUrl =
          face?.image_uris?.normal ||
          face?.image_uris?.large ||
          print.image_uris?.normal ||
          print.image_uris?.large;
        const selected =
          printing?.setCode.toLowerCase() === print.set.toLowerCase() &&
          printing.cardNumber === print.collector_number;
        return (
          <button
            key={print.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            aria-label={`${print.set_name}, ${print.set.toUpperCase()} #${print.collector_number}`}
            className={cn(
              "touch:min-w-11 touch:min-h-11 group flex min-w-0 flex-col items-center gap-1 rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              layout === "row" && "w-32 shrink-0",
            )}
            onClick={() => onSelect(print)}
          >
            <div
              className={cn(
                "relative flex w-full max-w-44 items-center justify-center overflow-hidden rounded-[4%] border-2 bg-muted transition-colors group-hover:border-selection-border",
                selected ? "border-selection-border" : "border-transparent",
                isHorizontalCard({ layout: print.layout, typeLine: print.type_line })
                  ? "aspect-[7/5]"
                  : "aspect-[5/7]",
              )}
            >
              {imageUrl ? (
                isHorizontalCard({ layout: print.layout, typeLine: print.type_line }) ? (
                  <HorizontalCardImage
                    src={imageUrl}
                    alt={`${print.set_name} printing`}
                    className="absolute inset-0"
                    loading="lazy"
                  />
                ) : (
                  <ScryfallImg
                    src={imageUrl}
                    alt={`${print.set_name} printing`}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                )
              ) : (
                <span className="text-center text-ui-meta text-muted-foreground">No image</span>
              )}
              {selected && (
                <span className="absolute right-1 top-1 rounded-full bg-selection p-1 text-selection-foreground">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </div>
            <span className="flex w-full items-center justify-center gap-1 text-center text-ui-label font-semibold">
              {setLookup.get(print.set)?.icon_svg_uri && (
                <ScryfallImg
                  src={setLookup.get(print.set)!.icon_svg_uri}
                  alt=""
                  className="h-3.5 w-3.5 shrink-0 brightness-0 dark:invert"
                />
              )}
              <span className="min-w-0 break-words">{print.set_name}</span>
            </span>
            <span className="text-ui-meta uppercase text-muted-foreground">
              {print.set} · #{print.collector_number}
            </span>
          </button>
        );
      })}
    </div>
  );
}
