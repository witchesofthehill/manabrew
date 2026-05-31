package forge.harness;

import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.card.CardUtil;
import forge.game.cost.Cost;
import forge.game.cost.CostPayment;
import forge.game.cost.CostPart;
import forge.game.mana.Mana;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.mana.ManaPool;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Deterministic, legality-first mana auto-payment for harness parity.
 *
 * <p>Design goals:
 * - Never depend on Java AI controller classes (`PlayerControllerAi`, `AiCostDecision`).
 * - Pay only legal costs using engine legality checks.
 * - Keep deterministic behavior: no random selection inside auto-pay.
 * - Pay required costs first; optional decisions are delegated to controller callbacks only
 *   when the engine asks for them while paying a selected ability cost.
 */
final class AutoPay {
    private final Player payer;
    private final HarnessCostPlumbing costPlumbing;

    AutoPay(final Player payer, final HarnessCostPlumbing costPlumbing) {
        this.payer = payer;
        this.costPlumbing = costPlumbing;
    }

    PayManaCostResult payManaCostWithTrace(final ManaCost toPay, final SpellAbility saBeingPaid, final boolean effect) {
        final ManaCostBeingPaid unpaid = new ManaCostBeingPaid(toPay);
        final ManaPool pool = payer.getManaPool();
        final List<Mana> spentFromPool = new ArrayList<>();
        final List<String> steps = new ArrayList<>();

        // Consume already-floating mana first.
        if (pool.payManaCostFromPool(unpaid, saBeingPaid, false, spentFromPool)) {
            CostPayment.handleOfferings(saBeingPaid, false, true);
            steps.add("Pay");
            return new PayManaCostResult(true, steps);
        }

        int guard = 0;
        while (!unpaid.isPaid() && guard++ < 128) {
            final List<ManaAbilityCandidate> candidates = collectPlayableManaAbilities(saBeingPaid);
            if (candidates.isEmpty()) {
                break;
            }

            final ManaAbilityCandidate chosen = chooseCandidate(unpaid, candidates);
            if (chosen == null) {
                break;
            }

            if (!payAbilityActivationCosts(chosen.spellAbility, effect)) {
                // Candidate became unpayable after state changes; continue with remaining choices.
                candidates.remove(chosen);
                continue;
            }

            steps.add(chosen.describeStep());

            // Mana abilities resolve immediately in engine flow.
            payer.getGame().getStack().addAndUnfreeze(chosen.spellAbility);

            // Spend produced mana against the unpaid cost, then consume any matching floating mana.
            pool.payManaFromAbility(saBeingPaid, unpaid, chosen.spellAbility);
            pool.payManaCostFromPool(unpaid, saBeingPaid, false, spentFromPool);
        }

        // Pay remaining phyrexian shards with life (2 life each).
        // Matches ComputerUtilMana.payManaCost() phyrexian handling.
        while (!unpaid.isPaid()) {
            boolean foundPhyrexian = false;
            for (final ManaCostShard s : unpaid.getUnpaidShards()) {
                if (s.isPhyrexian()) {
                    foundPhyrexian = true;
                    break;
                }
            }
            if (!foundPhyrexian) {
                break;
            }
            if (!payer.canPayLife(2, false, saBeingPaid)) {
                break;
            }
            unpaid.payPhyrexian();
            payer.payLife(2, saBeingPaid, false);
            saBeingPaid.setSpendPhyrexianMana(true);
        }

        final boolean paid = unpaid.isPaid();
        CostPayment.handleOfferings(saBeingPaid, false, paid);
        if (!paid) {
            pool.refundMana(spentFromPool);
            saBeingPaid.setSkip(true);
            steps.add("Cancel");
        } else {
            steps.add("Pay");
        }
        return new PayManaCostResult(paid, steps);
    }

    boolean payManaCost(final ManaCost toPay, final SpellAbility saBeingPaid, final boolean effect) {
        return payManaCostWithTrace(toPay, saBeingPaid, effect).paid;
    }

    List<SpellAbility> manaSources(final SpellAbility saBeingPaid) {
        final List<SpellAbility> out = new ArrayList<>();
        for (final ManaAbilityCandidate candidate : collectPlayableManaAbilities(saBeingPaid)) {
            out.add(candidate.spellAbility);
        }
        return out;
    }

    boolean floatManaFromSource(final SpellAbility manaAbility, final boolean effect) {
        manaAbility.setActivatingPlayer(payer);
        if (!payAbilityActivationCosts(manaAbility, effect)) {
            return false;
        }
        payer.getGame().getStack().addAndUnfreeze(manaAbility);
        return true;
    }

    private boolean payAbilityActivationCosts(final SpellAbility manaAbility, final boolean effect) {
        final Cost paymentCost = manaAbility.getPayCosts();
        if (paymentCost == null || paymentCost.getCostParts().isEmpty()) {
            return true;
        }
        return costPlumbing.payWithControllerDecision(paymentCost, manaAbility, effect);
    }

    private ManaAbilityCandidate chooseCandidate(
            final ManaCostBeingPaid unpaid,
            final List<ManaAbilityCandidate> candidates
    ) {
        for (final ManaCostShard shard : shardPriority(unpaid, candidates)) {
            final ManaAbilityCandidate match = chooseLeastVersatileCandidate(candidates, shard, unpaid);
            if (match != null) {
                configureExpressChoiceForShard(match.spellAbility, shard);
                return match;
            }
        }
        return null;
    }

    /**
     * Build shard payment priority: colored shards first (sorted by fewest
     * available candidates — most constrained first), then generic.
     * Mirrors Rust's get_next_shard_to_pay() which sorts by fewest sources.
     * This eliminates HashMap iteration-order non-determinism from
     * ManaCostBeingPaid.getUnpaidShards().
     */
    private List<ManaCostShard> shardPriority(
            final ManaCostBeingPaid unpaid,
            final List<ManaAbilityCandidate> candidates
    ) {
        final List<ManaCostShard> colored = new ArrayList<>();
        ManaCostShard generic = null;
        final Set<ManaCostShard> seen = new LinkedHashSet<>();
        for (final ManaCostShard shard : unpaid.getUnpaidShards()) {
            if (shard == ManaCostShard.X) {
                continue;
            }
            if (!seen.add(shard)) {
                continue;
            }
            if (shard == ManaCostShard.GENERIC) {
                generic = shard;
            } else {
                colored.add(shard);
            }
        }
        // Sort colored shards by fewest available candidates (most constrained first).
        // This matches Rust's get_next_shard_to_pay() and ensures that when paying
        // e.g. 1WU with a Hallowed Fountain (W/U) + Plains (W), U is paid first
        // since it has fewer sources, preventing the dual land from being consumed
        // for W and leaving U unpayable.
        colored.sort(Comparator
                .comparingInt((ManaCostShard shard) -> countCandidatesForShard(candidates, shard))
                .thenComparingInt(ParityOrder::colorShardRank));
        if (generic != null) {
            colored.add(generic);
        }
        return colored;
    }

    private int countCandidatesForShard(final List<ManaAbilityCandidate> candidates, final ManaCostShard shard) {
        int count = 0;
        for (final ManaAbilityCandidate c : candidates) {
            if (canPayShard(c.spellAbility, shard)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Choose the first candidate that can pay the given shard, but defer candidates
     * that are the sole available source for another unpaid colored shard.
     * Falls back to any valid candidate if all are sole sources.
     */
    private ManaAbilityCandidate chooseLeastVersatileCandidate(
            final List<ManaAbilityCandidate> candidates,
            final ManaCostShard shard,
            final ManaCostBeingPaid unpaid
    ) {
        ManaAbilityCandidate fallback = null;

        for (final ManaAbilityCandidate c : candidates) {
            if (!canPayShard(c.spellAbility, shard)) {
                continue;
            }
            if (fallback == null) {
                fallback = c;
            }
            // Check if this candidate is the ONLY source for another unpaid colored shard.
            // If so, defer it to preserve that source for the other shard.
            if (!isSoleSourceForOtherShard(c, shard, candidates, unpaid)) {
                return c;
            }
        }
        // All valid candidates are sole sources for some other shard — just use the first one.
        return fallback;
    }

    private boolean isSoleSourceForOtherShard(
            final ManaAbilityCandidate candidate,
            final ManaCostShard currentShard,
            final List<ManaAbilityCandidate> candidates,
            final ManaCostBeingPaid unpaid
    ) {
        final Set<ManaCostShard> seen = new LinkedHashSet<>();
        for (final ManaCostShard other : unpaid.getUnpaidShards()) {
            if (other == currentShard || other == ManaCostShard.GENERIC || other == ManaCostShard.X) {
                continue;
            }
            if (!seen.add(other)) {
                continue;
            }
            if (!canPayShard(candidate.spellAbility, other)) {
                continue;
            }
            // This candidate can pay for 'other' shard — check if it's the only one.
            int sourcesForOther = 0;
            for (final ManaAbilityCandidate alt : candidates) {
                if (canPayShard(alt.spellAbility, other)) {
                    sourcesForOther++;
                    if (sourcesForOther > 1) {
                        break;
                    }
                }
            }
            if (sourcesForOther <= 1) {
                // This candidate is the sole source for 'other' shard — defer it.
                return true;
            }
        }
        return false;
    }

    private boolean canPayShard(final SpellAbility manaAbility, final ManaCostShard shard) {
        if (shard == ManaCostShard.X) {
            return false;
        }
        final AbilityManaPart manaPart = manaAbility.getManaPart();
        if (manaPart == null) {
            return false;
        }
        if (!manaPart.meetsManaRestrictions(manaAbility)) {
            return false;
        }
        if (shard == ManaCostShard.GENERIC) {
            return true;
        }
        final Card source = manaAbility.getHostCard();
        for (final byte atom : producedAtoms(manaAbility)) {
            if (!manaAbility.allowsPayingWithShard(source, atom)) {
                continue;
            }
            if (payer.getManaPool().canPayForShardWithColor(shard, atom)) {
                return true;
            }
        }
        return false;
    }

    private void configureExpressChoiceForShard(final SpellAbility manaAbility, final ManaCostShard shard) {
        final AbilityManaPart manaPart = manaAbility.getManaPart();
        if (manaPart == null) {
            return;
        }
        // ManaReflected abilities have origProduced="1" so isAnyMana()/isComboMana()
        // return false, but they still produce multiple colors.  Without express
        // choice, ManaReflectedEffect falls through to controller.chooseColor()
        // which uses RNG and may pick the wrong color.
        final boolean isReflected = manaAbility.getApi() == ApiType.ManaReflected;
        if (!isReflected && !manaPart.isAnyMana() && !manaPart.isComboMana()) {
            return;
        }
        final byte preferred = preferredColorForShard(shard, producedAtoms(manaAbility));
        if (preferred != 0) {
            manaPart.setExpressChoice(shortColor(preferred));
        }
    }

    private byte preferredColorForShard(final ManaCostShard shard, final List<Byte> produced) {
        for (final byte atom : produced) {
            if (payer.getManaPool().canPayForShardWithColor(shard, atom)) {
                return atom;
            }
        }
        return produced.isEmpty() ? 0 : produced.get(0);
    }

    private List<ManaAbilityCandidate> collectPlayableManaAbilities(final SpellAbility saBeingPaid) {
        final List<ManaAbilityCandidate> out = new ArrayList<>();
        final CardCollectionView manaSources = CardCollection.combine(
                payer.getCardsIn(ZoneType.Battlefield),
                payer.getCardsIn(ZoneType.Hand));

        int sourceOrder = 0;
        for (final Card source : manaSources) {
            for (final SpellAbility manaAbility : source.getManaAbilities()) {
                if (!manaAbility.isManaAbility()) {
                    continue;
                }
                if (manaAbility.getPayCosts() != null && manaAbility.getPayCosts().hasManaCost()) {
                    // Keep auto-pay non-recursive and deterministic.
                    continue;
                }
                manaAbility.setActivatingPlayer(payer);
                if (!manaAbility.canPlay() || !manaAbility.checkRestrictions(payer)) {
                    continue;
                }
                if (manaAbility.getManaPart() == null) {
                    continue;
                }
                if (!manaAbility.getManaPart().meetsManaRestrictions(saBeingPaid)) {
                    continue;
                }
                if (manaAbility.getPayCosts() != null
                        && !CostPayment.canPayAdditionalCosts(manaAbility.getPayCosts(), manaAbility, false, payer)) {
                    continue;
                }
                if (!canPayWithReservedSacrifices(manaAbility)) {
                    continue;
                }
                out.add(new ManaAbilityCandidate(manaAbility, sourceOrder++));
            }
        }
        // Sort candidates so lands are tapped before non-land creatures.
        // Mirrors Rust's sort_mana_abilities / score_mana_producing_card which
        // assigns lower scores to lands and higher scores to creatures that can
        // attack/block.  Without this sort, battlefield insertion order can cause
        // a creature mana-dork to be tapped for a cost that lands could pay,
        // leaving the dork unavailable for a later spell that needs its colors.
        out.sort(Comparator.comparingInt(ManaAbilityCandidate::score));
        return out;
    }

    private boolean canPayWithReservedSacrifices(final SpellAbility manaAbility) {
        final Cost payCosts = manaAbility.getPayCosts();
        if (payCosts == null) {
            return true;
        }

        final Set<Card> reserved = costPlumbing.currentReservedSacrifices();
        if (reserved.isEmpty()) {
            return true;
        }

        final Card source = manaAbility.getHostCard();
        for (final CostPart part : payCosts.getCostParts()) {
            if (!(part instanceof forge.game.cost.CostSacrifice)) {
                continue;
            }
            final forge.game.cost.CostSacrifice sacrifice = (forge.game.cost.CostSacrifice) part;

            if (sacrifice.payCostFromSource()) {
                if (reserved.contains(source)) {
                    return false;
                }
                continue;
            }

            if ("OriginalHost".equals(sacrifice.getType())) {
                final Card originalHost = manaAbility.getOriginalHost();
                if (originalHost != null && reserved.contains(originalHost)) {
                    return false;
                }
                continue;
            }

            CardCollection valid = new CardCollection(CardLists.getValidCards(
                    payer.getCardsIn(ZoneType.Battlefield),
                    sacrifice.getType().split(";"),
                    payer,
                    source,
                    manaAbility));
            valid = new CardCollection(CardLists.filter(
                    valid,
                    CardPredicates.canBeSacrificedBy(manaAbility, false)));
            valid.removeIf(reserved::contains);

            final int amount = sacrifice.getAbilityAmount(manaAbility);
            if ("All".equalsIgnoreCase(sacrifice.getAmount())) {
                continue;
            }
            if (valid.size() < amount) {
                return false;
            }
        }

        return true;
    }

    private List<Byte> producedAtoms(final SpellAbility manaAbility) {
        final List<Byte> out = new ArrayList<>();
        final AbilityManaPart manaPart = manaAbility.getManaPart();
        if (manaPart == null) {
            return out;
        }
        // ManaReflected abilities report origProduced="1" which doesn't map to
        // any color atom.  Use getReflectableManaColors to determine which colors
        // the reflected ability can actually produce.  The set returned by
        // getReflectableManaColors is a HashSet, so iteration order depends on
        // JVM bucket layout — iterate the canonical WUBRG(C) order instead so
        // that downstream auto-pay choices (notably preferredColorForShard's
        // first-atom pick for generic shards) are deterministic and match Rust.
        if (manaAbility.getApi() == ApiType.ManaReflected) {
            final java.util.Set<String> reflectable = CardUtil.getReflectableManaColors(manaAbility);
            for (final String colorName : MagicColor.Constant.COLORS_AND_COLORLESS) {
                if (!reflectable.contains(colorName)) {
                    continue;
                }
                final byte atom = MagicColor.fromName(colorName);
                if (atom != 0) {
                    addDistinct(out, atom);
                }
            }
            return out;
        }
        final String produced = manaPart.mana(manaAbility);
        for (final String token : produced.split(" ")) {
            final String t = token.trim();
            if (t.isEmpty()) {
                continue;
            }
            if ("Any".equalsIgnoreCase(t)) {
                addDistinct(out, (byte) ManaAtom.WHITE);
                addDistinct(out, (byte) ManaAtom.BLUE);
                addDistinct(out, (byte) ManaAtom.BLACK);
                addDistinct(out, (byte) ManaAtom.RED);
                addDistinct(out, (byte) ManaAtom.GREEN);
                continue;
            }
            final byte atom = ManaAtom.fromName(t);
            if (atom != 0) {
                addDistinct(out, atom);
            }
        }
        return out;
    }

    private static void addDistinct(final List<Byte> atoms, final byte atom) {
        if (!atoms.contains(atom)) {
            atoms.add(atom);
        }
    }

    private static String shortColor(final byte atom) {
        if (atom == ManaAtom.WHITE) return "W";
        if (atom == ManaAtom.BLUE) return "U";
        if (atom == ManaAtom.BLACK) return "B";
        if (atom == ManaAtom.RED) return "R";
        if (atom == ManaAtom.GREEN) return "G";
        return "C";
    }

    private static final class ManaAbilityCandidate {
        private final SpellAbility spellAbility;
        private final int sourceOrder;

        private ManaAbilityCandidate(final SpellAbility spellAbility, final int sourceOrder) {
            this.spellAbility = spellAbility;
            this.sourceOrder = sourceOrder;
        }

        /**
         * Score for sorting — lower scores are tapped first.
         * Mirrors Rust's score_mana_producing_card: lands get a low base
         * score while creatures add +13 per combat role (attack/block).
         * This ensures lands are consumed before valuable mana dorks.
         */
        int score() {
            final Card source = spellAbility.getHostCard();
            int s = 0;

            // Mana ability intrinsic score (mirrors Rust score_mana_ability).
            final AbilityManaPart manaPart = spellAbility.getManaPart();
            if (manaPart != null) {
                if (manaPart.isAnyMana()) {
                    s += 7;
                } else {
                    final String produced = manaPart.mana(spellAbility);
                    s += produced.split("\\s+").length;
                    if (!produced.contains("C")) {
                        s += 1;
                    }
                }
            } else {
                s += 1;
            }

            // Cost complexity (tap = +1 per cost part in Rust).
            if (spellAbility.getPayCosts() != null) {
                s += spellAbility.getPayCosts().getCostParts().size();
            }

            // Creatures that can participate in combat are more valuable
            // and should be preserved — mirrors Rust's +13 per role.
            if (source.isCreature()) {
                s += 13; // can_attack equivalent
                s += 13; // can_block equivalent
            }

            // Tie-break by battlefield insertion order for determinism.
            // sourceOrder is a small int, multiply by a tiny factor so it
            // only breaks ties without overwhelming the primary score.
            s = s * 1000 + sourceOrder;
            return s;
        }

        String describeStep() {
            final Card source = spellAbility.getHostCard();
            final int abilityIndex = source == null ? -1 : source.getManaAbilities().indexOf(spellAbility);
            final AbilityManaPart manaPart = spellAbility.getManaPart();
            final String expressChoice = manaPart == null ? null : manaPart.getExpressChoice();
            final String action = source != null && source.isLand() ? "TapLand" : "ActivateManaAbility";
            final String express = expressChoice == null || expressChoice.isEmpty()
                    ? "null"
                    : expressChoice;
            final String sourceLabel = source == null
                    ? "null"
                    : source.getName() + "@" + ParityCardMap.parityId(source);
            return action + " { card: " + sourceLabel
                    + ", mana_ability_index: " + abilityIndex
                    + ", express_choice: " + express + " }";
        }
    }

    static final class PayManaCostResult {
        private final boolean paid;
        private final List<String> steps;

        private PayManaCostResult(final boolean paid, final List<String> steps) {
            this.paid = paid;
            this.steps = steps;
        }

        boolean paid() {
            return paid;
        }

        List<String> steps() {
            return steps;
        }
    }
}
