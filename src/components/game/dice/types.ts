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
  /**
   * Optional theme-token color (CSS color string). When supplied, every
   * die in this animation is tinted with the color so the roll's
   * source player is visually clear.
   */
  accentColor?: string;
  className?: string;
}
