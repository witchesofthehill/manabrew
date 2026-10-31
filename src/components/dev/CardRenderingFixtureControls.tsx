import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import {
  CARD_RENDERING_FIXTURES,
  CARD_RENDERING_WIDTHS,
} from "@/components/dev/cardRendering.data";
import type { ScryfallLanguage } from "@/i18n/locales";

interface CardRenderingFixtureControlsProps {
  fixtureId: string;
  onSelectFixture: (id: string) => void;
  flippable: boolean;
  face: 0 | 1;
  onFlip: () => void;
  live: boolean;
  onLiveChange: (value: boolean) => void;
  granted: boolean;
  onGrantedChange: (value: boolean) => void;
  actionCount: number;
  onActionCountChange: (value: number) => void;
  width: number;
  onWidthChange: (value: number) => void;
  locale: ScryfallLanguage;
  onLocaleChange: (value: ScryfallLanguage) => void;
  historicalWording?: "original" | "oracle";
  onWordingChange: (value: "original" | "oracle") => void;
}

export function CardRenderingFixtureControls({
  fixtureId,
  onSelectFixture,
  flippable,
  face,
  onFlip,
  live,
  onLiveChange,
  granted,
  onGrantedChange,
  actionCount,
  onActionCountChange,
  width,
  onWidthChange,
  locale,
  onLocaleChange,
  historicalWording,
  onWordingChange,
}: CardRenderingFixtureControlsProps) {
  const fixtureIndex = CARD_RENDERING_FIXTURES.findIndex((item) => item.id === fixtureId);
  const stepFixture = (direction: -1 | 1) => {
    const index =
      (fixtureIndex + direction + CARD_RENDERING_FIXTURES.length) % CARD_RENDERING_FIXTURES.length;
    onSelectFixture(CARD_RENDERING_FIXTURES[index]!.id);
  };
  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4"
      aria-label="Fixture controls"
    >
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous rendering fixture"
          onClick={() => stepFixture(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <AppSelect
          aria-label="Rendering fixture"
          value={fixtureId}
          onValueChange={onSelectFixture}
          className="min-w-0 sm:min-w-64"
        >
          {CARD_RENDERING_FIXTURES.map((item) => (
            <AppSelectOption key={item.id} value={item.id}>
              {item.label}
            </AppSelectOption>
          ))}
        </AppSelect>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next rendering fixture"
          onClick={() => stepFixture(1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <Button variant="outline" disabled={!flippable} onClick={onFlip}>
        Face: {face === 0 ? "front" : "back"}
      </Button>
      {historicalWording && (
        <AppSelect
          aria-label="Historical printed wording"
          value={historicalWording}
          onValueChange={(value) => onWordingChange(value as "original" | "oracle")}
        >
          <AppSelectOption value="original">Printed previews: original wording</AppSelectOption>
          <AppSelectOption value="oracle">Printed previews: Oracle wording</AppSelectOption>
        </AppSelect>
      )}
      <label className="flex min-h-8 touch:min-h-11 items-center gap-2 text-ui-label">
        <input
          type="checkbox"
          checked={live}
          onChange={(event) => onLiveChange(event.target.checked)}
        />
        Live stats / counters
      </label>
      <label className="flex min-h-8 touch:min-h-11 items-center gap-2 text-ui-label">
        <input
          type="checkbox"
          checked={granted}
          onChange={(event) => onGrantedChange(event.target.checked)}
        />
        Granted abilities
      </label>
      <AppSelect
        aria-label="Action count"
        value={String(actionCount)}
        onValueChange={(value) => onActionCountChange(Number(value))}
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
        onValueChange={(value) => onWidthChange(Number(value))}
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
        onValueChange={(value) => onLocaleChange(value as ScryfallLanguage)}
      >
        {["en", "it", "ja", "de", "fr"].map((value) => (
          <AppSelectOption key={value} value={value}>
            {value}
          </AppSelectOption>
        ))}
      </AppSelect>
    </section>
  );
}
