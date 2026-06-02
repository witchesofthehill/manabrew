package forge.harness.common;

import forge.ai.ComputerUtilMana;
import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.spellability.TargetRestrictions;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.cost.CostSacrifice;
import forge.game.zone.ZoneType;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class ActionSpace {
    private ActionSpace() {}

    private static String actionBaseLabel(final SpellAbility sa) {
        final String kind = sa.isCycling() ? "CYCLE"
                : (sa.isLandAbility() ? "LAND"
                : (sa.isSpell() ? "SPELL" : (sa.isManaAbility() ? "MANA" : "AB")));
        final String fbTag = sa.isFlashback() ? "[FB]" : "";
        final String hostName = sa.getHostCard().getName();
        final String faceName = sa.getCardState() == null ? hostName : sa.getCardState().getName();
        final String name = faceName == null || faceName.isBlank() || faceName.equals(hostName)
                ? hostName
                : hostName + "|" + faceName;
        return kind + ":" + name + fbTag;
    }

    public static List<String> buildMainActionLabels(final List<SpellAbility> actions) {
        final List<String> baseLabels = new ArrayList<>(actions.size());
        for (final SpellAbility sa : actions) {
            baseLabels.add(actionBaseLabel(sa));
        }

        final Map<String, Integer> totals = new HashMap<>();
        for (int i = 0; i < actions.size(); i++) {
            final SpellAbility sa = actions.get(i);
            final String key = baseLabels.get(i) + "|" + ParityCardMap.parityId(sa.getHostCard());
            totals.put(key, totals.getOrDefault(key, 0) + 1);
        }

        final Map<String, Integer> seen = new HashMap<>();
        final List<String> out = new ArrayList<>(actions.size());
        for (int i = 0; i < actions.size(); i++) {
            final SpellAbility sa = actions.get(i);
            final String base = baseLabels.get(i);
            final String key = base + "|" + ParityCardMap.parityId(sa.getHostCard());
            final int total = totals.getOrDefault(key, 1);
            final String withCostSuffix;
            if (total <= 1) {
                withCostSuffix = base;
            } else {
                final int idx = seen.getOrDefault(key, 0) + 1;
                seen.put(key, idx);
                withCostSuffix = base + "$" + idx;
            }
            out.add(withCostSuffix + "@" + ParityCardMap.parityId(sa.getHostCard()));
        }
        return out;
    }

    public static List<SpellAbility> getPossibleActions(final Player player, final boolean includeManaAbilities) {
        final Game game = player.getGame();
        final Set<Card> candidates = new LinkedHashSet<>();

        candidates.addAll(player.getCardsIn(ZoneType.Hand));
        candidates.addAll(player.getCardsIn(ZoneType.Battlefield));
        candidates.addAll(player.getCardsIn(ZoneType.Graveyard));
        candidates.addAll(player.getCardsIn(ZoneType.Exile));
        candidates.addAll(player.getCardsIn(ZoneType.Command));

        candidates.addAll(game.getCardsIn(ZoneType.Battlefield));
        candidates.addAll(game.getCardsIn(ZoneType.Exile));
        candidates.addAll(game.getCardsIn(ZoneType.Command));

        for (final Player p : game.getPlayers()) {
            final CardCollectionView lib = p.getCardsIn(ZoneType.Library);
            if (!lib.isEmpty()) {
                candidates.add(lib.get(0));
            }
            if (p != player) {
                p.getZone(ZoneType.Graveyard)
                        .getCardsPlayerCanActivate(player)
                        .forEach(candidates::add);
            }
        }

        final List<SpellAbility> actions = new ArrayList<>();
        for (final Card c : candidates) {
            for (final SpellAbility sa : c.getAllPossibleAbilities(player, true)) {
                sa.setActivatingPlayer(player);
                final boolean hasManaCost = sa.getPayCosts() != null && sa.getPayCosts().hasManaCost();
                final Set<Card> reservedSacrifices = getFixedReservedSacrifices(sa);
                final boolean canPayMana = !hasManaCost
                        || (reservedSacrifices.isEmpty()
                        ? ComputerUtilMana.canPayManaCost(sa, player, 0, false)
                        : canPayManaCostWithReservedSacrifices(sa, player, reservedSacrifices));
                final boolean validTargets = hasValidTargets(sa);
                // SpellAbility.canPlay() uses Cost.canPay(), and CostPartMana.canPay()
                // is permissive in engine core. Add an explicit mana-feasibility check.
                if (!canPayMana) {
                    continue;
                }
                if (!includeManaAbilities && sa.isManaAbility()) {
                    continue;
                }
                if (!validTargets) {
                    continue;
                }
                actions.add(sa);
            }
        }
        return actions;
    }

    public static List<Pair<GameEntity, GameObject>> getStackTargetCandidates(final SpellAbility sa) {
        final List<Pair<GameEntity, GameObject>> valid = new ArrayList<>();
        final TargetRestrictions tr = sa.getTargetRestrictions();
        if (tr == null || !tr.getZone().contains(ZoneType.Stack)) {
            return valid;
        }

        for (final SpellAbilityStackInstance si : sa.getHostCard().getGame().getStack()) {
            final SpellAbility stackSa = si.getSpellAbility();
            // CR 115.5: a spell or ability on the stack can't target itself.
            if (stackSa == sa || stackSa.getId() == sa.getId()) {
                continue;
            }
            if (!sa.canTarget(stackSa)) {
                continue;
            }
            final Card sourceCard = si.getSourceCard();
            if (sourceCard != null) {
                valid.add(ImmutablePair.of(sourceCard, stackSa));
            }
        }
        return valid;
    }

    private static Set<Card> getFixedReservedSacrifices(final SpellAbility sa) {
        final Set<Card> reserved = new LinkedHashSet<>();
        final Cost payCosts = sa.getPayCosts();
        if (payCosts == null) {
            return reserved;
        }

        for (final CostPart part : payCosts.getCostParts()) {
            if (!(part instanceof CostSacrifice)) {
                continue;
            }
            final CostSacrifice sacrifice = (CostSacrifice) part;
            if (sacrifice.payCostFromSource()) {
                reserved.add(sa.getHostCard());
            } else if ("OriginalHost".equals(sacrifice.getType()) && sa.getOriginalHost() != null) {
                reserved.add(sa.getOriginalHost());
            }
        }
        return reserved;
    }

    private static boolean canPayManaCostWithReservedSacrifices(
            final SpellAbility sa,
            final Player player,
            final Set<Card> reservedSacrifices
    ) {
        final ManaCost manaCost = sa.getPayCosts().getTotalMana();
        return canPayManaCostFromCurrentSources(manaCost, sa, player, reservedSacrifices);
    }

    public static boolean canPayManaCostFromCurrentSources(
            final ManaCost manaCost,
            final SpellAbility sa,
            final Player player,
            final Set<Card> reservedSacrifices
    ) {
        final List<Integer> sourceMasks = new ArrayList<>();

        addFloatingManaSources(player, sourceMasks);
        addBattlefieldManaSources(sa, player, reservedSacrifices == null ? Set.of() : reservedSacrifices, sourceMasks);

        return canPayManaCostFromSources(manaCost, sourceMasks);
    }

    private static void addFloatingManaSources(final Player player, final List<Integer> sourceMasks) {
        for (int i = 0; i < player.getManaPool().getAmountOfColor(MagicColor.WHITE); i++) {
            sourceMasks.add((int) ManaAtom.WHITE);
        }
        for (int i = 0; i < player.getManaPool().getAmountOfColor(MagicColor.BLUE); i++) {
            sourceMasks.add((int) ManaAtom.BLUE);
        }
        for (int i = 0; i < player.getManaPool().getAmountOfColor(MagicColor.BLACK); i++) {
            sourceMasks.add((int) ManaAtom.BLACK);
        }
        for (int i = 0; i < player.getManaPool().getAmountOfColor(MagicColor.RED); i++) {
            sourceMasks.add((int) ManaAtom.RED);
        }
        for (int i = 0; i < player.getManaPool().getAmountOfColor(MagicColor.GREEN); i++) {
            sourceMasks.add((int) ManaAtom.GREEN);
        }
        for (int i = 0; i < player.getManaPool().getAmountOfColor(MagicColor.COLORLESS); i++) {
            sourceMasks.add(0);
        }
    }

    private static void addBattlefieldManaSources(
            final SpellAbility saBeingPaid,
            final Player player,
            final Set<Card> reservedSacrifices,
            final List<Integer> sourceMasks
    ) {
        final Card excludedSource = (!saBeingPaid.isSpell() && saBeingPaid.getHostCard() != null
                && saBeingPaid.getHostCard().isInPlay())
                ? saBeingPaid.getHostCard()
                : null;

        for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
            if (card == excludedSource) {
                continue;
            }

            List<Integer> cardSourceMasks = new ArrayList<>();
            for (final SpellAbility manaAbility : card.getManaAbilities()) {
                if (!manaAbility.isManaAbility()) {
                    continue;
                }
                if (manaAbility.getPayCosts() != null && manaAbility.getPayCosts().hasManaCost()) {
                    continue;
                }
                manaAbility.setActivatingPlayer(player);
                if (!manaAbility.canPlay() || !manaAbility.checkRestrictions(player)) {
                    continue;
                }
                final AbilityManaPart manaPart = manaAbility.getManaPart();
                if (manaPart == null || !manaPart.meetsManaRestrictions(saBeingPaid)) {
                    continue;
                }
                if (manaAbility.getPayCosts() != null
                        && !forge.game.cost.CostPayment.canPayAdditionalCosts(
                        manaAbility.getPayCosts(),
                        manaAbility,
                        false,
                        player
                )) {
                    continue;
                }
                if (!canPayWithReservedSacrifices(manaAbility, player, reservedSacrifices)) {
                    continue;
                }
                cardSourceMasks = mergeAlternativeManaAbility(cardSourceMasks, producedManaMasks(manaAbility));
            }

            if (!cardSourceMasks.isEmpty()) {
                sourceMasks.addAll(cardSourceMasks);
                continue;
            }

            if (card.isLand() && !card.isTapped()) {
                final int implicitMask = implicitLandManaMask(card);
                if (implicitMask != 0) {
                    sourceMasks.add(implicitMask);
                }
            }
        }
    }

    private static List<Integer> mergeAlternativeManaAbility(
            final List<Integer> current,
            final List<Integer> candidate
    ) {
        if (candidate.isEmpty()) {
            return current;
        }
        if (current.isEmpty() || candidate.size() > current.size()) {
            return new ArrayList<>(candidate);
        }
        if (candidate.size() < current.size()) {
            return current;
        }

        final List<Integer> merged = new ArrayList<>(current.size());
        for (int i = 0; i < current.size(); i++) {
            merged.add(current.get(i) | candidate.get(i));
        }
        return merged;
    }

    private static boolean canPayWithReservedSacrifices(
            final SpellAbility manaAbility,
            final Player payer,
            final Set<Card> reserved
    ) {
        final Cost payCosts = manaAbility.getPayCosts();
        if (payCosts == null || reserved.isEmpty()) {
            return true;
        }

        final Card source = manaAbility.getHostCard();
        for (final CostPart part : payCosts.getCostParts()) {
            if (!(part instanceof CostSacrifice)) {
                continue;
            }
            final CostSacrifice sacrifice = (CostSacrifice) part;

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

            final int amount = sacrifice.getAbilityAmount(manaAbility);
            if ("All".equalsIgnoreCase(sacrifice.getAmount())) {
                continue;
            }

            final CardCollectionView valid = CardLists.filter(
                    CardLists.getValidCards(
                            payer.getCardsIn(ZoneType.Battlefield),
                            sacrifice.getType().split(";"),
                            payer,
                            source,
                            manaAbility
                    ),
                    CardPredicates.canBeSacrificedBy(manaAbility, false)
            );
            int available = 0;
            for (final Card card : valid) {
                if (!reserved.contains(card)) {
                    available++;
                }
            }
            if (available < amount) {
                return false;
            }
        }

        return true;
    }

    private static List<Integer> producedManaMasks(final SpellAbility manaAbility) {
        final List<Integer> masks = new ArrayList<>();
        final AbilityManaPart manaPart = manaAbility.getManaPart();
        if (manaPart == null) {
            return masks;
        }

        if (manaAbility.getApi() == forge.game.ability.ApiType.ManaReflected) {
            int mask = 0;
            for (final String colorName : forge.game.card.CardUtil.getReflectableManaColors(manaAbility)) {
                mask |= ManaAtom.fromName(colorName);
            }
            if (mask != 0) {
                masks.add(mask);
            }
            return masks;
        }

        final String produced = manaPart.mana(manaAbility);
        int comboMask = 0;
        for (final String token : produced.split(" ")) {
            final String t = token.trim();
            if (t.isEmpty()) {
                continue;
            }
            final int tokenMask;
            if ("Any".equalsIgnoreCase(t)) {
                tokenMask = ManaAtom.WHITE | ManaAtom.BLUE | ManaAtom.BLACK | ManaAtom.RED | ManaAtom.GREEN;
            } else {
                tokenMask = ManaAtom.fromName(t);
            }
            if (tokenMask == 0) {
                continue;
            }
            if (manaPart.isComboMana()) {
                comboMask |= tokenMask;
            } else {
                masks.add(tokenMask);
            }
        }
        if (comboMask != 0) {
            masks.add(comboMask);
        }
        return masks;
    }

    private static int implicitLandManaMask(final Card card) {
        int mask = 0;
        if (card.getType().hasSubtype("Plains")) {
            mask |= ManaAtom.WHITE;
        }
        if (card.getType().hasSubtype("Island")) {
            mask |= ManaAtom.BLUE;
        }
        if (card.getType().hasSubtype("Swamp")) {
            mask |= ManaAtom.BLACK;
        }
        if (card.getType().hasSubtype("Mountain")) {
            mask |= ManaAtom.RED;
        }
        if (card.getType().hasSubtype("Forest")) {
            mask |= ManaAtom.GREEN;
        }
        return mask;
    }

    private static boolean canPayManaCostFromSources(final ManaCost cost, final List<Integer> sourceMasks) {
        final List<Integer> requirements = new ArrayList<>();
        for (final ManaCostShard shard : cost) {
            if (shard == ManaCostShard.X) {
                continue;
            }
            final int colorMask = shard.getColorMask();
            if (colorMask != 0) {
                requirements.add(colorMask);
            }
        }
        final int genericCount = cost.getGenericCost();
        if (sourceMasks.size() < requirements.size() + genericCount) {
            return false;
        }

        requirements.sort((a, b) -> {
            final long countA = sourceMasks.stream().filter(src -> (src & a) != 0).count();
            final long countB = sourceMasks.stream().filter(src -> (src & b) != 0).count();
            if (countA != countB) {
                return Long.compare(countA, countB);
            }
            return Integer.compare(a, b);
        });

        final Set<Integer> committed = new HashSet<>();
        for (final int requirement : requirements) {
            int bestIndex = -1;
            int bestPop = Integer.MAX_VALUE;
            int bestMask = Integer.MAX_VALUE;
            for (int i = 0; i < sourceMasks.size(); i++) {
                if (committed.contains(i)) {
                    continue;
                }
                final int sourceMask = sourceMasks.get(i);
                if ((sourceMask & requirement) == 0) {
                    continue;
                }
                final int pop = Integer.bitCount(sourceMask);
                if (pop < bestPop || (pop == bestPop && sourceMask < bestMask)) {
                    bestIndex = i;
                    bestPop = pop;
                    bestMask = sourceMask;
                }
            }
            if (bestIndex < 0) {
                return false;
            }
            committed.add(bestIndex);
        }

        return sourceMasks.size() - committed.size() >= genericCount;
    }

    private static boolean hasValidTargets(final SpellAbility sa) {
        SpellAbility current = sa;
        while (current != null) {
            if (current.usesTargeting()) {
                // Avoid stale target selections mutating candidate counts across repeated action-space scans.
                current.resetTargets();
                final TargetRestrictions tr = current.getTargetRestrictions();
                if (tr == null) {
                    return false;
                }
                final int minTargets = current.getMinTargets();
                if (minTargets > 0) {
                    final List<GameEntity> candidates = tr.getAllCandidates(current, true);
                    final List<Pair<GameEntity, GameObject>> stackCandidates = getStackTargetCandidates(current);
                    boolean hasEnoughCandidates = candidates.size() + stackCandidates.size() >= minTargets;
                    if (tr.isDifferentControllers() || tr.isForEachPlayer()) {
                        final Set<Player> controllers = new HashSet<>();
                        for (final GameEntity candidate : candidates) {
                            if (candidate instanceof Card) {
                                controllers.add(((Card) candidate).getController());
                            }
                        }
                        for (final Pair<GameEntity, GameObject> candidate : stackCandidates) {
                            if (candidate.getLeft() instanceof Card) {
                                controllers.add(((Card) candidate.getLeft()).getController());
                            }
                        }
                        hasEnoughCandidates &= controllers.size() >= minTargets;
                    }
                    if (!hasEnoughCandidates) {
                        return false;
                    }
                }
            }
            current = current.getSubAbility();
        }
        return true;
    }
}
