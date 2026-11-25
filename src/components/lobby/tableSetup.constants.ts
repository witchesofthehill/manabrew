import type { GameFormat } from "@/types/server";
export const FORMATS: {
  value: GameFormat;
  label: string;
  description: string;
}[] = [
  {
    value: "Standard",
    label: `Standard`,
    description: `60-card constructed, rotating sets`,
  },
  {
    value: "Pioneer",
    label: `Pioneer`,
    description: `60-card, Return to Ravnica forward`,
  },
  {
    value: "Modern",
    label: `Modern`,
    description: `60-card, 8th Edition forward`,
  },
  {
    value: "Legacy",
    label: `Legacy`,
    description: `60-card, all sets, banned list`,
  },
  {
    value: "Vintage",
    label: `Vintage`,
    description: `60-card, all sets, restricted list`,
  },
  {
    value: "Pauper",
    label: `Pauper`,
    description: `60-card, commons only`,
  },
  {
    value: "Premodern",
    label: `Premodern`,
    description: `60-card, Fourth Edition through Scourge`,
  },
  {
    value: "Commander",
    label: `Commander`,
    description: `100-card singleton, 40 life`,
  },
  {
    value: "DuelCommander",
    label: `Duel Commander`,
    description: `1v1 Commander, 20 life`,
  },
  {
    value: "PauperCommander",
    label: `Pauper Commander`,
    description: `100-card singleton, 30 life, commons`,
  },
  {
    value: "Brawl",
    label: `Brawl`,
    description: `60-card singleton, 25 life`,
  },
  {
    value: "Oathbreaker",
    label: `Oathbreaker`,
    description: `60-card singleton, planeswalker cmdr`,
  },
  {
    value: "Draft",
    label: "Draft",
    description: "Play with saved draft decks. Draft new decks in offline play.",
  },
  {
    value: "Sealed",
    label: "Sealed",
    description: "Play with saved sealed decks. Open new pools in offline play.",
  },
];
export const PLAYER_OPTIONS_MATCH = [2, 3, 4] as const;
export const defaultMatchPlayers = (format: GameFormat) =>
  format === "Commander" || format === "PauperCommander" ? 4 : 2;
// Capped at 90s: the engine auto-passes a silent seat after 120s
export const RECONNECT_TIMEOUT_OPTIONS = [30, 60, 90] as const;
export const CREATE_SPLASH_MIN_MS = 1200;
