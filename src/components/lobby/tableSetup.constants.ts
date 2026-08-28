import type { ComponentType } from "react";
import { Boxes, Layers, Swords, Wand2 } from "lucide-react";
import type { GameFormat } from "@/types/server";

export type RoomKind = "match" | "limited";

export type LimitedKind = "draft" | "sealed" | "winston" | "cube";

export interface LimitedKindMeta {
  value: LimitedKind;
  label: string;
  icon: ComponentType<{ className?: string }>;
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
    label: "Standard",
    description: "60-card constructed, rotating sets",
  },
  {
    value: "Pioneer",
    label: "Pioneer",
    description: "60-card, Return to Ravnica forward",
  },
  { value: "Modern", label: "Modern", description: "60-card, 8th Edition forward" },
  { value: "Legacy", label: "Legacy", description: "60-card, all sets, banned list" },
  {
    value: "Vintage",
    label: "Vintage",
    description: "60-card, all sets, restricted list",
  },
  { value: "Pauper", label: "Pauper", description: "60-card, commons only" },
  {
    value: "Premodern",
    label: "Premodern",
    description: "60-card, Fourth Edition through Scourge",
  },
  {
    value: "Commander",
    label: "Commander",
    description: "100-card singleton, 40 life",
  },
  { value: "Brawl", label: "Brawl", description: "60-card singleton, 25 life" },
  {
    value: "Oathbreaker",
    label: "Oathbreaker",
    description: "60-card singleton, planeswalker cmdr",
  },
  {
    value: "Draft",
    label: "Draft",
    description: "40-card decks built from a draft",
  },
  {
    value: "Sealed",
    label: "Sealed",
    description: "40-card decks built from a sealed pool",
  },
];

export const LIMITED_KINDS: LimitedKindMeta[] = [
  {
    value: "draft",
    label: "Booster Draft",
    icon: Swords,
    description: "Pod draft — pass packs around the table.",
    enabled: true,
  },
  {
    value: "sealed",
    label: "Sealed",
    icon: Boxes,
    description: "Each player opens packs and builds independently.",
    enabled: true,
  },
  {
    value: "winston",
    label: "Winston Draft",
    icon: Layers,
    description: "2-player pile draft from a shared pool. Single-player only for now.",
    enabled: false,
  },
  {
    value: "cube",
    label: "Cube",
    icon: Wand2,
    description: "Pod draft from a CubeCobra cube.",
    enabled: true,
  },
];

export const PLAYER_OPTIONS_MATCH = [2, 3, 4] as const;
export const PLAYER_OPTIONS_LIMITED = [2, 4, 6, 8] as const;

export const defaultMatchPlayers = (format: GameFormat) => (format === "Commander" ? 4 : 2);

// Capped at 90s: the engine auto-passes a silent seat after 120s
export const RECONNECT_TIMEOUT_OPTIONS = [30, 60, 90] as const;

export const CREATE_SPLASH_MIN_MS = 1200;
