import { Button } from "@/components/ui/button";
import type { CardRenderingOverrides } from "@/components/dev/cardRenderingOverrides";
import type { ClientCardDto } from "@/stores/gameStore.types";
import { printedPrototype } from "@/lib/cardPrototype";
import { DEV_CONTROL_ACTIVE } from "@/components/dev/devPanel.styles";
import { cn } from "@/lib/utils";

interface Props {
  card: ClientCardDto;
  layout?: string;
  startingDefense?: string;
  value: CardRenderingOverrides;
  onChange: (value: CardRenderingOverrides) => void;
}

export function CardRenderingMechanicControls({
  card,
  value,
  onChange,
  layout,
  startingDefense,
}: Props) {
  const presets: Array<{ label: string; state: CardRenderingOverrides }> = [];
  const battle = card.types.includes("Battle");
  const defense = startingDefense === undefined ? undefined : Number(startingDefense);
  if (battle) {
    if (defense !== undefined && Number.isFinite(defense)) {
      presets.push(
        {
          label: `Starting defense (${defense})`,
          state: { zoneId: "battlefield", counters: { ...value.counters, Defense: defense } },
        },
        {
          label: `Damaged defense (${Math.max(0, defense - 1)})`,
          state: {
            zoneId: "battlefield",
            counters: { ...value.counters, Defense: Math.max(0, defense - 1) },
          },
        },
      );
    }
    presets.push(
      {
        label: "Zero defense / no cast permission",
        state: { zoneId: "battlefield", counters: { ...value.counters, Defense: 0 } },
      },
      {
        label: "Battle in hand",
        state: { zoneId: "hand", counters: { ...value.counters, Defense: 0 } },
      },
      {
        label: "Battle zone unknown",
        state: { zoneId: "unknown", counters: { ...value.counters, Defense: 0 } },
      },
    );
  }
  if (card.subtypes.includes("Room")) {
    presets.push(
      { label: "Room in hand", state: { zoneId: "hand", unlockedDoors: undefined } },
      { label: "Doors unknown", state: { unlockedDoors: undefined } },
      { label: "Both locked", state: { zoneId: "battlefield", unlockedDoors: [] } },
      { label: "Left unlocked", state: { zoneId: "battlefield", unlockedDoors: ["left"] } },
      { label: "Right unlocked", state: { zoneId: "battlefield", unlockedDoors: ["right"] } },
      {
        label: "Both unlocked",
        state: { zoneId: "battlefield", unlockedDoors: ["left", "right"] },
      },
    );
  }
  if (/^Level up\b/m.test(card.text)) {
    for (const level of [0, 1, 2, 3, 4, 6, 7, 8])
      presets.push({
        label: `Level ${level}`,
        state: { zoneId: "battlefield", counters: { ...value.counters, Level: level } },
      });
  }
  if (card.subtypes.includes("Case"))
    presets.push(
      { label: "Solved state unknown", state: { isSolved: undefined } },
      { label: "Unsolved", state: { isSolved: false } },
      { label: "Solved", state: { isSolved: true } },
    );
  if (/\bSuspend\b/i.test(card.text))
    presets.push(
      { label: "Suspend state unknown", state: { isSuspended: undefined } },
      { label: "In hand", state: { zoneId: "hand", isSuspended: false, counters: { Time: 0 } } },
      {
        label: "Suspended / 3 time",
        state: { zoneId: "exile", isSuspended: true, counters: { Time: 3 } },
      },
      {
        label: "Suspended / 1 time",
        state: { zoneId: "exile", isSuspended: true, counters: { Time: 1 } },
      },
      {
        label: "Exile / zero time",
        state: { zoneId: "exile", isSuspended: false, counters: { Time: 0 } },
      },
      {
        label: "Exile / not suspended",
        state: { zoneId: "exile", isSuspended: false, counters: { Time: 2 } },
      },
    );
  if (layout === "adventure")
    presets.push(
      { label: "Adventure state unknown", state: { isOnAdventure: undefined } },
      { label: "Adventure in hand", state: { zoneId: "hand", isOnAdventure: false } },
      { label: "On an Adventure", state: { zoneId: "exile", isOnAdventure: true } },
      { label: "Ordinary exile", state: { zoneId: "exile", isOnAdventure: false } },
    );
  const prototype = printedPrototype(card.text);
  if (prototype) {
    const normalCharacteristics: CardRenderingOverrides = {
      isPrototyped: false,
      power: card.basePower === undefined ? card.power : String(card.basePower),
      toughness: card.baseToughness === undefined ? card.toughness : String(card.baseToughness),
      effectiveManaCost: undefined,
      color: "",
    };
    const prototypeCharacteristics: CardRenderingOverrides = {
      isPrototyped: true,
      power: prototype.power,
      toughness: prototype.toughness,
      effectiveManaCost: prototype.manaCost,
      color: [...new Set(prototype.manaCost.match(/[WUBRG]/g) ?? [])].join(""),
    };
    presets.push(
      { label: "Prototype state unknown", state: { isPrototyped: undefined } },
      {
        label: "Normal characteristics",
        state: {
          zoneId: "battlefield",
          ...normalCharacteristics,
        },
      },
      {
        label: "Prototyped characteristics",
        state: {
          zoneId: "battlefield",
          ...prototypeCharacteristics,
        },
      },
      {
        label: "Prototype choices in hand",
        state: {
          zoneId: "hand",
          ...normalCharacteristics,
        },
      },
      {
        label: "Prototyped spell on stack",
        state: {
          zoneId: "stack",
          ...prototypeCharacteristics,
        },
      },
    );
  }
  if (!presets.length) return null;
  return (
    <details className="rounded-md border border-border/70 px-3 py-2" open>
      <summary className="cursor-pointer text-xs font-medium">Mechanic state boundaries</summary>
      <p className="my-2 text-xs text-muted-foreground">
        Local examples only. Level counters do not calculate P/T; edit engine P/T separately. Use
        the action-count control to show owned mechanic action examples.
      </p>
      {battle && (
        <p className="mb-2 text-xs text-muted-foreground">
          The shield shows current defense on the battlefield and printed starting defense in hand.
          Zero only removes the local counter; it does not resolve a defeat trigger or grant a cast
          action. Protector is not exposed by the engine snapshot.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {presets.map(({ label, state }) => {
          const selected = Object.entries(state).every(
            ([key, expected]) =>
              JSON.stringify(value[key as keyof CardRenderingOverrides]) ===
              JSON.stringify(expected),
          );
          return (
            <Button
              key={label}
              variant="outline"
              size="sm"
              aria-pressed={selected}
              className={cn(selected && DEV_CONTROL_ACTIVE)}
              onClick={() => onChange({ ...value, ...state })}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </details>
  );
}
