import { Button } from "@/components/ui/button";
import { CardRenderingTextField } from "@/components/dev/CardRenderingTextField";
import type { CardRenderingOverrides } from "@/components/dev/cardRenderingOverrides";
import type { ClientCardDto } from "@/stores/gameStore.types";

interface CardRenderingCharacteristicControlsProps {
  card: ClientCardDto;
  value: CardRenderingOverrides;
  onChange: (value: CardRenderingOverrides) => void;
}

const QUICK_KEYWORDS = ["Flying", "Trample", "Haste", "Vigilance", "Lifelink", "Deathtouch"];
const TYPE_FIELDS = ["types", "supertypes", "subtypes"] as const;
const TYPE_LABELS = { types: "Card types", supertypes: "Supertypes", subtypes: "Subtypes" };

export function CardRenderingCharacteristicControls({
  card,
  value,
  onChange,
}: CardRenderingCharacteristicControlsProps) {
  const setStat = (key: "power" | "toughness", input: string) => {
    const trimmed = input.trim();
    if (trimmed === "") onChange({ ...value, [key]: null });
    else if (/^-?\d+$/.test(trimmed)) onChange({ ...value, [key]: String(Number(trimmed)) });
  };
  const numericStats =
    card.power != null &&
    card.toughness != null &&
    Number.isFinite(Number(card.power)) &&
    Number.isFinite(Number(card.toughness));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {TYPE_FIELDS.map((key) => (
          <CardRenderingTextField
            key={key}
            label={TYPE_LABELS[key]}
            value={card[key].join(", ")}
            placeholder="Comma-separated"
            onChange={(input) =>
              onChange({
                ...value,
                [key]: [
                  ...new Set(
                    input
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  ),
                ],
              })
            }
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["power", "toughness"] as const).map((key) => (
          <CardRenderingTextField
            key={key}
            label={key === "power" ? "Power" : "Toughness"}
            numeric
            value={card[key] ?? ""}
            placeholder="No stat"
            onChange={(input) => setStat(key, input)}
          />
        ))}
        <CardRenderingTextField
          label="Marked damage"
          numeric
          value={String(card.damage)}
          onChange={(input) => {
            if (/^\d*$/.test(input)) onChange({ ...value, damage: Number(input) });
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!numericStats}
          onClick={() =>
            onChange({
              ...value,
              power: String(Number(card.power) + 2),
              toughness: String(Number(card.toughness) + 2),
            })
          }
        >
          Buff +2/+2
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!numericStats}
          onClick={() =>
            onChange({
              ...value,
              power: String(Number(card.power) - 2),
              toughness: String(Number(card.toughness) - 2),
            })
          }
        >
          Debuff −2/−2
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!card.types.includes("Land")}
          onClick={() =>
            onChange({
              ...value,
              types: [...new Set([...card.types, "Creature"])],
              subtypes: [...new Set([...card.subtypes, "Elemental"])],
              power: "3",
              toughness: "3",
            })
          }
        >
          Animate land 3/3
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={value.power === undefined && value.toughness === undefined}
          onClick={() => {
            const next = { ...value };
            delete next.power;
            delete next.toughness;
            onChange(next);
          }}
        >
          Automatic P/T
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        P/T edits set final values. Automatic P/T follows the fixture and +1/+1 or −1/−1 counter
        changes. Clear a P/T field to remove that stat. Printed characteristics and the scan stay
        unchanged.
      </p>
      <CardRenderingTextField
        label="Keywords"
        value={card.keywords.join(", ")}
        placeholder="Comma-separated, e.g. Flying, Ward:{2}"
        onChange={(input) =>
          onChange({
            ...value,
            keywords: [
              ...new Set(
                input
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              ),
            ],
          })
        }
      />
      <div className="flex flex-wrap gap-2" aria-label="Quick keywords">
        {QUICK_KEYWORDS.map((keyword) => {
          const active = card.keywords.some((item) => item.toLowerCase() === keyword.toLowerCase());
          return (
            <Button
              key={keyword}
              variant={active ? "selected" : "outline"}
              size="sm"
              aria-pressed={active}
              onClick={() =>
                onChange({
                  ...value,
                  keywords: active
                    ? card.keywords.filter((item) => item.toLowerCase() !== keyword.toLowerCase())
                    : [...card.keywords, keyword],
                })
              }
            >
              {keyword}
            </Button>
          );
        })}
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...value, keywords: [] })}>
          Clear keywords
        </Button>
      </div>
    </div>
  );
}
