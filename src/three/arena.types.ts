export interface ArenaCard {
  attachedTo?: string;
  attachmentNames?: string[];
  attachedToName?: string;
  playerId?: string;
  attackingPlayerId?: string;
  attackTargetId?: string;
  keywords?: string[];
  counters?: Record<string, number>;
  damage?: number;
  summoningSick?: boolean;
  actionCount?: number;
  id: string;
  name: string;
  type: string;
  cost: string;
  text: string;
  stats?: string;
  statsChanged?: boolean;
  image?: string;
  artImage?: string;
  color: string;
  frame?: "W" | "U" | "B" | "R" | "G" | "C" | "M";
  side: "self" | "opponent" | "hand" | "opponentHand";
  tapped?: boolean;
  attacking?: boolean;
  selected?: boolean;
  playable?: boolean;
  hidden?: boolean;
}

export interface AutoPassCountdown {
  promptId?: string;
  startedAt: number;
  duration: number;
}

export interface ArenaColors {
  background: string;
  surface: string;
  border: string;
  foreground: string;
  muted: string;
  accent: string;
  hostile: string;
  playable?: string;
  attack?: string;
  block?: string;
}

export interface ArenaLink {
  from: string;
  to: string;
  color: string;
}

export interface ArenaSceneProps {
  targeting?: {
    stackId?: string;
    sourceId?: string;
    candidates: string[];
    selected: string[];
    maxTargets?: number;
  };
  cards: ArenaCard[];
  colors: ArenaColors;
  links?: ArenaLink[];
  blockTargets?: Record<string, string[]>;
  onCard: (id: string) => void;
  onHover?: (id: string | null, rect?: DOMRect) => void;
  onDrop?: (id: string, targetId: string | null) => void;
  onDrag?: (drag: { id: string; canPlay: boolean } | null) => void;
  combatStep?: string;
  combatTurn?: number;
  zones?: ArenaZonePile[];
  onZone?: (id: string) => void;
}

export interface ArenaZonePile {
  seat?: number;
  id: string;
  zone: "library" | "graveyard" | "exile";
  side: "self" | "opponent";
  count: number;
  topImage?: string;
  topName?: string;
}
