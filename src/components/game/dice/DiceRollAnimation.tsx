import { CssDiceAnimator } from "./animator/CssDiceAnimator";
import type { DiceRollAnimationProps } from "./types";

export function DiceRollAnimation(props: DiceRollAnimationProps) {
  return <CssDiceAnimator {...props} />;
}
