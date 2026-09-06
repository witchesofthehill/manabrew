export interface PlayerHudTooltipContent {
  title: string;
  lines?: { text: string; active: boolean }[];
}

export interface PlayerHudBadge {
  id: string;
  icon: string;
  color: string;
  label: string;
  count?: number;
  lethal?: boolean;
  onTap?: () => void;
  /** Compact-mode zone pill (library/graveyard/exile): renders in a vertical
   *  column anchored to the avatar instead of the badge rows. */
  zone?: boolean;
}

export interface PlayerHudFact {
  id: string;
  label: string;
  value: string;
  emphasized?: boolean;
}

export interface PlayerHudSpec {
  playerId: string;
  name: string;
  isSelf: boolean;
  life: number;
  color: string;
  avatarUrl?: string;
  isBot: boolean;
  isActiveTurn: boolean;
  isPriorityPlayer: boolean;
  isTargetable: boolean;
  isSelectedTarget: boolean;
  isFlashing: boolean;
  isEliminated: boolean;
  isDisconnected: boolean;
  inCombat: boolean;
  combatLethal: boolean;
  manaPool: Record<string, number>;
  badges: PlayerHudBadge[];
  ruleFacts: PlayerHudFact[];
}
