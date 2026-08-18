export interface DiceRollSpec {
  sides: number;
  naturalResults: number[];
  finalResults: number[];
  ignoredRolls?: number[];
}

export interface DieFace {
  sides: number;
  value: number;
}

export interface DiceRollAnimationProps {
  spec: DiceRollSpec;
  onComplete?: () => void;
  accentColor?: string;
  className?: string;
}
