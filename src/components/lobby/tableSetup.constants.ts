import type { ComponentType } from "react";
import { Boxes, Layers, Swords, Wand2 } from "lucide-react";
import type { GameFormat } from "@/types/server";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export type RoomKind = "match" | "limited";
export type LimitedKind = "draft" | "sealed" | "winston" | "cube";
export interface LimitedKindMeta {
  value: LimitedKind;
  label: string;
  icon: ComponentType<{
    className?: string;
  }>;
  description: string;
  enabled: boolean;
}
export const FORMATS: {
  value: GameFormat;
  label: string;
  description: string;
}[] = [
  {
    value: "Standard",
    get label() {
      return i18n._(msg`Standard`);
    },
    get description() {
      return i18n._(msg`60-card constructed, rotating sets`);
    },
  },
  {
    value: "Pioneer",
    get label() {
      return i18n._(msg`Pioneer`);
    },
    get description() {
      return i18n._(msg`60-card, Return to Ravnica forward`);
    },
  },
  {
    value: "Modern",
    get label() {
      return i18n._(msg`Modern`);
    },
    get description() {
      return i18n._(msg`60-card, 8th Edition forward`);
    },
  },
  {
    value: "Legacy",
    get label() {
      return i18n._(msg`Legacy`);
    },
    get description() {
      return i18n._(msg`60-card, all sets, banned list`);
    },
  },
  {
    value: "Vintage",
    get label() {
      return i18n._(msg`Vintage`);
    },
    get description() {
      return i18n._(msg`60-card, all sets, restricted list`);
    },
  },
  {
    value: "Pauper",
    get label() {
      return i18n._(msg`Pauper`);
    },
    get description() {
      return i18n._(msg`60-card, commons only`);
    },
  },
  {
    value: "Premodern",
    get label() {
      return i18n._(msg`Premodern`);
    },
    get description() {
      return i18n._(msg`60-card, Fourth Edition through Scourge`);
    },
  },
  {
    value: "Commander",
    get label() {
      return i18n._(msg`Commander`);
    },
    get description() {
      return i18n._(msg`100-card singleton, 40 life`);
    },
  },
  {
    value: "Brawl",
    get label() {
      return i18n._(msg`Brawl`);
    },
    get description() {
      return i18n._(msg`60-card singleton, 25 life`);
    },
  },
  {
    value: "Oathbreaker",
    get label() {
      return i18n._(msg`Oathbreaker`);
    },
    get description() {
      return i18n._(msg`60-card singleton, planeswalker cmdr`);
    },
  },
  {
    value: "Draft",
    get label() {
      return i18n._(msg`Draft`);
    },
    get description() {
      return i18n._(msg`40-card decks built from a draft`);
    },
  },
  {
    value: "Sealed",
    get label() {
      return i18n._(msg`Sealed`);
    },
    get description() {
      return i18n._(msg`40-card decks built from a sealed pool`);
    },
  },
];
export const LIMITED_KINDS: LimitedKindMeta[] = [
  {
    value: "draft",
    get label() {
      return i18n._(msg`Booster Draft`);
    },
    icon: Swords,
    get description() {
      return i18n._(msg`Pod draft \u2014 pass packs around the table.`);
    },
    enabled: true,
  },
  {
    value: "sealed",
    get label() {
      return i18n._(msg`Sealed`);
    },
    icon: Boxes,
    get description() {
      return i18n._(msg`Each player opens packs and builds independently.`);
    },
    enabled: true,
  },
  {
    value: "winston",
    get label() {
      return i18n._(msg`Winston Draft`);
    },
    icon: Layers,
    get description() {
      return i18n._(msg`2-player pile draft from a shared pool. Single-player only for now.`);
    },
    enabled: false,
  },
  {
    value: "cube",
    get label() {
      return i18n._(msg`Cube`);
    },
    icon: Wand2,
    get description() {
      return i18n._(msg`Pod draft from a CubeCobra cube.`);
    },
    enabled: true,
  },
];
export const PLAYER_OPTIONS_MATCH = [2, 3, 4] as const;
export const PLAYER_OPTIONS_LIMITED = [2, 4, 6, 8] as const;
export const defaultMatchPlayers = (format: GameFormat) => (format === "Commander" ? 4 : 2);
// Capped at 90s: the engine auto-passes a silent seat after 120s
export const RECONNECT_TIMEOUT_OPTIONS = [30, 60, 90] as const;
export const CREATE_SPLASH_MIN_MS = 1200;
