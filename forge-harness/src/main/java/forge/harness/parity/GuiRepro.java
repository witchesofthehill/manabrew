package forge.harness.parity;

import forge.harness.common.ChoiceSpace;

import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.card.CardUtil;
import forge.game.cost.Cost;
import forge.game.player.Player;
import forge.game.player.PlayerController.FullControlFlag;
import forge.game.spellability.SpellAbility;

import java.util.Random;

/**
 * Headless reproductions of specific GUI-side controller logic used for parity.
 */
public final class GuiRepro {
    private GuiRepro() {
    }

    /**
     * Mirrors forge.player.PlayerControllerHuman#announceRequirements.
     * Source reference:
     * forge/forge-gui/src/main/java/forge/player/PlayerControllerHuman.java
     */
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
}
