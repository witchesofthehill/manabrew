import { useMemo, useState } from "react";
import type { CardDto } from "@/protocol/game";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { BoardCanvas } from "@/pixi/BoardCanvas";
import type { PhaseStripState } from "@/pixi/PhaseStripLayer";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useCardPreview } from "@/hooks/useCardPreview";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { Button } from "@/components/ui/button";

const PLAYER_ID = "dev-playground";

interface CardSpec {
  name: string;
  color: string;
  types: string[];
  power?: string;
  toughness?: string;
  subtypes?: string[];
  supertypes?: string[];
}

const CREATURES: CardSpec[] = [
  { name: "Serra Angel", color: "W", types: ["Creature"], power: "4", toughness: "4" },
  { name: "Goblin Guide", color: "R", types: ["Creature"], power: "2", toughness: "2" },
  { name: "Tarmogoyf", color: "G", types: ["Creature"], power: "4", toughness: "5" },
  { name: "Snapcaster Mage", color: "U", types: ["Creature"], power: "2", toughness: "1" },
  { name: "Gravecrawler", color: "B", types: ["Creature"], power: "2", toughness: "1" },
  {
    name: "Wurmcoil Engine",
    color: "",
    types: ["Artifact", "Creature"],
    power: "6",
    toughness: "6",
  },
];

const LANDS: CardSpec[] = [
  { name: "Steam Vents", color: "", types: ["Land"] },
  { name: "Forest", color: "", types: ["Land"], supertypes: ["Basic"], subtypes: ["Forest"] },
];

let seq = 0;

function makeCard(spec: CardSpec): CardDto {
  seq += 1;
  return {
    ...GAME_CARD_DEFAULTS,
    id: `pg-${seq}`,
    identity: { name: spec.name, setCode: "", cardNumber: "", isToken: false },
    color: spec.color,
    manaCost: "",
    cmc: 0,
    types: spec.types,
    subtypes: spec.subtypes ?? [],
    supertypes: spec.supertypes ?? [],
    power: spec.power ?? null,
    toughness: spec.toughness ?? null,
    basePower: spec.power != null ? parseInt(spec.power, 10) : undefined,
    baseToughness: spec.toughness != null ? parseInt(spec.toughness, 10) : undefined,
    text: "Dev playground card.",
    controllerId: PLAYER_ID,
    ownerId: PLAYER_ID,
    zoneId: "battlefield",
    keywords: [],
  };
}

const PHASE_STRIP_STUB: PhaseStripState = {
  currentStep: "Main",
  isActiveTurn: true,
  activePlayerId: PLAYER_ID,
  myPlayerId: PLAYER_ID,
  selfEnabledPhases: new Set(),
  opponentEnabledPhases: new Map(),
  opponents: [],
  isInteractive: false,
};

export function BoardPlayground() {
  const [cards, setCards] = useState<CardDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const triggerEtbGlow = useGameDevStore((s) => s.triggerEtbGlow);
  const preview = useCardPreview([cards]);

  const update = (id: string | null, fn: (c: CardDto) => CardDto) => {
    if (!id) return;
    setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  };

  const targetId = selectedId ?? cards[cards.length - 1]?.id ?? null;

  const addCreature = () =>
    setCards((cs) => [...cs, makeCard(CREATURES[cs.length % CREATURES.length]!)]);
  const addLand = () => setCards((cs) => [...cs, makeCard(LANDS[cs.length % LANDS.length]!)]);
  const removeTarget = () => {
    if (!targetId) return;
    setCards((cs) => cs.filter((c) => c.id !== targetId));
    setSelectedId(null);
  };
  const tap = () => update(targetId, (c) => ({ ...c, tapped: !c.tapped }));
  const damage = () => update(targetId, (c) => ({ ...c, damage: (c.damage ?? 0) + 1 }));
  const pump = () =>
    update(targetId, (c) => ({
      ...c,
      power: String((c.power ? parseInt(c.power, 10) : 0) + 1),
      toughness: String((c.toughness ? parseInt(c.toughness, 10) : 0) + 1),
      counters: { ...(c.counters ?? {}), P1P1: (c.counters?.P1P1 ?? 0) + 1 },
    }));
  const attack = () => update(targetId, (c) => ({ ...c, isAttacking: !c.isAttacking }));

  const regions = useMemo(
    () => [{ playerId: PLAYER_ID, isLocal: true, state: { cards } }],
    [cards],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={addCreature}>
          + Creature
        </Button>
        <Button size="sm" variant="outline" onClick={addLand}>
          + Land
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={tap} disabled={!targetId}>
          Tap
        </Button>
        <Button size="sm" variant="outline" onClick={damage} disabled={!targetId}>
          Damage
        </Button>
        <Button size="sm" variant="outline" onClick={pump} disabled={!targetId}>
          +1/+1
        </Button>
        <Button size="sm" variant="outline" onClick={attack} disabled={!targetId}>
          Attack
        </Button>
        <Button size="sm" variant="outline" onClick={removeTarget} disabled={!targetId}>
          Remove
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={triggerEtbGlow}>
          Re-stomp all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCards([])}
          disabled={cards.length === 0}
        >
          Clear
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a card to select it (the action buttons target the selection, else the last card).
        Card style follows the Realistic / Art-forward / Mini-frame toggle above; the In-game
        Animations toggle lives in Settings.
      </p>
      <div className="relative h-[85vh] overflow-hidden rounded-lg border border-border bg-black/40">
        <BoardCanvas
          regions={regions}
          hand={{ cards: [] }}
          arrowSpecs={[]}
          phaseStrip={PHASE_STRIP_STUB}
          callbacks={{
            onClickCard: (c) => setSelectedId((id) => (id === c.id ? null : c.id)),
            onClickAnyCard: (c) => setSelectedId((id) => (id === c.id ? null : c.id)),
            onHoverCard: (card, bounds) => {
              if (card && bounds) {
                const rect = new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
                preview.handleMouseEnter(card, undefined, {
                  useAnchor: true,
                  anchorOverride: rect,
                });
              } else {
                preview.dismiss();
              }
            },
            onDismissHoverPreview: preview.dismiss,
          }}
        />
      </div>
      <HoverCardPreview preview={preview} />
    </div>
  );
}
