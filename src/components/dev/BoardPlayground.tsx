import { useMemo, useRef, useState } from "react";
import type { ClientCardDto } from "@/stores/gameStore.types";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import { BoardCanvas } from "@/pixi/BoardCanvas";
import { BoardOverlayCanvas, type BoardOverlayPreviewSpec } from "@/pixi/BoardOverlayCanvas";
import type { StackSpec } from "@/pixi/stack/stack.types";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { PhaseStripState } from "@/pixi/PhaseStripLayer";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { useCardPreview } from "@/hooks/useCardPreview";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { HandActionOption } from "@/stores/useGameUIStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { resolveCardFaces } from "@/lib/cardFaces";
import { parsePrintedCardRailMetadata } from "@/components/game/cardRailState";
import { Input } from "@/components/ui/input";
import { PREVIEW_SCENARIOS } from "./devPreviewScenarios";

const PLAYER_ID = "dev-playground";
const DEV_MANA_ACTION_ID = "dev-mana";

interface CardSpec {
  name: string;
  color: string;
  types: string[];
  manaCost?: string;
  text?: string;
  keywords?: string[];
  power?: string;
  toughness?: string;
  subtypes?: string[];
  supertypes?: string[];
}

const CREATURES: CardSpec[] = [
  {
    name: "Serra Angel",
    color: "W",
    manaCost: "{3}{W}{W}",
    types: ["Creature"],
    subtypes: ["Angel"],
    power: "4",
    toughness: "4",
    text: [
      "Flying, vigilance",
      "Other creatures you control get +1/+1.",
      "{T}: Add {G}.",
      "{2}{G}: Put a +1/+1 counter on this creature.",
      "{4}: Draw a card.",
    ].join("\n"),
    keywords: ["Flying", "Vigilance"],
  },
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

const PREVIEW_VIEWPORTS = [
  { label: "Desktop", width: undefined, height: "85dvh" },
  { label: "Phone portrait", width: 390, height: 640 },
  { label: "Phone landscape", width: 740, height: 340 },
] as const;

let seq = 0;

function makeCard(spec: CardSpec): ClientCardDto {
  seq += 1;
  return {
    ...GAME_CARD_DEFAULTS,
    id: `pg-${seq}`,
    identity: { name: spec.name, setCode: "", cardNumber: "", isToken: false },
    color: spec.color,
    manaCost: spec.manaCost ?? "",
    cmc: 0,
    types: spec.types,
    subtypes: spec.subtypes ?? [],
    supertypes: spec.supertypes ?? [],
    power: spec.power ?? null,
    toughness: spec.toughness ?? null,
    basePower: spec.power != null ? parseInt(spec.power, 10) : undefined,
    baseToughness: spec.toughness != null ? parseInt(spec.toughness, 10) : undefined,
    text: spec.text ?? "Dev playground card.",
    controllerId: PLAYER_ID,
    ownerId: PLAYER_ID,
    zoneId: "battlefield",
    keywords: spec.keywords ?? [],
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
const EMPTY_STACK: StackSpec = {
  cards: [],
  flash: null,
  showPreStackFlash: false,
  collapsed: true,
};

export function BoardPlayground() {
  const [cards, setCards] = useState<ClientCardDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const loadGeneration = useRef(0);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [customName, setCustomName] = useState("");
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState("");
  const [actionCount, setActionCount] = useState(0);
  const [lastAction, setLastAction] = useState("");
  const [viewportIndex, setViewportIndex] = useState(0);
  const triggerEtbGlow = useGameDevStore((s) => s.triggerEtbGlow);
  const preview = useCardPreview();
  const compactBoard = useIsMobileGame();
  const previewStyle = usePreferencesStore((s) => s.inGameCardPreviewStyle);
  const setPreviewStyle = usePreferencesStore((s) => s.setInGameCardPreviewStyle);
  const previewCard = cards.find((card) => card.id === preview.hoveredCard?.id) ?? null;
  const viewport = PREVIEW_VIEWPORTS[viewportIndex]!;

  const openScenario = async (index: number, nameOverride?: string) => {
    const generation = ++loadGeneration.current;
    const scenario = PREVIEW_SCENARIOS[index]!;
    const name = nameOverride ?? scenario.name;
    setScenarioIndex(index);
    setScenarioError("");
    setLoadingScenario(true);
    setLastAction("");
    try {
      let card: ClientCardDto;
      if (!name) {
        card = {
          ...GAME_CARD_DEFAULTS,
          id: `pg-${++seq}`,
          ownerId: PLAYER_ID,
          controllerId: PLAYER_ID,
          zoneId: "battlefield",
          isFaceDown: true,
          types: ["Creature"],
          power: "2",
          toughness: "2",
        };
      } else {
        const { info } = await useScryfallStore.getState().getCard({ name });
        if (generation !== loadGeneration.current) return;
        const faces = resolveCardFaces(info);
        const back = nameOverride == null && !!scenario.back && faces.isFlippable;
        const face = info.card_faces?.[back ? 1 : 0];
        card = scryfallToSampleGameCard(
          face ? { ...info, ...face, type_line: face.type_line ?? info.type_line } : info,
          {
            id: `pg-${++seq}`,
            identity: {
              name: info.name,
              setCode: info.set,
              cardNumber: info.collector_number,
              isToken: info.layout.includes("token"),
            },
            isDoubleFaced: faces.isFlippable,
            isTransformed: back,
            ownerId: PLAYER_ID,
            controllerId: PLAYER_ID,
          },
        );
        const loyalty = face?.loyalty ?? info.loyalty;
        const defense = face?.defense ?? info.defense;
        if (loyalty) card.counters = { Loyalty: Number(loyalty) };
        if (defense) card.counters = { Defense: Number(defense) };
        const rail = parsePrintedCardRailMetadata(card);
        if (rail?.kind === "saga") {
          card.sagaChapters = rail.sagaChapters;
          card.counters = { Lore: 1 };
        } else if (rail?.kind === "class") {
          card.classLevels = rail.classLevels;
          card.classLevel = 1;
        }
      }
      if (generation !== loadGeneration.current) return;
      preview.dismiss();
      setCards([card]);
      setSelectedId(card.id);
      boardRef.current?.scrollIntoView({ block: "nearest" });
      preview.showSticky(card);
    } catch (error) {
      if (generation === loadGeneration.current) {
        setScenarioError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === loadGeneration.current) setLoadingScenario(false);
    }
  };

  const update = (id: string | null, fn: (c: ClientCardDto) => ClientCardDto) => {
    if (!id) return;
    setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  };

  const targetId = selectedId ?? cards[cards.length - 1]?.id ?? null;

  const addCreature = () =>
    setCards((cs) => [...cs, makeCard(CREATURES[cs.length % CREATURES.length]!)]);
  const addLand = () => setCards((cs) => [...cs, makeCard(LANDS[cs.length % LANDS.length]!)]);
  const removeTarget = () => {
    if (!targetId) return;
    if (preview.hoveredCard?.id === targetId) preview.dismiss();
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
  const showSelectedPreview = () => {
    const card = cards.find((candidate) => candidate.id === targetId);
    if (card) preview.showSticky(card, window.innerWidth / 2, window.innerHeight / 2);
  };

  const previewActions = useMemo<HandActionOption[]>(() => {
    if (!previewCard) return [];
    return Array.from({ length: actionCount }, (_, index) => ({
      kind: "ability",
      cardId: previewCard.id,
      actionId: index === 0 ? DEV_MANA_ACTION_ID : `dev-action-${index}`,
      label: index === 0 ? "Add {G}." : `Preview test action ${index + 1}.`,
      cost: index === 0 ? "{T}" : `{${index + 1}}`,
      isManaAbility: index === 0,
      abilityIndex: index,
    }));
  }, [previewCard, actionCount]);

  const rulesPreview: BoardOverlayPreviewSpec | null =
    previewStyle === "rules" && previewCard && preview.phase !== "hidden"
      ? {
          card: previewCard,
          phase: preview.phase === "closing" ? "closing" : "open",
          sticky: preview.isSticky,
          showBackFace: preview.showBackFace,
          suppressed: false,
          actions: previewActions,
          mousePos: preview.mousePos,
          anchorRect: preview.anchorRect,
        }
      : null;

  const handlePreviewAction = (action: HandActionOption) => {
    setLastAction(`Selected ${action.label} (${action.actionId})`);
    if (action.actionId === DEV_MANA_ACTION_ID) {
      update(action.cardId, (card) => ({ ...card, tapped: true }));
      return;
    }
    update(action.cardId, (card) => ({
      ...card,
      power: String((card.power ? parseInt(card.power, 10) : 0) + 1),
      toughness: String((card.toughness ? parseInt(card.toughness, 10) : 0) + 1),
      counters: { ...(card.counters ?? {}), P1P1: (card.counters?.P1P1 ?? 0) + 1 },
    }));
  };

  const regions = useMemo(
    () => [{ playerId: PLAYER_ID, isLocal: true, state: { cards } }],
    [cards],
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg bg-muted p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium" htmlFor="preview-scenario">
            Preview scenario
          </label>
          <select
            id="preview-scenario"
            className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm"
            value={scenarioIndex}
            onChange={(event) => void openScenario(Number(event.target.value))}
          >
            {PREVIEW_SCENARIOS.map((scenario, index) => (
              <option key={scenario.label} value={index}>
                {scenario.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={loadingScenario}
            onClick={() =>
              void openScenario(
                (scenarioIndex + PREVIEW_SCENARIOS.length - 1) % PREVIEW_SCENARIOS.length,
              )
            }
          >
            Previous
          </Button>
          <Button
            size="sm"
            disabled={loadingScenario}
            onClick={() => void openScenario(scenarioIndex)}
          >
            {loadingScenario ? "Loading card…" : "Open scenario"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loadingScenario}
            onClick={() => void openScenario((scenarioIndex + 1) % PREVIEW_SCENARIOS.length)}
          >
            Next
          </Button>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (customName.trim()) void openScenario(scenarioIndex, customName.trim());
          }}
        >
          <Input
            aria-label="Custom preview card name"
            placeholder="Any card name"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            className="max-w-72"
          />
          <Button
            size="sm"
            variant="outline"
            type="submit"
            disabled={loadingScenario || !customName.trim()}
          >
            Open card
          </Button>
          <label className="flex items-center gap-2 text-sm">
            Test actions
            <select
              aria-label="Test action count"
              className="h-9 rounded-md border border-input bg-background px-2"
              value={actionCount}
              onChange={(event) => setActionCount(Number(event.target.value))}
            >
              {[0, 2, 9].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            Viewport
            <select
              aria-label="Preview viewport"
              className="h-9 rounded-md border border-input bg-background px-2"
              value={viewportIndex}
              onChange={(event) => setViewportIndex(Number(event.target.value))}
            >
              {PREVIEW_VIEWPORTS.map((size, index) => (
                <option key={size.label} value={index}>
                  {size.label}
                </option>
              ))}
            </select>
          </label>
        </form>
        <p className="text-xs text-muted-foreground">
          Each scenario opens a real Scryfall card. Flip changes the displayed face; rotate switches
          portrait and landscape without rotating rules text. Test actions are local playground
          controls.
        </p>
        {scenarioError && (
          <p role="alert" className="text-sm text-destructive">
            {scenarioError}
          </p>
        )}
        {lastAction && (
          <p role="status" className="text-xs text-muted-foreground">
            {lastAction}
          </p>
        )}
      </div>
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
          onClick={() => {
            preview.dismiss();
            setSelectedId(null);
            setCards([]);
          }}
          disabled={cards.length === 0}
        >
          Clear
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          size="sm"
          variant={previewStyle === "printed" ? "default" : "outline"}
          onClick={() => setPreviewStyle("printed")}
        >
          Printed preview
        </Button>
        <Button
          size="sm"
          variant={previewStyle === "rules" ? "default" : "outline"}
          onClick={() => setPreviewStyle("rules")}
        >
          Rules preview
        </Button>
        <Button size="sm" variant="outline" onClick={showSelectedPreview} disabled={!targetId}>
          Open selected preview
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a card to select it (the action buttons target the selection, else the last card).
        Card style follows the Realistic / Art-forward / Mini-frame toggle above; the In-game
        Animations toggle lives in Settings.
      </p>
      <div
        ref={boardRef}
        style={{ width: viewport.width, height: viewport.height }}
        className="relative max-w-full overflow-hidden rounded-lg border border-border bg-background"
      >
        <BoardCanvas
          regions={regions}
          hand={{ cards: [] }}
          arrowSpecs={[]}
          phaseStrip={PHASE_STRIP_STUB}
          compact={compactBoard}
          sceneRef={sceneRef}
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
                preview.handleMouseLeave();
              }
            },
            onDismissHoverPreview: preview.dismiss,
          }}
        />
        <div className="pointer-events-none absolute inset-0 z-40">
          <BoardOverlayCanvas
            onOpenStack={() => undefined}
            sceneRef={sceneRef}
            stackSpec={EMPTY_STACK}
            onTargetSpell={() => undefined}
            onHoverStack={() => undefined}
            onToggleStack={() => undefined}
            previewSpec={rulesPreview}
            onPreviewPointerEnter={preview.onMouseEnterPreview}
            onPreviewPointerLeave={preview.onMouseLeavePreview}
            onSelectPreviewAction={handlePreviewAction}
            onDismissPreview={preview.dismiss}
            onFlipPreview={preview.flipCard}
          />
        </div>
      </div>
      {previewStyle === "printed" && (
        <HoverCardPreview
          preview={{ ...preview, hoveredCard: previewCard }}
          actions={previewActions}
          onSelectAction={handlePreviewAction}
        />
      )}
    </div>
  );
}
