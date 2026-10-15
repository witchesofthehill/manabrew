import { useEffect, useMemo, useState } from "react";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";
import { useSearchParams } from "react-router-dom";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { CardRenderingComparison } from "@/components/dev/CardRenderingComparison";
import { CardRenderingProfile } from "@/components/dev/CardRenderingProfile";
import {
  CARD_RENDERING_FIXTURES,
  CARD_RENDERING_WIDTHS,
} from "@/components/dev/cardRendering.data";
import { useCardRenderingFixture } from "@/components/dev/useCardRenderingFixture";
import { parsePrintedCardRailMetadata } from "@/components/game/cardRailState";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { cardFaceImageUris } from "@/lib/cardImage";
import { resolveCardFaces } from "@/lib/cardFaces";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { ScryfallLanguage } from "@/i18n/locales";

export default function CardRenderingLab() {
  const [params, setParams] = useSearchParams();
  const fixture =
    CARD_RENDERING_FIXTURES.find((item) => item.id === params.get("fixture")) ??
    CARD_RENDERING_FIXTURES[0]!;
  const [face, setFace] = useState<0 | 1>(0);
  const foil = useCardFinishPreview((state) => state.foilAll);
  const [live, setLive] = useState(false);
  const [granted, setGranted] = useState(false);
  const [actionCount, setActionCount] = useState(0);
  const [width, setWidth] = useState(1280);
  const [revision, setRevision] = useState(0);
  const [lastAction, setLastAction] = useState("");
  const [initialLocale] = useState(() => useScryfallStore.getState().locale);
  const locale = useScryfallStore((state) => state.locale);
  useEffect(() => () => useScryfallStore.getState().setLocale(initialLocale), [initialLocale]);
  useEffect(() => {
    useScryfallStore.getState().setLocale(fixture.locale ?? "en");
  }, [fixture]);
  const result = useCardRenderingFixture(fixture);
  const entry = result?.entry;
  const flippable = resolveCardFaces(entry?.info).isFlippable;
  const effectiveFace = flippable ? face : 0;
  const card = useMemo(() => {
    if (!entry) return undefined;
    const next = scryfallToSampleGameCard(entry.info, { foil, isTransformed: effectiveFace === 1 });
    const rail = parsePrintedCardRailMetadata(next);
    if (rail?.kind === "saga") {
      next.sagaChapters = rail.sagaChapters;
      next.counters = { Lore: live ? 3 : 1 };
    }
    if (rail?.kind === "class") {
      next.classLevels = rail.classLevels;
      next.classLevel = live ? 3 : 1;
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
    return next;
  }, [entry, foil, effectiveFace, live, granted]);
  const deckCard = useMemo(() => (entry ? scryfallToDeckCard(entry.info) : undefined), [entry]);
  const actions = useMemo<HandActionOption[]>(
    () =>
      card
        ? Array.from({ length: actionCount }, (_, index) => ({
            kind: "ability",
            cardId: card.id,
            actionId: `gallery-action-${index}`,
            label: `Draw a card. Action ${index + 1}.`,
            cost: `{${index + 1}}`,
            abilityIndex: index,
          }))
        : [],
    [card, actionCount],
  );
  const request = useMemo(
    () => ({ card, deckCard, faceIndex: effectiveFace }),
    [card, deckCard, effectiveFace],
  );
  const selectFixture = (id: string) => {
    setFace(0);
    setLastAction("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("fixture", id);
      return next;
    });
  };
  return (
    <section
      className="space-y-5 p-3"
      data-testid="card-rendering-gallery"
      data-fixture={fixture.id}
    >
      <section
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4"
        aria-label="Fixture controls"
      >
        <AppSelect
          aria-label="Rendering fixture"
          value={fixture.id}
          onValueChange={selectFixture}
          className="min-w-64"
        >
          {CARD_RENDERING_FIXTURES.map((item) => (
            <AppSelectOption key={item.id} value={item.id}>
              {item.label}
            </AppSelectOption>
          ))}
        </AppSelect>
        <Button
          variant="outline"
          disabled={!flippable}
          onClick={() => setFace((value) => (value === 0 ? 1 : 0))}
        >
          Face: {effectiveFace === 0 ? "front" : "back"}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          Live stats / counters
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={granted}
            onChange={(event) => setGranted(event.target.checked)}
          />
          Granted abilities
        </label>
        <AppSelect
          aria-label="Action count"
          value={String(actionCount)}
          onValueChange={(value) => setActionCount(Number(value))}
        >
          {[0, 2, 12].map((count) => (
            <AppSelectOption key={count} value={String(count)}>
              {count} actions
            </AppSelectOption>
          ))}
        </AppSelect>
        <AppSelect
          aria-label="Comparison viewport width"
          value={String(width)}
          onValueChange={(value) => setWidth(Number(value))}
        >
          {CARD_RENDERING_WIDTHS.map((value) => (
            <AppSelectOption key={value} value={String(value)}>
              {value}px viewport
            </AppSelectOption>
          ))}
        </AppSelect>
        <AppSelect
          aria-label="Card language"
          value={locale}
          onValueChange={(value) =>
            useScryfallStore.getState().setLocale(value as ScryfallLanguage)
          }
        >
          {["en", "it", "ja", "de", "fr"].map((value) => (
            <AppSelectOption key={value} value={value}>
              {value}
            </AppSelectOption>
          ))}
        </AppSelect>
      </section>
      <p role="status" className="text-sm text-muted-foreground">
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
              face={effectiveFace}
              imageUrl={
                cardFaceImageUris(entry.info, entry.uris, effectiveFace, entry.imageInfo)?.normal ??
                ""
              }
              actions={actions}
              onFlip={() => setFace((value) => (value === 0 ? 1 : 0))}
              onAction={(action) => setLastAction(`Executed local fixture action: ${action.label}`)}
            />
          </div>
          <CardRenderingProfile
            key={`${fixture.id}-${effectiveFace}-${locale}`}
            request={request}
            onRemount={() => setRevision((value) => value + 1)}
          />
        </>
      )}
    </section>
  );
}
