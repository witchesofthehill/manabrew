package forge.harness.common;

import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.player.Player;

import java.util.ArrayList;
import java.util.List;

public final class CombatChoiceSpace {
    private CombatChoiceSpace() {}

    public static List<Card> legalAttackers(final Player attacker, final Combat combat) {
        final List<Card> out = new ArrayList<>();
        final CardCollection creatures = attacker.getCreaturesInPlay();
        for (final Card c : creatures) {
            for (final GameEntity defender : combat.getDefenders()) {
                if (CombatUtil.canAttack(c, defender)) {
                    out.add(c);
                    break;
                }
            }
        }
        return out;
    }

    public static List<GameEntity> legalDefendersForAttacker(final Card attacker, final Combat combat) {
        final List<GameEntity> out = new ArrayList<>();
        for (final GameEntity defender : combat.getDefenders()) {
            if (CombatUtil.canAttack(attacker, defender)) {
                out.add(defender);
            }
        }
        return out;
    }

    public static List<Card> legalBlockers(final Player defender, final Combat combat) {
        final List<Card> out = new ArrayList<>();
        for (final Card blocker : defender.getCreaturesInPlay()) {
            if (CombatUtil.canBlock(blocker, combat)) {
                out.add(blocker);
            }
        }
        return out;
    }

    public static List<Card> legalAttackersForBlocker(
            final Card blocker,
            final List<Card> attackers,
            final Combat combat) {
        final List<Card> out = new ArrayList<>();
        for (final Card attacker : attackers) {
            if (CombatUtil.canBlock(attacker, blocker, combat)) {
                out.add(attacker);
            }
        }
        return out;
    }

    public static boolean canBlock(final Card attacker, final Card blocker, final Combat combat) {
        return CombatUtil.canBlock(attacker, blocker, combat);
    }
}
