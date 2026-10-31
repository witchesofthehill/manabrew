import { Button } from "@/components/ui/button";
import { CardRenderingTextField } from "@/components/dev/CardRenderingTextField";
import type { CardRenderingOverrides } from "@/components/dev/cardRenderingOverrides";
import type { ClientCardDto } from "@/stores/gameStore.types";

interface CardRenderingCounterControlsProps {
  card: ClientCardDto;
  value: CardRenderingOverrides;
  onChange: (value: CardRenderingOverrides) => void;
}

const COUNTER_LABELS: Record<string, string> = {
  P1P1: "+1/+1",
  M1M1: "−1/−1",
  Loyalty: "Loyalty",
  Defense: "Defense",
  Lore: "Lore",
  Charge: "Charge",
};

export function CardRenderingCounterControls({
  card,
  value,
  onChange,
}: CardRenderingCounterControlsProps) {
  const counterTypes = [
    ...new Set([
      ...Object.keys(COUNTER_LABELS),
      ...Object.keys(card.counters),
      ...Object.keys(value.counters ?? {}),
    ]),
  ];
  const setCount = (type: string, count: number) => {
    onChange({ ...value, counters: { ...value.counters, [type]: Math.max(0, count) } });
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        {counterTypes.map((type) => {
          const label = COUNTER_LABELS[type] ?? type;
          const count = card.counters[type] ?? 0;
          return (
            <div key={type} className="flex flex-wrap items-end gap-1">
              <div className="min-w-24 flex-1">
                <CardRenderingTextField
                  label={`${label} counters`}
                  numeric
                  value={String(count)}
                  onChange={(input) => {
                    if (/^\d*$/.test(input)) setCount(type, Number(input));
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="touch:min-w-11"
                aria-label={`Remove one ${label} counter`}
                disabled={count === 0}
                onClick={() => setCount(type, count - 1)}
              >
                −
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="touch:min-w-11"
                aria-label={`Add one ${label} counter`}
                onClick={() => setCount(type, count + 1)}
              >
                +
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="touch:min-w-11"
                aria-label={`Clear ${label} counters`}
                disabled={count === 0}
                onClick={() => setCount(type, 0)}
              >
                ×
              </Button>
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange({
            ...value,
            counters: Object.fromEntries(counterTypes.map((type) => [type, 0])),
          })
        }
      >
        Clear all counters
      </Button>
    </div>
  );
}
