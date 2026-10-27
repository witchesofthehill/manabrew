package forge.harness.common;

import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.game.ability.ApiType;
import forge.game.card.Card;
import forge.game.combat.CombatUtil;
import forge.game.cost.Cost;
import forge.game.cost.CostPayment;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

final class MaybePay {
    private static final int MAX_CONVERTER_COMBINATIONS = 64;

    private final Player player;
    private List<Integer> floating;
    private List<ManaSourceCard> cards;

    MaybePay(final Player player) {
        this.player = player;
    }

    boolean canPay(final ManaCostBeingPaid cost, final SpellAbility sa) {
        final List<Integer> needs = manaNeeds(cost, sa, player);
        if (needs.isEmpty()) {
            return true;
        }
        final List<Integer> base = new ArrayList<>(floating());
        final List<List<ManaOption>> converterCards = new ArrayList<>();
        int bound = base.size();
        for (final CardChoices card : choicesFor(sa, null)) {
            if (card.choices.size() == 1) {
                base.addAll(card.plainUnits());
                bound += card.plainUnits().size();
                continue;
            }
            converterCards.add(card.choices);
            bound += bestNetOption(card.choices).net();
        }
        if (bound < needs.size()) {
            return false;
        }
        limitCombinations(converterCards);

        final int[] picks = new int[converterCards.size()];
        do {
            if (canPayWithConverters(needs, base, converterCards, picks)) {
                return true;
            }
        } while (nextPicks(picks, converterCards));
        return false;
    }

    boolean hasConverters() {
        for (final ManaSourceCard source : cards()) {
            for (final ManaOption option : source.options) {
                if (!option.costNeeds.isEmpty()) {
                    return true;
                }
            }
        }
        return false;
    }

    List<Activation> plan(final ManaCostBeingPaid cost, final SpellAbility sa, final Collection<Card> only) {
        final List<Integer> needs = manaNeeds(cost, sa, player);
        if (needs.isEmpty()) {
            return List.of();
        }
        final List<CardChoices> cardChoices = choicesFor(sa, only);
        final List<Integer> converterIndexes = new ArrayList<>();
        final List<List<ManaOption>> converterChoices = new ArrayList<>();
        for (int i = 0; i < cardChoices.size(); i++) {
            if (cardChoices.get(i).choices.size() > 1) {
                converterIndexes.add(i);
                converterChoices.add(cardChoices.get(i).choices);
            }
        }
        limitCombinations(converterChoices);

        PlanCandidate best = null;
        final int[] picks = new int[converterChoices.size()];
        do {
            final PlanCandidate candidate =
                    cheapestPlan(needs, cardChoices, converterIndexes, converterChoices, picks);
            if (candidate != null && (best == null || candidate.compareTo(best) < 0)) {
                best = candidate;
            }
        } while (nextPicks(picks, converterChoices));
        return best == null ? null : best.activations(cardChoices);
    }

    private PlanCandidate cheapestPlan(
            final List<Integer> needs,
            final List<CardChoices> cardChoices,
            final List<Integer> converterIndexes,
            final List<List<ManaOption>> converterChoices,
            final int[] picks
    ) {
        final ManaMatching matching = new ManaMatching();
        matching.addNeeds(needs, -1);
        final ManaOption[] chosen = new ManaOption[cardChoices.size()];
        final List<ManaOption> active = new ArrayList<>();
        int tapCost = 0;
        for (int i = 0; i < picks.length; i++) {
            final ManaOption option = converterChoices.get(i).get(picks[i]);
            if (option.costNeeds.isEmpty()) {
                continue;
            }
            final int card = converterIndexes.get(i);
            chosen[card] = option;
            matching.addNeeds(option.costNeeds, card);
            matching.addUnits(option.produced, card, card);
            active.add(option);
            tapCost += cardChoices.get(card).source.tapCost();
        }

        final List<Integer> optional = new ArrayList<>();
        for (int card = 0; card < cardChoices.size(); card++) {
            if (chosen[card] == null && !cardChoices.get(card).plainUnits().isEmpty()) {
                optional.add(card);
            }
        }
        optional.sort(Comparator.comparingInt(card -> cardChoices.get(card).source.tapCost()));

        int matched = matching.maximumMatching();
        int plainUnits = 0;
        for (final int card : optional) {
            if (matched == matching.needCount()) {
                break;
            }
            final List<Integer> units = cardChoices.get(card).plainUnits();
            matching.addUnits(units, -1, card);
            final int next = matching.maximumMatching();
            if (next > matched) {
                matched = next;
                chosen[card] = cardChoices.get(card).choices.get(0);
                tapCost += cardChoices.get(card).source.tapCost();
                plainUnits += units.size();
            } else {
                matching.removeLastUnits(units.size());
            }
        }
        if (matched < matching.needCount() || !hasActivationOrder(plainUnits, active)) {
            return null;
        }
        matching.maximumMatching();
        return new PlanCandidate(tapCost, chosen, matching);
    }

    private boolean canPayWithConverters(
            final List<Integer> needs,
            final List<Integer> base,
            final List<List<ManaOption>> converterCards,
            final int[] picks
    ) {
        final ManaMatching matching = new ManaMatching();
        matching.addNeeds(needs, -1);
        matching.addUnits(base, -1, -1);
        final List<ManaOption> active = new ArrayList<>();
        int plainUnits = base.size();
        for (int i = 0; i < picks.length; i++) {
            final ManaOption option = converterCards.get(i).get(picks[i]);
            if (option.costNeeds.isEmpty()) {
                matching.addUnits(option.produced, -1, -1);
                plainUnits += option.produced.size();
            } else {
                matching.addNeeds(option.costNeeds, i);
                matching.addUnits(option.produced, i, -1);
                active.add(option);
            }
        }
        return matching.unitCount() >= matching.needCount()
                && hasActivationOrder(plainUnits, active)
                && matching.maximumMatching() == matching.needCount();
    }

    private List<CardChoices> choicesFor(final SpellAbility sa, final Collection<Card> only) {
        final Card tappedHost = sa.getPayCosts() != null && sa.getPayCosts().hasTapCost() ? sa.getHostCard() : null;
        final List<CardChoices> out = new ArrayList<>();
        for (final ManaSourceCard source : cards()) {
            if (source.card == tappedHost || (only != null && !only.contains(source.card))) {
                continue;
            }
            final List<ManaOption> plainOptions = new ArrayList<>();
            List<Integer> plain = new ArrayList<>();
            final List<ManaOption> choices = new ArrayList<>();
            for (final ManaOption option : source.options) {
                if (option.ability != null && !option.ability.getManaPart().meetsManaRestrictions(sa)) {
                    continue;
                }
                if (option.costNeeds.isEmpty()) {
                    plainOptions.add(option);
                    plain = ActionSpace.mergeAlternativeManaAbility(plain, option.produced);
                } else {
                    choices.add(option);
                }
            }
            choices.add(0, new ManaOption(null, plain, List.of()));
            out.add(new CardChoices(source, plainOptions, choices));
        }
        return out;
    }

    private static void limitCombinations(final List<List<ManaOption>> converterChoices) {
        long combinations = 1;
        for (final List<ManaOption> choices : converterChoices) {
            combinations = Math.min(combinations * choices.size(), MAX_CONVERTER_COMBINATIONS + 1);
        }
        if (combinations > MAX_CONVERTER_COMBINATIONS) {
            converterChoices.replaceAll(choices -> List.of(bestNetOption(choices)));
        }
    }

    private static boolean nextPicks(final int[] picks, final List<List<ManaOption>> converterChoices) {
        for (int i = 0; i < picks.length; i++) {
            if (++picks[i] < converterChoices.get(i).size()) {
                return true;
            }
            picks[i] = 0;
        }
        return false;
    }

    private static ManaOption bestNetOption(final List<ManaOption> choices) {
        ManaOption best = choices.get(0);
        for (final ManaOption option : choices) {
            if (option.net() >= best.net()) {
                best = option;
            }
        }
        return best;
    }

    private static boolean hasActivationOrder(final int plainUnits, final List<ManaOption> active) {
        final List<ManaOption> order = new ArrayList<>(active);
        order.sort(Comparator.comparing((ManaOption option) -> option.net() < 0)
                .thenComparingInt(option -> option.net() < 0
                        ? -option.produced.size()
                        : option.costNeeds.size()));
        int available = plainUnits;
        for (final ManaOption option : order) {
            if (available < option.costNeeds.size()) {
                return false;
            }
            available += option.net();
        }
        return true;
    }

    private static List<Integer> manaNeeds(
            final ManaCostBeingPaid cost, final SpellAbility sa, final Player player) {
        final List<ManaCostShard> shards = cost.getUnpaidShards();
        int phyrexian = 0;
        for (final ManaCostShard shard : shards) {
            if (shard.isPhyrexian()) {
                phyrexian++;
            }
        }
        final boolean lifeForPhyrexian = phyrexian > 0 && player.canPayLife(2 * phyrexian, false, sa);
        final List<Integer> needs = new ArrayList<>();
        for (final ManaCostShard shard : shards) {
            if (shard == ManaCostShard.X || (lifeForPhyrexian && shard.isPhyrexian())) {
                continue;
            }
            needs.add(shard.isGeneric() ? ManaAtom.ALL_MANA_TYPES : shard.getShard() & ManaAtom.ALL_MANA_TYPES);
        }
        return needs;
    }

    private List<Integer> floating() {
        if (floating == null) {
            floating = new ArrayList<>();
            ActionSpace.addFloatingManaSources(player, floating);
        }
        return floating;
    }

    private List<ManaSourceCard> cards() {
        if (cards == null) {
            cards = collectManaSourceCards();
        }
        return cards;
    }

    private List<ManaSourceCard> collectManaSourceCards() {
        final List<ManaSourceCard> out = new ArrayList<>();
        for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
            final List<ManaOption> options = new ArrayList<>();
            for (final SpellAbility manaAbility : card.getManaAbilities()) {
                if (!manaAbility.isManaAbility() || manaAbility.getManaPart() == null) {
                    continue;
                }
                manaAbility.setActivatingPlayer(player);
                if (!manaAbility.canPlay() || !manaAbility.checkRestrictions(player)) {
                    continue;
                }
                final Cost cost = manaAbility.getPayCosts();
                if (cost != null && !CostPayment.canPayAdditionalCosts(cost, manaAbility, false, player)) {
                    continue;
                }
                final ManaCost manaCost = cost == null || !cost.hasManaCost() ? ManaCost.ZERO : cost.getTotalMana();
                if (manaCost.countX() > 0) {
                    continue;
                }
                final List<Integer> produced = ActionSpace.producedManaMasks(manaAbility);
                if (!produced.isEmpty()) {
                    options.add(new ManaOption(
                            manaAbility, produced, manaNeeds(new ManaCostBeingPaid(manaCost), manaAbility, player)));
                }
            }
            if (options.isEmpty() && card.isLand() && !card.isTapped()) {
                final int implicitMask = ActionSpace.implicitLandManaMask(card);
                if (implicitMask != 0) {
                    options.add(new ManaOption(null, List.of(implicitMask), List.of()));
                }
            }
            if (!options.isEmpty()) {
                out.add(new ManaSourceCard(card, options));
            }
        }
        return out;
    }

    private static int scoreManaProducingCard(final Card card) {
        int score = 0;
        for (final SpellAbility ability : card.getSpellAbilities()) {
            ability.setActivatingPlayer(card.getController());
            if (ability.isManaAbility()) {
                score += ability.calculateScoreForManaAbility();
            } else if (!ability.isTrigger() && ability.isPossible()) {
                score += 13;
            }
        }
        if (card.isCreature()) {
            if (CombatUtil.canAttack(card)) {
                score += 13;
            }
            if (CombatUtil.canBlock(card)) {
                score += 13;
            }
        }
        return score;
    }

    static final class Activation {
        final SpellAbility ability;
        final List<Integer> colors;

        private Activation(final SpellAbility ability, final List<Integer> colors) {
            this.ability = ability;
            this.colors = colors;
        }

        boolean choosesColors() {
            final AbilityManaPart manaPart = ability.getManaPart();
            return ability.getApi() == ApiType.ManaReflected || manaPart.isAnyMana() || manaPart.isComboMana();
        }
    }

    private static final class PlanCandidate implements Comparable<PlanCandidate> {
        private final int tapCost;
        private final int tapped;
        private final int waste;
        private final ManaOption[] chosen;
        private final ManaMatching matching;

        private PlanCandidate(final int tapCost, final ManaOption[] chosen, final ManaMatching matching) {
            this.tapCost = tapCost;
            this.chosen = chosen;
            this.matching = matching;
            int count = 0;
            for (final ManaOption option : chosen) {
                if (option != null) {
                    count++;
                }
            }
            this.tapped = count;
            this.waste = matching.unitCount() - matching.needCount();
        }

        @Override
        public int compareTo(final PlanCandidate other) {
            if (tapCost != other.tapCost) {
                return Integer.compare(tapCost, other.tapCost);
            }
            if (tapped != other.tapped) {
                return Integer.compare(tapped, other.tapped);
            }
            return Integer.compare(waste, other.waste);
        }

        private List<Activation> activations(final List<CardChoices> cardChoices) {
            final List<Activation> out = new ArrayList<>();
            final boolean[] emitted = new boolean[chosen.length];
            for (int card = 0; card < chosen.length; card++) {
                if (chosen[card] != null && !chosen[card].costNeeds.isEmpty()) {
                    emit(card, cardChoices, emitted, out);
                }
            }
            for (int card = 0; card < chosen.length; card++) {
                if (chosen[card] != null) {
                    emit(card, cardChoices, emitted, out);
                }
            }
            return out;
        }

        private void emit(
                final int card,
                final List<CardChoices> cardChoices,
                final boolean[] emitted,
                final List<Activation> out
        ) {
            if (emitted[card]) {
                return;
            }
            emitted[card] = true;
            for (int need = 0; need < matching.needCount(); need++) {
                final int unit = matching.needOwner(need) == card ? matching.unitFor(need) : -1;
                if (unit >= 0) {
                    emit(matching.unitCard(unit), cardChoices, emitted, out);
                }
            }
            final List<Integer> assigned = new ArrayList<>();
            for (int unit = 0; unit < matching.unitCount(); unit++) {
                if (matching.unitCard(unit) == card) {
                    final int need = matching.needFor(unit);
                    assigned.add(need < 0 ? matching.unitMask(unit) : matching.unitMask(unit) & matching.needMask(need));
                }
            }
            if (!chosen[card].costNeeds.isEmpty()) {
                out.add(new Activation(chosen[card].ability, colorsFor(chosen[card].produced, assigned)));
                return;
            }
            final ManaOption ability = plainAbilityFor(cardChoices.get(card).plainOptions, assigned);
            if (ability != null) {
                out.add(new Activation(ability.ability, colorsFor(ability.produced, assigned)));
            }
        }

        private static ManaOption plainAbilityFor(final List<ManaOption> plainOptions, final List<Integer> assigned) {
            ManaOption best = null;
            for (final ManaOption option : plainOptions) {
                if (option.ability == null || !covers(option.produced, assigned)) {
                    continue;
                }
                if (best == null || simplicity(option.ability) < simplicity(best.ability)) {
                    best = option;
                }
            }
            return best;
        }

        private static int simplicity(final SpellAbility ability) {
            final Cost cost = ability.getPayCosts();
            return (cost == null ? 0 : cost.getCostParts().size()) + (ability.getSubAbility() == null ? 0 : 1);
        }

        private static boolean covers(final List<Integer> produced, final List<Integer> assigned) {
            final boolean[] used = new boolean[produced.size()];
            for (final int mask : assigned) {
                boolean found = false;
                for (int i = 0; i < produced.size() && !found; i++) {
                    if (!used[i] && (produced.get(i) & mask) != 0) {
                        used[i] = true;
                        found = true;
                    }
                }
                if (!found) {
                    return false;
                }
            }
            return true;
        }

        private static List<Integer> colorsFor(final List<Integer> produced, final List<Integer> assigned) {
            final List<Integer> colors = new ArrayList<>();
            for (int i = 0; i < produced.size(); i++) {
                final int mask = i < assigned.size() ? produced.get(i) & assigned.get(i) : produced.get(i);
                colors.add(pickColor(mask == 0 ? produced.get(i) : mask));
            }
            return colors;
        }

        private static int pickColor(final int mask) {
            final int colors = mask & ManaAtom.ALL_MANA_COLORS;
            return colors != 0 ? Integer.lowestOneBit(colors) : ManaAtom.COLORLESS;
        }
    }

    private static final class CardChoices {
        private final ManaSourceCard source;
        private final List<ManaOption> plainOptions;
        private final List<ManaOption> choices;

        private CardChoices(
                final ManaSourceCard source, final List<ManaOption> plainOptions, final List<ManaOption> choices) {
            this.source = source;
            this.plainOptions = plainOptions;
            this.choices = choices;
        }

        private List<Integer> plainUnits() {
            return choices.get(0).produced;
        }
    }

    private static final class ManaSourceCard {
        private final Card card;
        private final List<ManaOption> options;
        private Integer tapCost;

        private ManaSourceCard(final Card card, final List<ManaOption> options) {
            this.card = card;
            this.options = options;
        }

        private int tapCost() {
            if (tapCost == null) {
                boolean convertsOnly = true;
                for (final ManaOption option : options) {
                    convertsOnly &= !option.costNeeds.isEmpty();
                }
                tapCost = convertsOnly ? 0 : scoreManaProducingCard(card);
            }
            return tapCost;
        }
    }

    private static final class ManaOption {
        private final SpellAbility ability;
        private final List<Integer> produced;
        private final List<Integer> costNeeds;

        private ManaOption(final SpellAbility ability, final List<Integer> produced, final List<Integer> costNeeds) {
            this.ability = ability;
            this.produced = produced;
            this.costNeeds = costNeeds;
        }

        private int net() {
            return produced.size() - costNeeds.size();
        }
    }

    private static final class ManaMatching {
        private final List<Integer> needMasks = new ArrayList<>();
        private final List<Integer> needOwners = new ArrayList<>();
        private final List<Integer> unitMasks = new ArrayList<>();
        private final List<Integer> unitOwners = new ArrayList<>();
        private final List<Integer> unitCards = new ArrayList<>();
        private int[] unitNeed = new int[0];

        private void addNeeds(final List<Integer> masks, final int owner) {
            needMasks.addAll(masks);
            needOwners.addAll(Collections.nCopies(masks.size(), owner));
        }

        private void addUnits(final List<Integer> masks, final int owner, final int card) {
            unitMasks.addAll(masks);
            unitOwners.addAll(Collections.nCopies(masks.size(), owner));
            unitCards.addAll(Collections.nCopies(masks.size(), card));
        }

        private void removeLastUnits(final int count) {
            for (int i = 0; i < count; i++) {
                unitMasks.remove(unitMasks.size() - 1);
                unitOwners.remove(unitOwners.size() - 1);
                unitCards.remove(unitCards.size() - 1);
            }
        }

        private int needCount() {
            return needMasks.size();
        }

        private int unitCount() {
            return unitMasks.size();
        }

        private int needMask(final int need) {
            return needMasks.get(need);
        }

        private int needOwner(final int need) {
            return needOwners.get(need);
        }

        private int unitMask(final int unit) {
            return unitMasks.get(unit);
        }

        private int unitCard(final int unit) {
            return unitCards.get(unit);
        }

        private int needFor(final int unit) {
            return unitNeed[unit];
        }

        private int unitFor(final int need) {
            for (int unit = 0; unit < unitNeed.length; unit++) {
                if (unitNeed[unit] == need) {
                    return unit;
                }
            }
            return -1;
        }

        private int maximumMatching() {
            unitNeed = new int[unitMasks.size()];
            Arrays.fill(unitNeed, -1);
            int matched = 0;
            for (int need = 0; need < needMasks.size(); need++) {
                if (assign(need, new boolean[unitMasks.size()])) {
                    matched++;
                }
            }
            return matched;
        }

        private boolean assign(final int need, final boolean[] visited) {
            final int owner = needOwners.get(need);
            for (int unit = 0; unit < unitMasks.size(); unit++) {
                if (visited[unit]
                        || (unitMasks.get(unit) & needMasks.get(need)) == 0
                        || (owner >= 0 && owner == unitOwners.get(unit))) {
                    continue;
                }
                visited[unit] = true;
                if (unitNeed[unit] < 0 || assign(unitNeed[unit], visited)) {
                    unitNeed[unit] = need;
                    return true;
                }
            }
            return false;
        }
    }
}
