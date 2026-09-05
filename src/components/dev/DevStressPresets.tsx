import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_DEV_CARD_OVERRIDES,
  DEFAULT_DEV_PLAYER_OVERRIDES,
  useGameDevStore,
  type DevCardOverrides,
  type DevPlayerOverrides,
} from "@/stores/useGameDevStore";

import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";

const LONG_KEYWORDS = [
  "Flying",
  "First strike",
  "Double strike",
  "Trample",
  "Vigilance",
  "Haste",
  "Reach",
  "Lifelink",
  "Deathtouch",
  "Menace",
  "Defender",
  "Hexproof",
  "Indestructible",
  "Ward:{2}",
  "Protection",
  "Horsemanship",
  "Cycling:{1}",
  "Equip:{2}",
  "Kicker:{R}",
  "Flashback:{2}{R}",
] as const;

const BADGE_OVERFLOW: DevCardOverrides = {
  ...DEFAULT_DEV_CARD_OVERRIDES,
  forceExerted: true,
  forceBestowed: true,
  forceCopy: true,
  forceToken: true,
  forceFoil: true,
  forcePlayable: true,
  forceSelected: true,
  p1p1: 7,
  loyalty: 12,
  charge: 9,
  damage: 5,
};

const COUNTER_OVERFLOW: DevCardOverrides = {
  ...DEFAULT_DEV_CARD_OVERRIDES,
  p1p1: 999,
  m1m1: 999,
  loyalty: 999,
  charge: 999,
  quest: 999,
  study: 999,
  lore: 999,
  age: 999,
  time: 999,
  fade: 999,
  level: 999,
  storage: 999,
  mining: 999,
  brick: 999,
  depletion: 999,
  page: 999,
  damage: 999,
};

const COMBAT_STATE: DevCardOverrides = {
  ...DEFAULT_DEV_CARD_OVERRIDES,
  forceTapped: true,
  forceSummoningSick: true,
  forceAttacking: true,
  forcePlayable: true,
  forceSelected: true,
  p1p1: 3,
  damage: 4,
};

const PLAYER_HUD_OVERFLOW: DevPlayerOverrides = {
  ...DEFAULT_DEV_PLAYER_OVERRIDES,
  forceMonarch: true,
  forceInitiative: true,
  forceCityBlessing: true,
  forceEnduringStory: true,
  forceBot: true,
  forceNoAvatar: true,
  forceActiveTurn: true,
  forcePriority: true,
  forceTargetable: true,
  forceSelectedTarget: true,
  forceFlashing: true,
  forceDisconnected: true,
  forceInCombat: true,
  forceCombatLethal: true,
  poison: 99,
  energy: 99,
  radiation: 99,
  experience: 99,
  ticket: 99,
  ringLevel: 4,
  speed: 4,
  cmdDamage: 99,
  incomingDamage: 99,
  manaWhite: 1,
  manaBlue: 2,
  manaBlack: 3,
  manaRed: 4,
  manaGreen: 5,
  manaColorless: 6,
  life: 123,
  handCount: 27,
};

export function DevStressPresets() {
  const applyCardPreset = (cardOverrides: DevCardOverrides, keywords: readonly string[] = []) =>
    useGameDevStore.setState({
      debugCardEnabled: true,
      cardOverrides,
      debugBattlefieldKeywords: [...keywords],
    });

  return (
    <section className={DEV_SECTION}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={DEV_SECTION_HEADING}>Stress scenarios</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Deterministic high-pressure states for the current staged card and player HUD.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() =>
            useGameDevStore.setState({
              cardOverrides: DEFAULT_DEV_CARD_OVERRIDES,
              playerOverrides: DEFAULT_DEV_PLAYER_OVERRIDES,
              debugBattlefieldKeywords: [],
            })
          }
        >
          <RotateCcw />
          Clear
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <PresetButton
          label="All badges"
          description="Foil, status, interaction rings, counters, and damage"
          onClick={() => applyCardPreset(BADGE_OVERFLOW)}
        />
        <PresetButton
          label="Long keyword stack"
          description="Twenty keyword chips with mana-bearing reminder labels"
          onClick={() => applyCardPreset(DEFAULT_DEV_CARD_OVERRIDES, LONG_KEYWORDS)}
        />
        <PresetButton
          label="Counter overflow"
          description="Every supported counter at three digits"
          onClick={() => applyCardPreset(COUNTER_OVERFLOW)}
        />
        <PresetButton
          label="Combat state"
          description="Tapped, attacking, selected, playable, damaged, and pumped"
          onClick={() => applyCardPreset(COMBAT_STATE)}
        />
        <PresetButton
          label="Player HUD overflow"
          description="Every game badge and numeric player value"
          onClick={() => useGameDevStore.setState({ playerOverrides: PLAYER_HUD_OVERFLOW })}
        />
      </div>
    </section>
  );
}

function PresetButton({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="min-h-16 rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="block text-xs font-medium">{label}</span>
      <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
