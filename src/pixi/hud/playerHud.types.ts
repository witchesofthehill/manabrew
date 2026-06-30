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
  /** Renders the count in the lethal colour (e.g. ≥21 commander damage). */
  lethal?: boolean;
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
  /** Facing lethal unblocked combat damage — the combat ring pulses harder. */
  combatLethal: boolean;
  manaPool: Record<string, number>;
  badges: PlayerHudBadge[];
}
