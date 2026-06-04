package forge.harness.common;

import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.card.CardUtil;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.cost.Cost;
import forge.game.player.Player;
import forge.game.player.PlayerController.FullControlFlag;
import forge.game.spellability.SpellAbility;

import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Unified entrypoints to correctly interface with the forge engine, and check correctness
 */
public final class EngineHandler {
    private EngineHandler() {
    }

    public static Integer announceRequirements(final Player player, final SpellAbility ability,
            final String announce, final Random rng) {
        final int[] bounds = announceBounds(player, ability, announce);
        if (bounds == null) {
            return null;
        }
        return ChoiceSpace.pickIntInRange(bounds[0], bounds[1], rng);
    }

    public static int[] announceBounds(final Player player, final SpellAbility ability, final String announce) {
        final Card host = ability.getHostCard();
        int max = Integer.MAX_VALUE;
        int min = 0;
        final boolean abXMin = ability.hasParam("XMin");
        final Cost cost = ability.getPayCosts();

        if ("X".equals(announce)) {
            if (abXMin) {
                min = Integer.parseInt(ability.getParam("XMin"));
            }
            if (ability.hasParam("XMaxLimit")) {
                max = Math.min(max, AbilityUtils.calculateAmount(host, ability.getParam("XMaxLimit"), ability));
            }
            if (cost != null) {
                Integer costX = cost.getMaxForNonManaX(ability, player, false);
                if (costX != null && !player.getController().isFullControl(FullControlFlag.AllowPaymentStartWithMissingResources)) {
                    max = Math.min(max, costX);
                }
                if (cost.hasManaCost() && !abXMin) {
                    min = cost.getCostMana().getXMin();
                }
            }
        }

        if (ability.hasParam("AnnounceMax")) {
            max = Math.min(max, AbilityUtils.calculateAmount(host, ability.getParam("AnnounceMax"), ability));
        }

        if (ability.usesTargeting() && ability.getTargetRestrictions() != null
                && announce.equals(ability.getTargetRestrictions().getMinTargets())) {
            max = Math.min(max, CardUtil.getValidCardsToTarget(ability).size());
        }

        if (min > max) {
            return null;
        }
        return new int[] {min, max};
    }

    public static String validateOption(final String chosen, final List<String> options, final boolean optional) {
        if (options == null || options.isEmpty()) {
            return optional ? null : "";
        }
        if (chosen != null && options.contains(chosen)) {
            return chosen;
        }
        return optional ? null : options.get(0);
    }

    public static <T> List<T> selectModes(final List<T> possible, final List<Integer> chosen, final boolean allowRepeat) {
        final List<T> selected = new ArrayList<>();
        final Set<Integer> used = new LinkedHashSet<>();
        for (final Integer index : chosen) {
            if (index == null || index < 0 || index >= possible.size()) {
                continue;
            }
            if (!allowRepeat && !used.add(index)) {
                continue;
            }
            selected.add(possible.get(index));
        }
        return selected;
    }

    public static Map<Card, List<Card>> validBlockersByAttacker(
            final Combat combat,
            final List<Card> attackers,
            final List<Card> availableBlockers) {
        final Map<Card, List<Card>> out = new LinkedHashMap<>();
        for (final Card attacker : attackers) {
            final List<Card> eligible = new ArrayList<>();
            for (final Card blocker : availableBlockers) {
                if (CombatChoiceSpace.canBlock(attacker, blocker, combat)) {
                    eligible.add(blocker);
                }
            }
            out.put(attacker, eligible);
        }
        return out;
    }

    public static String applyBlockerAssignments(
            final Combat combat,
            final Player defender,
            final List<Pair<Card, Card>> assignments) {
        final List<Card> applied = new ArrayList<>();
        for (final Pair<Card, Card> assignment : assignments) {
            final Card blocker = assignment.getLeft();
            final Card attacker = assignment.getRight();
            if (blocker != null && attacker != null && CombatChoiceSpace.canBlock(attacker, blocker, combat)) {
                combat.addBlocker(attacker, blocker);
                applied.add(blocker);
            }
        }
        final String error = CombatUtil.validateBlocks(combat, defender);
        if (error != null) {
            for (final Card blocker : applied) {
                combat.undoBlockingAssignment(blocker);
            }
        }
        return error;
    }
}
