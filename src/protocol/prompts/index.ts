import type * as StateUpdate from "./stateUpdate";
import type * as GameOver from "./gameOver";
import type * as Mulligan from "./mulligan";
import type * as MulliganPutBack from "./mulliganPutBack";
import type * as ChooseAction from "./chooseAction";
import type * as ChooseAttackers from "./chooseAttackers";
import type * as ChooseBlockers from "./chooseBlockers";
import type * as ChooseExertAttackers from "./chooseExertAttackers";
import type * as ChooseEnlistAttackers from "./chooseEnlistAttackers";
import type * as ChooseDamageAssignmentOrder from "./chooseDamageAssignmentOrder";
import type * as ChooseCombatDamageAssignment from "./chooseCombatDamageAssignment";
import type * as PayCombatCost from "./payCombatCost";
import type * as ChooseTargetCard from "./chooseTargetCard";
import type * as ChooseTargetPlayer from "./chooseTargetPlayer";
import type * as ChooseTargetAny from "./chooseTargetAny";
import type * as ChooseTargetSpell from "./chooseTargetSpell";
import type * as ChooseTargetCardFromZone from "./chooseTargetCardFromZone";
import type * as RevealCards from "./revealCards";
import type * as ChooseMode from "./chooseMode";
import type * as ChooseOptionalTrigger from "./chooseOptionalTrigger";
import type * as PayCostToPreventEffect from "./payCostToPreventEffect";
import type * as ChooseColor from "./chooseColor";
import type * as ChooseType from "./chooseType";
import type * as ChooseNumber from "./chooseNumber";
import type * as ChooseCardName from "./chooseCardName";
import type * as ChooseCardsForEffect from "./chooseCardsForEffect";
import type * as ChooseDiscard from "./chooseDiscard";
import type * as ChoosePhyrexian from "./choosePhyrexian";
import type * as ChooseKicker from "./chooseKicker";
import type * as ChooseBuyback from "./chooseBuyback";
import type * as ChooseMultikicker from "./chooseMultikicker";
import type * as ChooseReplicate from "./chooseReplicate";
import type * as ChooseAlternativeCost from "./chooseAlternativeCost";
import type * as PayManaCost from "./payManaCost";
import type * as ChooseDelve from "./chooseDelve";
import type * as ChooseConvoke from "./chooseConvoke";
import type * as ChooseImprovise from "./chooseImprovise";
import type * as SpecifyManaCombo from "./specifyManaCombo";
import type * as Scry from "./scry";
import type * as Surveil from "./surveil";
import type * as Dig from "./dig";
import type * as ReorderLibrary from "./reorderLibrary";
import type * as ExploreDecision from "./exploreDecision";
import type * as HelpPayAssist from "./helpPayAssist";
import type * as FirstPlayerRoll from "./firstPlayerRoll";
import type * as DiceRolled from "./diceRolled";
import type * as ChooseRollToIgnore from "./chooseRollToIgnore";
import type * as ChooseRollToSwap from "./chooseRollToSwap";
import type * as ChooseRollToModify from "./chooseRollToModify";
import type * as ChooseDiceToReroll from "./chooseDiceToReroll";
import type * as ChooseRollSwapValue from "./chooseRollSwapValue";

export type PromptInput =
  | StateUpdate.Input
  | GameOver.Input
  | Mulligan.Input
  | MulliganPutBack.Input
  | ChooseAction.Input
  | ChooseAttackers.Input
  | ChooseBlockers.Input
  | ChooseExertAttackers.Input
  | ChooseEnlistAttackers.Input
  | ChooseDamageAssignmentOrder.Input
  | ChooseCombatDamageAssignment.Input
  | PayCombatCost.Input
  | ChooseTargetCard.Input
  | ChooseTargetCardFromZone.Input
  | ChooseTargetPlayer.Input
  | ChooseTargetAny.Input
  | ChooseTargetSpell.Input
  | RevealCards.Input
  | ChooseMode.Input
  | ChooseOptionalTrigger.Input
  | PayCostToPreventEffect.Input
  | ChooseColor.Input
  | ChooseType.Input
  | ChooseNumber.Input
  | ChooseCardName.Input
  | ChooseCardsForEffect.Input
  | ChooseDiscard.Input
  | ChoosePhyrexian.Input
  | ChooseKicker.Input
  | ChooseBuyback.Input
  | ChooseMultikicker.Input
  | ChooseReplicate.Input
  | ChooseAlternativeCost.Input
  | PayManaCost.Input
  | ChooseDelve.Input
  | ChooseConvoke.Input
  | ChooseImprovise.Input
  | SpecifyManaCombo.Input
  | Scry.Input
  | Surveil.Input
  | Dig.Input
  | ReorderLibrary.Input
  | ExploreDecision.Input
  | HelpPayAssist.Input
  | FirstPlayerRoll.Input
  | DiceRolled.Input
  | ChooseRollToIgnore.Input
  | ChooseRollToSwap.Input
  | ChooseRollToModify.Input
  | ChooseDiceToReroll.Input
  | ChooseRollSwapValue.Input;

export type PromptType = PromptInput["type"];

export type PromptOutput =
  | StateUpdate.Output
  | GameOver.Output
  | Mulligan.Output
  | MulliganPutBack.Output
  | ChooseAction.Output
  | ChooseAttackers.Output
  | ChooseBlockers.Output
  | ChooseExertAttackers.Output
  | ChooseEnlistAttackers.Output
  | ChooseDamageAssignmentOrder.Output
  | ChooseCombatDamageAssignment.Output
  | PayCombatCost.Output
  | ChooseTargetCard.Output
  | ChooseTargetCardFromZone.Output
  | ChooseTargetPlayer.Output
  | ChooseTargetAny.Output
  | ChooseTargetSpell.Output
  | RevealCards.Output
  | ChooseMode.Output
  | ChooseOptionalTrigger.Output
  | PayCostToPreventEffect.Output
  | ChooseColor.Output
  | ChooseType.Output
  | ChooseNumber.Output
  | ChooseCardName.Output
  | ChooseCardsForEffect.Output
  | ChooseDiscard.Output
  | ChoosePhyrexian.Output
  | ChooseKicker.Output
  | ChooseBuyback.Output
  | ChooseMultikicker.Output
  | ChooseReplicate.Output
  | ChooseAlternativeCost.Output
  | PayManaCost.Output
  | ChooseDelve.Output
  | ChooseConvoke.Output
  | ChooseImprovise.Output
  | SpecifyManaCombo.Output
  | Scry.Output
  | Surveil.Output
  | Dig.Output
  | ReorderLibrary.Output
  | ExploreDecision.Output
  | HelpPayAssist.Output
  | FirstPlayerRoll.Output
  | DiceRolled.Output
  | ChooseRollToIgnore.Output
  | ChooseRollToSwap.Output
  | ChooseRollToModify.Output
  | ChooseDiceToReroll.Output
  | ChooseRollSwapValue.Output;
