import { useEffect, useMemo, useState } from "react";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";
import { useSearchParams } from "react-router-dom";
import { CardRenderingFixtureControls } from "@/components/dev/CardRenderingFixtureControls";
import { CardRenderingStateControls } from "@/components/dev/CardRenderingStateControls";
import { CardRenderingComparison } from "@/components/dev/CardRenderingComparison";
import { CardRenderingProfile } from "@/components/dev/CardRenderingProfile";
import { CardGlintAppearanceLab } from "@/components/dev/CardGlintAppearanceLab";
import { CARD_RENDERING_FIXTURES } from "@/components/dev/cardRendering.data";
import {
  applyCardRenderingOverrides,
  type CardRenderingOverrides,
} from "@/components/dev/cardRenderingOverrides";
import { useCardRenderingFixture } from "@/components/dev/useCardRenderingFixture";
import { cardRenderingMechanicActions } from "@/components/dev/cardRenderingMechanics";
import {
  applyDevPreviewMechanicAction,
  devPreviewMechanicActions,
} from "@/components/dev/devPreviewScenarios";
import { stationRulesPresentation } from "@/pixi/cardPreview/rulesCardPreviewPresentation";
import { parsePrintedCardRailMetadata } from "@/components/game/cardRailState";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { cardFaceImageUris } from "@/lib/cardImage";
import { resolveCardFaces } from "@/lib/cardFaces";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { CardCosmetics } from "@/protocol/deck";
import { DEFAULT_CARD_POSE } from "@/lib/cardLighting";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";

export default function CardRenderingLab() {
  const [params, setParams] = useSearchParams();
  const fixture =
    CARD_RENDERING_FIXTURES.find((item) => item.id === params.get("fixture")) ??
    CARD_RENDERING_FIXTURES[0]!;
  const [face, setFace] = useState<0 | 1>(0);
  const [overrides, setOverrides] = useState<CardRenderingOverrides>({});
  const [appearance, setAppearance] = useState<CardInspectAppearance>({});
  const [lighting, setLighting] = useState<CardLightingMode>("pointer");
  const [pose, setPose] = useState<CardPose>(DEFAULT_CARD_POSE);
  const [previousFixture, setPreviousFixture] = useState(fixture.id);
  const [wording, setWording] = useState<"original" | "oracle">("original");
  const historicalPrinting = fixture.lookup?.setCode === "lea" || fixture.lookup?.setCode === "leb";
  const foil = useCardFinishPreview((state) => state.foilAll);
  const [live, setLive] = useState(false);
  const [granted, setGranted] = useState(false);
  const [actionCount, setActionCount] = useState(0);
  const [width, setWidth] = useState(1280);
  const [revision, setRevision] = useState(0);
  const [lastAction, setLastAction] = useState("");
  const [initialLocale] = useState(() => useScryfallStore.getState().locale);
  const locale = useScryfallStore((state) => state.locale);
  if (previousFixture !== fixture.id) {
    setPreviousFixture(fixture.id);
    setFace(0);
    setOverrides({});
    setLastAction("");
  }
  useEffect(() => () => useScryfallStore.getState().setLocale(initialLocale), [initialLocale]);
  useEffect(() => {
    useScryfallStore.getState().setLocale(fixture.locale ?? "en");
  }, [fixture]);
  const result = useCardRenderingFixture(fixture);
  const entry = result?.entry;
  const flippable = resolveCardFaces(entry?.info).isFlippable;
  const effectiveFace = flippable ? face : 0;
  const cosmetics = useMemo<CardCosmetics>(
    () => ({
      rainFog: appearance.rainFog,
      wearAmount: appearance.wear?.amount,
      wearSeed: appearance.wear?.seed,
      cardstock: appearance.cardstock,
      printDots: appearance.printDots,
      finishCoverage: appearance.coverage,
    }),
    [appearance],
  );
  const card = useMemo(() => {
    if (!entry) return undefined;
    const next = scryfallToSampleGameCard(entry.info, {
      foil,
      faceIndex: effectiveFace,
      isTransformed: effectiveFace === 1 && ["transform", "battle"].includes(entry.info.layout),
    });
    next.zone = "battlefield";
    next.cosmetics = cosmetics;
    const rail = parsePrintedCardRailMetadata(next);
    if (rail?.kind === "saga") {
      next.sagaChapters = rail.sagaChapters;
      next.counters = { Lore: live ? 3 : 1 };
    }
    if (rail?.kind === "class") {
      next.classLevels = rail.classLevels;
      next.classLevel = live ? 3 : 1;
    }
    const station = stationRulesPresentation(next.text);
    if (station) {
      next.counters = {
        ...next.counters,
        Charge: live ? Math.max(...station.tiers.map((tier) => tier.threshold)) : 0,
      };
    }
    if (live) {
      if (next.types.includes("Creature")) {
        next.power = "12";
        next.toughness = "14";
        next.counters = { ...next.counters, P1P1: 3 };
        next.damage = 2;
      }
      if (next.types.includes("Planeswalker")) next.counters = { Loyalty: 8 };
      if (next.types.includes("Battle")) next.counters = { Defense: 2 };
    }
    if (granted) {
      next.text +=
        "\nLifelink\n{2}, {T}: Draw a card. This ability was granted by another permanent.";
      next.keywords = [...next.keywords, "Lifelink"];
    }
    return applyCardRenderingOverrides(next, overrides);
  }, [entry, foil, effectiveFace, live, granted, overrides, cosmetics]);
  const deckCard = useMemo(() => {
    if (!entry) return undefined;
    const next = scryfallToDeckCard(entry.info);
    const printedCosmetics =
      historicalPrinting && wording === "original"
        ? { ...cosmetics, wording: "original" as const }
        : cosmetics;
    return { ...next, identity: { ...next.identity, cosmetics: printedCosmetics } };
  }, [entry, cosmetics, historicalPrinting, wording]);
  const actions = useMemo<HandActionOption[]>(() => {
    if (!card) return [];
    const mechanic = entry ? cardRenderingMechanicActions(card, entry.info) : undefined;
    if (mechanic !== undefined) return actionCount > 0 ? mechanic : [];
    return [
      ...devPreviewMechanicActions(card),
      ...Array.from(
        { length: actionCount },
        (_, index): HandActionOption => ({
          kind: "ability",
          cardId: card.id,
          actionId: `gallery-action-${index}`,
          label: `Draw a card. Action ${index + 1}.`,
          cost: `{${index + 1}}`,
          abilityIndex: index,
        }),
      ),
    ];
  }, [card, actionCount, entry]);
  const request = useMemo(
    () => ({ card: historicalPrinting ? undefined : card, deckCard, faceIndex: effectiveFace }),
    [card, deckCard, effectiveFace, historicalPrinting],
  );
  const selectFixture = (id: string) => {
    setFace(0);
    setOverrides({});
    setLastAction("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("fixture", id);
      return next;
    });
  };
  const flipFace = () => {
    setFace((value) => (value === 0 ? 1 : 0));
    setOverrides({});
  };
  const handleAction = (action: HandActionOption) => {
    setLastAction(
      `Selected local fixture action: ${action.label} (${action.actionId ?? action.abilityIndex})`,
    );
    if (!card) return;
    const next = applyDevPreviewMechanicAction(card, action);
    if (next === card) return;
    setOverrides((current) => ({
      ...current,
      isCrewed: next.isCrewed,
      counters: { ...current.counters, ...next.counters },
    }));
  };
  return (
    <section
      className="space-y-5 p-3"
      data-testid="card-rendering-gallery"
      data-fixture={fixture.id}
    >
      <CardRenderingFixtureControls
        fixtureId={fixture.id}
        onSelectFixture={selectFixture}
        flippable={flippable}
        face={effectiveFace}
        onFlip={flipFace}
        live={live}
        onLiveChange={setLive}
        granted={granted}
        onGrantedChange={setGranted}
        actionCount={actionCount}
        onActionCountChange={setActionCount}
        width={width}
        onWidthChange={setWidth}
        locale={locale}
        onLocaleChange={(value) => useScryfallStore.getState().setLocale(value)}
        historicalWording={historicalPrinting ? wording : undefined}
        onWordingChange={setWording}
      />
      <p role="status" className="break-words text-ui-meta text-muted-foreground">
        {lastAction ||
          (entry
            ? `${entry.info.name} · ${entry.info.set.toUpperCase()} #${entry.info.collector_number} · ${entry.info.lang} · ${entry.info.id}`
            : "Loading fixture through the Scryfall store…")}
      </p>
      {result?.error && (
        <p role="alert" className="text-destructive">
          {result.error}
        </p>
      )}
      <CardRenderingStateControls
        card={card}
        layout={entry?.info.layout}
        startingDefense={entry?.info.card_faces?.[0]?.defense ?? entry?.info.defense}
        value={overrides}
        onChange={setOverrides}
        onReset={() => setOverrides({})}
      />
      {entry && card && deckCard && (
        <>
          <div
            className="@container max-w-full"
            style={{ width }}
            data-testid="comparison-viewport"
            data-width={width}
          >
            <CardRenderingComparison
              key={`${fixture.id}-${revision}`}
              card={card}
              deckCard={deckCard}
              historicalPrinting={historicalPrinting}
              face={effectiveFace}
              imageUrl={
                cardFaceImageUris(entry.info, entry.uris, effectiveFace, entry.imageInfo)?.normal ??
                ""
              }
              actions={actions}
              lighting={lighting}
              pose={pose}
              onFlip={flipFace}
              onAction={handleAction}
            />
          </div>
          <CardRenderingProfile
            key={`${fixture.id}-${effectiveFace}-${locale}`}
            request={request}
            onRemount={() => setRevision((value) => value + 1)}
          />
        </>
      )}
      {deckCard && (
        <CardGlintAppearanceLab
          card={deckCard}
          faceIndex={effectiveFace}
          onFlipFace={flipFace}
          appearance={appearance}
          onAppearanceChange={setAppearance}
          lighting={lighting}
          pose={pose}
          onLightingChange={setLighting}
          onPoseChange={setPose}
        />
      )}
    </section>
  );
}
