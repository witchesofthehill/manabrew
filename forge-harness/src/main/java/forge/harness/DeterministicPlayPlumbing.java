package forge.harness;

import forge.ai.ComputerUtilCost;
import forge.game.Game;
import forge.game.GameActionUtil;
import forge.game.ability.AbilityKey;
import forge.game.ability.AbilityUtils;
import forge.game.ability.ApiType;
import forge.game.ability.effects.CharmEffect;
import forge.game.card.Card;
import forge.game.cost.Cost;
import forge.game.cost.CostPayment;
import forge.game.player.Player;
import forge.game.spellability.Spell;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.TargetChoices;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerHandler;
import forge.game.trigger.TriggerType;
import forge.game.trigger.TriggerWaiting;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

/**
 * Deterministic cast/payment plumbing extracted from {@link DeterministicController}.
 *
 * Source references mirrored with minimal changes:
 * - forge/forge-ai/src/main/java/forge/ai/ComputerUtil.java (playNoStack/playStack)
 * - forge/forge-ai/src/main/java/forge/ai/PlayerControllerAi.java
 */
final class DeterministicPlayPlumbing {
    private final DeterministicController controller;
    private final Player payer;
    private final DeterministicCostPlumbing costPlumbing;

    DeterministicPlayPlumbing(
            final DeterministicController controller,
            final Player payer,
            final DeterministicCostPlumbing costPlumbing
    ) {
        this.controller = controller;
        this.payer = payer;
        this.costPlumbing = costPlumbing;
    }

    boolean playNoStackDeterministic(final Player ai, SpellAbility sa, final Game game, final boolean effect) {
        sa.setActivatingPlayer(ai);
        clearPaymentState(sa);
        if (!ComputerUtilCost.canPayCost(sa, ai, effect)) {
            return false;
        }

        final Card source = sa.getHostCard();
        if (!effect && sa.isSpell() && !source.isCopiedSpell()) {
            sa.setHostCard(game.getAction().moveToStack(source, sa));
            sa = GameActionUtil.addExtraKeywordCost(sa);
        }

        final Cost cost = sa.getPayCosts();
        if (costPlumbing.payWithDeterministicDecision(cost, sa, effect)) {
            AbilityUtils.resolve(sa);
            return true;
        }

        return false;
    }

    boolean playStackDeterministic(SpellAbility sa, final Player ai, final Game game) {
        sa.setActivatingPlayer(ai);
        clearPaymentState(sa);
        if (!ComputerUtilCost.canPayCost(sa, ai, false)) {
            return false;
        }

        final Card source = sa.getHostCard();
        final Zone fromZone = game.getZoneOf(source);
        final int zonePosition = fromZone != null ? fromZone.getCards().indexOf(source) : 0;

        if (sa.isSpell() && !source.isCopiedSpell()) {
            sa.setHostCard(game.getAction().moveToStack(source, sa));
            sa = GameActionUtil.addExtraKeywordCost(sa);
        }

        final Cost cost = sa.getPayCosts();
        final CostPayment pay = new CostPayment(cost, sa);

        if (!sa.checkRestrictions(ai)) {
            GameActionUtil.rollbackAbility(sa, fromZone, zonePosition, pay, source);
            return false;
        }

        if (costPlumbing.payWithDeterministicDecision(cost, sa, false)) {
            game.getStack().add(sa);
            return true;
        }
        // Payment failed — rollback moveToStack if the card was moved.
        GameActionUtil.rollbackAbility(sa, fromZone, zonePosition, pay, source);
        return false;
    }

    boolean handlePlayingSpellAbilityDeterministic(final Player ai, SpellAbility sa, final Game game) {
        final Card source = sa.getHostCard();
        final Card host = sa.getHostCard();
        final Zone hz = host.isCopiedSpell() ? null : host.getZone();
        final int zonePosition = hz != null ? hz.getCards().indexOf(host) : 0;
        source.setSplitStateToPlayAbility(sa);

        if (sa.isSpell() && !source.isCopiedSpell()) {
            sa = AbilityUtils.addSpliceEffects(sa);
            if (sa.getSplicedCards() != null && !sa.getSplicedCards().isEmpty()) {
                sa.resetTargets();
                if (!sa.setupTargets()) {
                    return false;
                }
            }
        }

        if (!sa.isCopied()) {
            sa.resetPaidHash();
            sa.setPaidLife(0);
            clearPaymentState(sa);
        }

        if (sa.getApi() == ApiType.Charm && !CharmEffect.makeChoices(sa)) {
            return false;
        }

        if (sa.isSpell() && !source.isCopiedSpell()) {
            sa.setHostCard(game.getAction().moveToStack(source, sa));
        }

        sa = GameActionUtil.addExtraKeywordCost(sa);

        // Mirror HumanPlaySpellAbility pre-cost prerequisites:
        // targeting setup is evaluated directly, not gated by isTargetNumberValid().
        if (!sa.setupTargets()) {
            // Mirror HumanPlaySpellAbility's rollback path
            // (forge-gui/.../HumanPlaySpellAbility.java:179): when setupTargets
            // fails after moveToStack, restore the host to its origin zone so
            // the next priority window doesn't see a card stranded on the
            // Stack. Without this the deterministic agent silently drops the
            // card from its playable list and diverges from the Rust engine,
            // which performs a full snapshot rollback (cast_spell.rs:1150).
            if (sa.isSpell() && !source.isCopiedSpell() && hz != null) {
                GameActionUtil.rollbackAbility(sa, hz, zonePosition,
                        new CostPayment(sa.getPayCosts(), sa), host);
            }
            return false;
        }

        final Cost cost = sa.getPayCosts();
        game.getStack().freezeStack(sa);

        if (costPlumbing.payWithDeterministicDecision(cost, sa, false)) {
            // Fix for LTB trigger collection during frozen stack.
            // When a card is sacrificed as a cost while the stack is frozen, its
            // LTB (leaves-the-battlefield) triggers are registered in activeTriggers
            // via registerActiveLTBTrigger using an LKI copy from lastStateBattlefield.
            // However, the waiting trigger's runParams contain a *different* LKI copy
            // (created by changeZone). When collectTriggerForWaiting runs later (inside
            // addAndUnfreeze -> push -> resetActiveTriggers), Card.Self matching uses
            // object identity and fails because the two LKI copies are different objects
            // with the same card ID. This causes modular death triggers (and similar
            // LTB triggers) to be silently lost.
            //
            // Fix: patch the CardLKI (and Card) references in the waiting trigger's
            // runParams to point to the same Java object as the active LTB trigger's
            // host card. This makes the engine's own collectTriggerForWaiting ->
            // performTest -> Card.Self check succeed via object identity.
            fixLTBCardIdentity(game, sa);

            game.getStack().addAndUnfreeze(sa);
            if (sa.getSplicedCards() != null && !sa.getSplicedCards().isEmpty()) {
                game.getAction().reveal(sa.getSplicedCards(), ai, true, "Computer reveals spliced cards from ");
            }
            return true;
        }

        System.out.println("[" + sa.getActivatingPlayer() + "] AI failed to play "
                + sa.getHostCard() + " [" + sa.getHostCard().getZone() + "]");
        sa.setSkip(true);
        if (host != null && hz != null) {
            GameActionUtil.rollbackAbility(sa, hz, zonePosition, new CostPayment(cost, sa), host);
            final Card rolledBackHost = sa.getHostCard();
            if (rolledBackHost != null) {
                controller.markFailedPaymentCard(rolledBackHost);
                for (SpellAbility csa : rolledBackHost.getSpellAbilities()) {
                    csa.setSkip(true);
                }
            }
        }
        // Mirror HumanPlaySpellAbility: unfreeze the stack when cost payment
        // fails. Without this, the stack stays frozen from the freezeStack()
        // call at line 141 and the primaryAbility reference lingers, causing
        // subsequent addAndUnfreeze() calls to skip unfreezing because
        // primaryAbility doesn't match the new ability.
        game.getStack().unfreezeStack();
        return false;
    }

    private static void clearPaymentState(final SpellAbility sa) {
        sa.clearManaPaid();
        sa.getPayingManaAbilities().clear();
    }

    /**
     * Fix LKI object identity for LTB triggers in waiting trigger runParams.
     *
     * This works around a Java engine bug where Card.Self matching fails during
     * collectTriggerForWaiting because the LKI copy in the trigger's runParams
     * (from changeZone) is a different Java object than the LKI copy used as the
     * trigger's host card (from lastStateBattlefield/registerActiveLTBTrigger).
     *
     * Instead of pre-collecting triggers (which causes timing issues), we patch
     * the CardLKI reference in runParams to point to the same Java object as the
     * active LTB trigger's host. This lets the engine's own collectTriggerForWaiting
     * (called inside addAndUnfreeze -> push -> resetActiveTriggers) succeed via
     * its normal Card.Self object identity check.
     */
    @SuppressWarnings("unchecked")
    private static void fixLTBCardIdentity(final Game game, final SpellAbility sourceSA) {
        try {
            final TriggerHandler th = game.getTriggerHandler();

            final Field wtField = TriggerHandler.class.getDeclaredField("waitingTriggers");
            wtField.setAccessible(true);
            final List<TriggerWaiting> waitingTriggers = (List<TriggerWaiting>) wtField.get(th);

            final Field atField = TriggerHandler.class.getDeclaredField("activeTriggers");
            atField.setAccessible(true);
            final List<Trigger> activeTriggers = (List<Trigger>) atField.get(th);

            if (waitingTriggers.isEmpty() || activeTriggers.isEmpty()) {
                return;
            }

            for (final TriggerWaiting wt : waitingTriggers) {
                if (wt.getTriggers() != null) {
                    continue; // already collected
                }

                if (wt.getMode() != TriggerType.ChangesZone) {
                    continue;
                }

                final Map<AbilityKey, Object> runParams = wt.getParams();
                if (!"Battlefield".equals(runParams.get(AbilityKey.Origin))) {
                    continue;
                }

                final Card cardLKI = (Card) runParams.get(AbilityKey.CardLKI);
                if (cardLKI == null) {
                    continue;
                }

                // Look for an active LTB trigger whose host has the same card ID
                // but is a different Java object (the bug scenario).
                for (final Trigger t : activeTriggers) {
                    if (t.getMode() != TriggerType.ChangesZone) {
                        continue;
                    }
                    final Card trigHost = t.getHostCard();
                    if (trigHost.getId() != cardLKI.getId()) {
                        continue;
                    }
                    // Only fix if these are different Java objects with the same ID
                    if (trigHost == cardLKI) {
                        continue;
                    }
                    // Only fix Card.Self triggers — these are the ones that fail
                    // due to object identity in CardProperty.java
                    if (!t.hasParam("ValidCard") || !t.getParam("ValidCard").startsWith("Card.Self")) {
                        continue;
                    }

                    // Patch the runParams so CardLKI points to the trigger host.
                    // When collectTriggerForWaiting runs later, performTest will
                    // call matchesValidParam("ValidCard", moved) where moved is
                    // now the same object as source — Card.Self check passes.
                    runParams.put(AbilityKey.CardLKI, trigHost);
                    final Card cardParam = (Card) runParams.get(AbilityKey.Card);
                    if (cardParam != null && cardParam.getId() == trigHost.getId() && cardParam != trigHost) {
                        runParams.put(AbilityKey.Card, trigHost);
                    }
                    break; // only one fix needed per waiting trigger
                }
            }
        } catch (NoSuchFieldException | IllegalAccessException e) {
            // If reflection fails, silently continue — the triggers will be processed
            // through the normal (buggy) path, which is the existing behavior.
        }
    }

    boolean prepareSingleSaDeterministic(final Card host, final SpellAbility sa, final boolean isMandatory) {
        if (sa.getApi() == ApiType.Charm) {
            if (!CharmEffect.makeChoices(sa)) {
                return false;
            }
        }
        // Deterministic harness must not route trigger target setup through AI
        // heuristics (`AiController#doTrigger`). Mirror Java SpellAbility setup flow
        // so all target prompts are resolved by controller callbacks.
        return sa.setupTargets();
    }

    void orderAndPlaySimultaneousSa(List<SpellAbility> activePlayerSAs, final Game game) {
        // Sort simultaneous triggers deterministically by host card zone-entry
        // timestamp, with trigger ID as tiebreaker.  The engine's
        // TriggerWaiting stores triggers in a HashMap which does not preserve
        // insertion order; re-sorting here in the harness avoids modifying the
        // engine's TriggerWaiting.java while matching the Rust engine's
        // zone_timestamp ordering.
        activePlayerSAs.sort((a, b) -> {
            long tsA = a.getHostCard().getGameTimestamp();
            long tsB = b.getHostCard().getGameTimestamp();
            if (tsA != tsB) return Long.compare(tsA, tsB);
            int idA = a.isTrigger() ? a.getTrigger().getId() : -1;
            int idB = b.isTrigger() ? b.getTrigger().getId() : -1;
            return Integer.compare(idA, idB);
        });
        for (final SpellAbility sa : activePlayerSAs) {
            if (sa.isTrigger() && !sa.isCopied()) {
                boolean prepared = prepareSingleSaDeterministic(sa.getHostCard(), sa, true);
                if (prepared) {
                    playStackDeterministic(sa, payer, game);
                }
            } else {
                if (sa.isCopied()) {
                    if (sa.isSpell()) {
                        if (!sa.getHostCard().isInZone(ZoneType.Stack)) {
                            sa.setHostCard(game.getAction().moveToStack(sa.getHostCard(), sa));
                        } else {
                            game.getStackZone().add(sa.getHostCard());
                        }
                    }

                    if (sa.isMayChooseNewTargets()) {
                        final TargetChoices tc = sa.getTargets();
                        if (!sa.setupTargets()) {
                            sa.setTargets(tc);
                        }
                    }
                }
                game.getStack().add(sa);
            }
        }
    }

    boolean playSaFromPlayEffect(SpellAbility tgtSA, final Game game) {
        final boolean optional = !tgtSA.getPayCosts().isMandatory();
        if (tgtSA instanceof Spell) {
            if (optional && !controller.chooseDeterministicBoolean("play_effect_optional", "DECLINE", "ACCEPT")) {
                return false;
            }
            return playStackDeterministic(tgtSA, payer, game);
        }
        return true;
    }

}
