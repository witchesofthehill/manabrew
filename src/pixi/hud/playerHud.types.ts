export interface PlayerHudBadge {
  id: string;
  icon: string;
  color: string;
  count?: number;
}

export interface PlayerHudSpec {
  playerId: string;
  name: string;
  life: number;
  color: string;
  avatarUrl?: string;
  isBot: boolean;
  isActiveTurn: boolean;
  isPriorityPlayer: boolean;
  isTargetable: boolean;
  isSelectedTarget: boolean;
  manaPool: Record<string, number>;
  badges: PlayerHudBadge[];
}
