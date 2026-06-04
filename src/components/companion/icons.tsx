import { GameIcon, type GameIconKey } from "./GameIcon";

/**
 * Map old lucide names that may still live in persisted sessions to their
 * game-icons equivalents so saved counters keep their glyphs.
 */
const LEGACY_LUCIDE_TO_GAME: Record<string, GameIconKey> = {
  Skull: "skull-crack",
  Zap: "lightning-trio",
  Sparkles: "sparkles",
  Radiation: "radioactive",
  Ticket: "trophy-cup",
  CloudLightning: "tornado",
  Star: "star-medal",
  Heart: "bleeding-heart",
  Flame: "flame",
  Snowflake: "magic-portal",
  Droplets: "potion-ball",
  Sun: "sun-priest",
  Moon: "magic-portal",
  Crown: "crown",
  Sword: "sword",
  Shield: "trophy-cup",
  Hourglass: "sands-of-time",
  Bug: "vortex",
  Trophy: "trophy-cup",
  Anchor: "vortex",
  Compass: "magic-portal",
  Feather: "fairy-wand",
  Gem: "potion-ball",
};

interface CompanionIconProps {
  iconKey: string | undefined | null;
  className?: string;
}

export function CompanionIcon({ iconKey, className }: CompanionIconProps) {
  const gameKey = resolveGameIcon(iconKey);
  return <GameIcon icon={gameKey} className={className} />;
}

function resolveGameIcon(key: string | undefined | null): GameIconKey {
  if (!key) return "vortex";
  if (key in LEGACY_LUCIDE_TO_GAME) return LEGACY_LUCIDE_TO_GAME[key]!;
  return (key as GameIconKey) ?? "vortex";
}
