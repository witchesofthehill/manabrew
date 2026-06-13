package forge.harness.common;

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

public final class AutoPay {
    private final Player payer;
    private final HarnessCostPlumbing costPlumbing;
    private final boolean useManaCostManaAbilities;

    public AutoPay(final Player payer, final HarnessCostPlumbing costPlumbing) {
        this(payer, costPlumbing, false);
    }

    public AutoPay(
            final Player payer, final HarnessCostPlumbing costPlumbing, final boolean useManaCostManaAbilities) {
        this.payer = payer;
        this.costPlumbing = costPlumbing;
        this.useManaCostManaAbilities = useManaCostManaAbilities;
    }

    public PayManaCostResult payManaCostWithTrace(final ManaCost toPay, final SpellAbility saBeingPaid, final boolean effect) {
        final ManaCostBeingPaid unpaid = new ManaCostBeingPaid(toPay);
        final ManaPool pool = payer.getManaPool();
        final List<Mana> spentFromPool = new ArrayList<>();
        final List<String> steps = new ArrayList<>();

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

            final ManaAbilityCandidate chosen = chooseCandidate(unpaid, candidates, saBeingPaid);
            if (chosen == null) {
                break;
            }

            if (!payAbilityActivationCosts(chosen.spellAbility, effect)) {
                candidates.remove(chosen);
                continue;
            }

            steps.add(chosen.describeStep());

            payer.getGame().getStack().addAndUnfreeze(chosen.spellAbility);

            pool.payManaFromAbility(saBeingPaid, unpaid, chosen.spellAbility);
            pool.payManaCostFromPool(unpaid, saBeingPaid, false, spentFromPool);
        }

        // Pay remaining phyrexian (or PayLifeInsteadOf:B black) shards with life (2 each).
        // Matches ComputerUtilMana.payManaCost() phyrexian handling.
        while (!unpaid.isPaid()) {
            boolean foundPhyrexian = false;
            boolean foundLifeInsteadBlack = false;
            for (final ManaCostShard s : unpaid.getUnpaidShards()) {
                if (s.isPhyrexian()) {
                    foundPhyrexian = true;
                    break;
                }
                if (s.isBlack() && payer.hasKeyword("PayLifeInsteadOf:B")) {
                    foundLifeInsteadBlack = true;
                }
            }
            if (!foundPhyrexian && !foundLifeInsteadBlack) {
                break;
            }
            if (!payer.canPayLife(2, false, saBeingPaid)) {
                break;
            }
            if (foundPhyrexian) {
                unpaid.payPhyrexian();
                saBeingPaid.setSpendPhyrexianMana(true);
            } else {
                unpaid.decreaseShard(ManaCostShard.BLACK, 1);
            }
            payer.payLife(2, saBeingPaid, false);
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

    public boolean payManaCost(final ManaCost toPay, final SpellAbility saBeingPaid, final boolean effect) {
        return payManaCostWithTrace(toPay, saBeingPaid, effect).paid;
    }

    public List<SpellAbility> manaSources(final SpellAbility saBeingPaid) {
        final List<SpellAbility> out = new ArrayList<>();
        for (final ManaAbilityCandidate candidate : collectPlayableManaAbilities(saBeingPaid)) {
            out.add(candidate.spellAbility);
        }
        return out;
    }

    public boolean floatManaFromSource(final SpellAbility manaAbility, final boolean effect) {
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
            final List<ManaAbilityCandidate> candidates,
            final SpellAbility saBeingPaid
    ) {
        for (final ManaCostShard shard : shardPriority(unpaid, candidates, saBeingPaid)) {
            final ManaAbilityCandidate match = chooseLeastVersatileCandidate(candidates, shard, unpaid, saBeingPaid);
            if (match != null) {
                configureExpressChoiceForShard(match.spellAbility, shard);
                return match;
            }
        }
        return null;
    }

    private List<ManaCostShard> shardPriority(
            final ManaCostBeingPaid unpaid,
            final List<ManaAbilityCandidate> candidates,
            final SpellAbility saBeingPaid
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
        colored.sort(Comparator
                .comparingInt((ManaCostShard shard) -> countCandidatesForShard(candidates, shard, saBeingPaid))
                .thenComparingInt(ParityOrder::colorShardRank));
        if (generic != null) {
            colored.add(generic);
        }
        return colored;
    }

    private int countCandidatesForShard(
            final List<ManaAbilityCandidate> candidates, final ManaCostShard shard, final SpellAbility saBeingPaid) {
        int count = 0;
        for (final ManaAbilityCandidate c : candidates) {
            if (canPayShard(c.spellAbility, shard, saBeingPaid)) {
                count++;
            }
        }
        return count;
    }

    private ManaAbilityCandidate chooseLeastVersatileCandidate(
            final List<ManaAbilityCandidate> candidates,
            final ManaCostShard shard,
            final ManaCostBeingPaid unpaid,
            final SpellAbility saBeingPaid
    ) {
        ManaAbilityCandidate fallback = null;

        for (final ManaAbilityCandidate c : candidates) {
            if (!canPayShard(c.spellAbility, shard, saBeingPaid)) {
                continue;
            }
            if (fallback == null) {
                fallback = c;
            }
            if (!isSoleSourceForOtherShard(c, shard, candidates, unpaid, saBeingPaid)) {
                return c;
            }
        }
        return fallback;
    }

    private boolean isSoleSourceForOtherShard(
            final ManaAbilityCandidate candidate,
            final ManaCostShard currentShard,
            final List<ManaAbilityCandidate> candidates,
            final ManaCostBeingPaid unpaid,
            final SpellAbility saBeingPaid
    ) {
        final Set<ManaCostShard> seen = new LinkedHashSet<>();
        for (final ManaCostShard other : unpaid.getUnpaidShards()) {
            if (other == currentShard || other == ManaCostShard.GENERIC || other == ManaCostShard.X) {
                continue;
            }
            if (!seen.add(other)) {
                continue;
            }
            if (!canPayShard(candidate.spellAbility, other, saBeingPaid)) {
                continue;
            }
            int sourcesForOther = 0;
            for (final ManaAbilityCandidate alt : candidates) {
                if (canPayShard(alt.spellAbility, other, saBeingPaid)) {
                    sourcesForOther++;
                    if (sourcesForOther > 1) {
                        break;
                    }
                }
            }
            if (sourcesForOther <= 1) {
                return true;
            }
        }
        return false;
    }

    private boolean canPayShard(final SpellAbility manaAbility, final ManaCostShard shard, final SpellAbility saBeingPaid) {
        if (shard == ManaCostShard.X) {
            return false;
        }
        final AbilityManaPart manaPart = manaAbility.getManaPart();
        if (manaPart == null) {
            return false;
        }
        if (!manaPart.meetsManaRestrictions(saBeingPaid)) {
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
                manaAbility.setActivatingPlayer(payer);
                if (!manaAbility.canPlay() || !manaAbility.checkRestrictions(payer)) {
                    continue;
                }
                if (manaAbility.getManaPart() == null) {
                    continue;
                }
                if (!useManaCostManaAbilities
                        && manaAbility.getPayCosts() != null
                        && manaAbility.getPayCosts().hasManaCost()) {
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

        int score() {
            final Card source = spellAbility.getHostCard();
            int s = 0;

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

            if (spellAbility.getPayCosts() != null) {
                s += spellAbility.getPayCosts().getCostParts().size();
            }

            if (source.isCreature()) {
                s += 13; // can_attack equivalent
                s += 13; // can_block equivalent
            }

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

    public static final class PayManaCostResult {
        private final boolean paid;
        private final List<String> steps;

        private PayManaCostResult(final boolean paid, final List<String> steps) {
            this.paid = paid;
            this.steps = steps;
        }

        public boolean paid() {
            return paid;
        }

        public List<String> steps() {
            return steps;
        }
    }
}
