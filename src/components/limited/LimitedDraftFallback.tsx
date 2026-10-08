import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import type { DraftCard } from "@/types/limited";

interface LimitedDraftFallbackProps {
  cards: DraftCard[];
  nominatedId: string | null;
  onNominate: (card: DraftCard | null) => void | Promise<void>;
  disabled?: boolean;
}

export function LimitedDraftFallback({
  cards,
  nominatedId,
  onNominate,
  disabled = false,
}: LimitedDraftFallbackProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">Timeout fallback</span>
      <AppSelect
        aria-label="Nominate a timeout fallback without picking it"
        value={nominatedId ?? ""}
        disabled={disabled}
        className="h-8 min-w-0 max-w-64 text-xs"
        onValueChange={(value) => {
          void onNominate(cards.find((card) => card.id === value) ?? null);
        }}
      >
        <AppSelectOption value="">AI choice</AppSelectOption>
        {cards.map((card) => (
          <AppSelectOption key={card.id} value={card.id}>
            {card.name}
          </AppSelectOption>
        ))}
      </AppSelect>
      {nominatedId && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 px-2 text-xs"
          onClick={() => void onNominate(null)}
        >
          Remove
        </Button>
      )}
    </div>
  );
}
