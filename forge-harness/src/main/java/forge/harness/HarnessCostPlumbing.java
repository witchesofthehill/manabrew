package forge.harness;

import forge.card.CardType;
import forge.card.ColorSet;
import forge.game.GameEntityCounterTable;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.card.CounterType;
import forge.game.cost.*;
import forge.game.player.Player;
import forge.game.player.PlayerController;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Cost-payment bridge shared by the harness controllers. Drives Forge's
 * {@link CostPayment} while routing every sub-decision back through the
 * supplied {@link PlayerController}, so the same plumbing serves both the
 * deterministic parity bot and the interactive player controller.
 */
final class HarnessCostPlumbing {
    private final PlayerController controller;
    private final Player payer;
    private final List<Set<Card>> reservedSacrificeStack = new ArrayList<>();

    HarnessCostPlumbing(final PlayerController controller, final Player payer) {
        this.controller = controller;
        this.payer = payer;
    }

    static boolean isSpellPaymentContext(final SpellAbility sa) {
        if (sa == null) {
            return false;
        }
        if (sa.isSpell()) {
            return true;
        }
        final Card host = sa.getHostCard();
        if (host != null && (host.isInstant() || host.isSorcery())) {
            return true;
        }
        final SpellAbility root = sa.getRootAbility();
        if (root != null && root.isSpell()) {
            return true;
        }
        final Card rootHost = root == null ? null : root.getHostCard();
        return rootHost != null && (rootHost.isInstant() || rootHost.isSorcery());
    }

    boolean payWithControllerDecision(final Cost cost, final SpellAbility sa, final boolean effect) {
        final Set<Card> inheritedReserved = currentReservedSacrifices();
        final Set<Card> localReserved = new LinkedHashSet<>(inheritedReserved);
        reservedSacrificeStack.add(localReserved);
        try {
            final CostPayment pay = new CostPayment(cost, sa);
            return pay.payComputerCosts(new HarnessCostDecision(payer, sa, effect));
        } finally {
            reservedSacrificeStack.remove(reservedSacrificeStack.size() - 1);
        }
    }

    Set<Card> currentReservedSacrifices() {
        if (reservedSacrificeStack.isEmpty()) {
            return Set.of();
        }
        return reservedSacrificeStack.get(reservedSacrificeStack.size() - 1);
    }

    boolean isSacrificeReserved(final Card card) {
        return currentReservedSacrifices().contains(card);
    }

    void reserveSacrifices(final Iterable<Card> cards) {
        if (reservedSacrificeStack.isEmpty()) {
            return;
        }
        final Set<Card> reserved = reservedSacrificeStack.get(reservedSacrificeStack.size() - 1);
        for (final Card card : cards) {
            if (card != null) {
                reserved.add(card);
            }
        }
    }

    private final class HarnessCostDecision extends CostDecisionMakerBase {
        HarnessCostDecision(final Player player, final SpellAbility sa, final boolean effect) {
            super(player, effect, sa, sa.getHostCard());
        }

        private boolean isMandatory() {
            final Cost payCosts = ability.getPayCosts();
            return payCosts != null && payCosts.isMandatory();
        }

        private boolean confirm(final CostPart part, final boolean shouldAsk) {
            if (!shouldAsk || ability == null || isSpellPaymentContext(ability)) {
                return true;
            }
            return controller.confirmPayment(part, part.toString(), ability);
        }

        private CardCollectionView chooseCards(final CardCollectionView pool, final int amount, final String title) {
            return controller.chooseCardsForEffect(pool, ability, title, amount, amount, false, null);
        }

        @Override
        public PaymentDecision visit(final CostAddMana cost) {
            if (!confirm(cost, true)) return null;
            return PaymentDecision.number(cost.getAbilityAmount(ability));
        }

        @Override
        public PaymentDecision visit(final CostBehold cost) {
            if (!confirm(cost, true)) return null;
            final int amount = cost.getAbilityAmount(ability);
            if (amount <= 0) {
                return null;
            }
            CardCollection pool = new CardCollection(player.getCardsIn(cost.getRevealFrom()));
            pool = new CardCollection(CardLists.getValidCards(
                    pool,
                    cost.getType().split(";"),
                    player,
                    source,
                    ability
            ));
            if (pool.size() < amount) {
                return null;
            }

            if (cost.getType().endsWith("ChosenType")) {
                final CardCollectionView firstPick = chooseCards(pool, 1, "Behold");
                if (firstPick == null || firstPick.size() != 1) {
                    return null;
                }
                final Card first = firstPick.get(0);
                final CardCollection sameType = new CardCollection(CardLists.filter(
                        pool,
                        CardPredicates.sharesCreatureTypeWith(first)));
                if (sameType.size() < amount) {
                    return null;
                }
                final CardCollectionView selected = chooseCards(sameType, amount, "Behold");
                return selected == null || selected.size() < amount
                        ? null
                        : PaymentDecision.card(selected);
            }

            final CardCollectionView selected = chooseCards(pool, amount, "Behold");
            return selected == null || selected.size() < amount
                    ? null
                    : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostBeholdExile cost) {
            return visit((CostBehold) cost);
        }

        @Override
        public PaymentDecision visit(final CostGainControl cost) {
            if (!confirm(cost, true)) return null;
            if (cost.payCostFromSource()) {
                return PaymentDecision.card(source);
            }
            final int amount = cost.getAbilityAmount(ability);
            CardCollectionView list = player.getGame().getCardsIn(ZoneType.Battlefield);
            list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
            list = CardLists.filter(list, c -> c.canBeControlledBy(player));
            if (list.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(list, amount, "Gain control for cost");
            return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostChooseColor cost) {
            final int amount = cost.getAbilityAmount(ability);
            final ColorSet chosen = controller.chooseColors("Color", ability, amount, amount, ColorSet.WUBRG);
            return PaymentDecision.colors(chosen);
        }

        @Override
        public PaymentDecision visit(final CostChooseCreatureType cost) {
            final String choice = controller.chooseSomeType("Creature", ability, CardType.getAllCreatureTypes(), true);
            return choice == null ? null : PaymentDecision.type(choice);
        }

        @Override
        public PaymentDecision visit(final CostCollectEvidence cost) {
            final CardCollection list = CardLists.filter(
                    player.getCardsIn(ZoneType.Graveyard),
                    CardPredicates.canExiledBy(ability, isEffect()));
            if (list.isEmpty()) {
                return null;
            }
            final int total = AbilityUtils.calculateAmount(source, cost.getAmount(), ability);
            final CardCollectionView selected = controller.chooseCardsForEffect(
                    list,
                    ability,
                    "Collect evidence " + total,
                    0,
                    list.size(),
                    true,
                    null);
            if (selected == null || CardLists.getTotalCMC(selected) < total) {
                return null;
            }
            return PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostDiscard cost) {
            final String t = cost.getType();
            final boolean shouldAsk = "Hand".equals(t);
            if (!confirm(cost, shouldAsk)) return null;
            CardCollectionView hand = player.getCardsIn(ZoneType.Hand);

            if ("LastDrawn".equals(t)) {
                final Card last = player.getLastDrawnCard();
                return last != null && hand.contains(last) ? PaymentDecision.card(last) : null;
            }
            if (cost.payCostFromSource()) {
                return hand.contains(source) ? PaymentDecision.card(source) : null;
            }
            if ("Hand".equals(t)) {
                if (hand.size() > 1 && ability.getActivatingPlayer() != null) {
                    hand = ability.getActivatingPlayer().getController()
                            .orderMoveToZoneList(hand, ZoneType.Graveyard, ability);
                }
                return PaymentDecision.card(hand);
            }

            String type = t;
            final int amount = cost.getAbilityAmount(ability);
            final boolean withDifferentNames = type.contains("+WithDifferentNames");
            if (withDifferentNames) {
                type = type.replace("+WithDifferentNames", "");
            }
            final boolean withSameName = type.contains("+WithSameName");
            if (withSameName) {
                type = type.replace("+WithSameName", "");
            }

            CardCollection pool = new CardCollection(hand);
            if (!"Random".equals(type) && !type.contains("X")) {
                pool = new CardCollection(CardLists.getValidCards(pool, type.split(";"), player, source, ability));
            }
            if (pool.size() < amount) {
                return null;
            }

            if (withDifferentNames) {
                final CardCollection selected = new CardCollection();
                CardCollection remaining = new CardCollection(pool);
                while (selected.size() < amount && !remaining.isEmpty()) {
                    final CardCollectionView one = chooseCards(remaining, 1, "Choose card with different name");
                    if (one == null || one.size() != 1) {
                        return null;
                    }
                    final Card choice = one.get(0);
                    selected.add(choice);
                    remaining = new CardCollection(CardLists.filter(
                            remaining,
                            CardPredicates.sharesNameWith(choice).negate()));
                }
                return selected.size() == amount ? PaymentDecision.card(selected) : null;
            }

            if (withSameName) {
                final CardCollection candidates = new CardCollection();
                for (final Card c : pool) {
                    if (CardLists.count(pool, CardPredicates.nameEquals(c.getName())) > 1) {
                        candidates.add(c);
                    }
                }
                if (candidates.size() < amount) {
                    return null;
                }
                final CardCollectionView selected = chooseCards(candidates, amount, "Choose cards with same name");
                return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
            }

            final CardCollectionView selected = chooseCards(pool, amount, "Choose cards to discard");
            if (selected == null || selected.size() < amount) {
                return null;
            }
            return PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostDamage cost) {
            if (!confirm(cost, true)) return null;
            return PaymentDecision.number(cost.getAbilityAmount(ability));
        }

        @Override
        public PaymentDecision visit(final CostDraw cost) {
            if (!confirm(cost, true)) return null;
            if (!cost.canPay(ability, player, isEffect())) {
                return null;
            }
            final int amount = cost.getAbilityAmount(ability);
            final List<Player> potential = new ArrayList<>(cost.getPotentialPlayers(player, ability));
            final PaymentDecision pd = PaymentDecision.players(potential);
            pd.c = amount;
            return pd;
        }

        @Override
        public PaymentDecision visit(final CostExile cost) {
            final boolean fromLibrary =
                    cost.getFrom().size() == 1 && ZoneType.Library.equals(cost.getFrom().get(0));
            final boolean shouldAsk = "All".equals(cost.getType())
                    || cost.payCostFromSource()
                    || "OriginalHost".equals(cost.getType())
                    || fromLibrary;
            if (!confirm(cost, shouldAsk)) return null;

            final String type = cost.getType();
            if (cost.payCostFromSource()) {
                return PaymentDecision.card(source);
            }
            if ("OriginalHost".equals(type) && ability.getOriginalHost() != null) {
                return PaymentDecision.card(ability.getOriginalHost());
            }
            if ("All".equals(type)) {
                return PaymentDecision.card(player.getCardsIn(cost.getFrom()));
            }

            final int amount = cost.getAbilityAmount(ability);
            if (cost.getFrom().size() == 1 && ZoneType.Library.equals(cost.getFrom().get(0))) {
                return PaymentDecision.card(player.getCardsIn(ZoneType.Library, amount));
            }

            CardCollectionView list = cost.zoneRestriction != 1
                    ? player.getGame().getCardsIn(cost.getFrom())
                    : player.getCardsIn(cost.getFrom());
            list = CardLists.filter(list, CardPredicates.canExiledBy(ability, isEffect()));
            if (!type.contains("X") || ability.getXManaCostPaid() != null) {
                list = CardLists.getValidCards(list, type.split(";"), player, source, ability);
            }
            if (list.size() < amount) {
                return null;
            }

            final CardCollectionView selected = chooseCards(list, amount, "Exile for cost");
            if (selected == null || selected.size() < amount) {
                return null;
            }
            return PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostExileFromStack cost) {
            final List<SpellAbility> candidates = new ArrayList<>();
            for (final SpellAbilityStackInstance si : source.getGame().getStack()) {
                final SpellAbility sp = si.getSpellAbility().getRootAbility();
                if (si.getSourceCard().isValid(cost.getType().split(";"), source.getController(), source, sp)) {
                    candidates.add(sp);
                }
            }
            if (candidates.isEmpty()) {
                return null;
            }
            final int amount = cost.getAbilityAmount(ability);
            final List<SpellAbility> chosen = controller.chooseSpellAbilitiesForEffect(
                    candidates, ability, "Exile from stack for cost", amount, null);
            return chosen == null || chosen.isEmpty() ? null : PaymentDecision.spellabilities(chosen);
        }

        @Override
        public PaymentDecision visit(final CostExiledMoveToGrave cost) {
            final int amount = cost.getAbilityAmount(ability);
            CardCollectionView list = player.getGame().getCardsIn(ZoneType.Exile);
            list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
            if (list.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(list, amount, "Move cards from exile for cost");
            return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostExert cost) {
            final boolean shouldAsk = cost.payCostFromSource() || "OriginalHost".equals(cost.getType());
            if (!confirm(cost, shouldAsk)) return null;
            if (cost.payCostFromSource()) {
                return PaymentDecision.card(source);
            }
            final int amount = cost.getAbilityAmount(ability);
            CardCollectionView list = player.getCardsIn(ZoneType.Battlefield);
            list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
            if (list.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(list, amount, "Exert for cost");
            return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostEnlist cost) {
            final CardCollection choices = CostEnlist.getCardsForEnlisting(player);
            if (choices.isEmpty()) {
                return null;
            }
            final CardCollectionView selected = chooseCards(choices, 1, "Enlist");
            return selected == null || selected.isEmpty() ? null : PaymentDecision.card(selected.get(0));
        }

        @Override
        public PaymentDecision visit(final CostFlipCoin cost) {
            if (!confirm(cost, true)) return null;
            return PaymentDecision.number(cost.getAbilityAmount(ability));
        }

        @Override
        public PaymentDecision visit(final CostForage cost) {
            if (!confirm(cost, true)) return null;
            final CardCollection food = CardLists.filter(
                    player.getCardsIn(ZoneType.Battlefield),
                    CardPredicates.isType("Food"),
                    CardPredicates.canBeSacrificedBy(ability, isEffect()));
            final CardCollection exile = CardLists.filter(
                    player.getCardsIn(ZoneType.Graveyard),
                    CardPredicates.canExiledBy(ability, isEffect()));

            final boolean canFood = !food.isEmpty();
            final boolean canExile = exile.size() >= 3;
            if (!canFood && !canExile) {
                return null;
            }

            boolean chooseFood = canFood && !canExile;
            if (canFood && canExile) {
                chooseFood = controller.chooseBinary(
                        ability,
                        "Forage: sacrifice Food instead of exiling three cards?",
                        PlayerController.BinaryChoiceType.AddOrRemove,
                        (Boolean) null);
            }

            if (chooseFood && canFood) {
                final CardCollectionView chosen = controller.choosePermanentsToSacrifice(
                        ability, 1, 1, food, "Choose Food to sacrifice");
                return chosen == null || chosen.size() != 1 ? null : PaymentDecision.card(chosen);
            }
            if (canExile) {
                final CardCollectionView chosen = chooseCards(exile, 3, "Choose three cards to exile");
                return chosen == null || chosen.size() != 3 ? null : PaymentDecision.card(chosen);
            }
            return null;
        }

        @Override
        public PaymentDecision visit(final CostRollDice cost) {
            if (!confirm(cost, true)) return null;
            return PaymentDecision.number(cost.getAbilityAmount(ability));
        }

        @Override
        public PaymentDecision visit(final CostMill cost) {
            if (!confirm(cost, true)) return null;
            final int amount = cost.getAbilityAmount(ability);
            return player.getCardsIn(ZoneType.Library, amount).size() < amount
                    ? null
                    : PaymentDecision.number(amount);
        }

        @Override
        public PaymentDecision visit(final CostPayLife cost) {
            if (!confirm(cost, !isMandatory())) return null;
            final int amount = cost.getAbilityAmount(ability);
            return player.canPayLife(amount, isEffect(), ability)
                    ? PaymentDecision.number(amount)
                    : null;
        }

        @Override
        public PaymentDecision visit(final CostPayEnergy cost) {
            if (!confirm(cost, true)) return null;
            final int amount = cost.getAbilityAmount(ability);
            return player.canPayEnergy(amount) ? PaymentDecision.number(amount) : null;
        }

        @Override
        public PaymentDecision visit(final CostGainLife cost) {
            final List<Player> targets = new ArrayList<>(cost.getPotentialTargets(player, ability));
            targets.removeIf(p -> !p.canGainLife());
            return targets.isEmpty() ? null : PaymentDecision.players(targets);
        }

        @Override
        public PaymentDecision visit(final CostPartMana cost) {
            if (!confirm(cost, cost.getMana().isZero())) return null;
            return PaymentDecision.number(0);
        }

        @Override
        public PaymentDecision visit(final CostPromiseGift cost) {
            final List<Player> potential = new ArrayList<>(cost.getPotentialPlayers(player, ability));
            if (potential.isEmpty()) {
                return null;
            }
            final Player chosen = controller.chooseSingleEntityForEffect(
                    cost.getPotentialPlayers(player, ability),
                    ability,
                    "Choose promised gift player",
                    null);
            return chosen == null ? null : PaymentDecision.players(List.of(chosen));
        }

        @Override
        public PaymentDecision visit(final CostPutCardToLib cost) {
            final boolean shouldAsk = cost.payCostFromSource() || "OriginalHost".equals(cost.getType());
            if (!confirm(cost, shouldAsk)) return null;
            if (cost.payCostFromSource()) {
                return PaymentDecision.card(source);
            }

            final CardCollectionView pool;
            if (cost.isSameZone()) {
                final CardCollection all = new CardCollection(player.getGame().getCardsIn(cost.getFrom()));
                final CardCollection valid = CardLists.getValidCards(
                        all, cost.getType().split(";"), player, source, ability);
                final int amount = cost.getAbilityAmount(ability);
                CardCollection chosenPool = null;
                for (final Player p : player.getGame().getPlayers()) {
                    final CardCollection owned = CardLists.filter(valid, CardPredicates.isController(p));
                    if (owned.size() >= amount) {
                        chosenPool = owned;
                        break;
                    }
                }
                if (chosenPool == null) {
                    return null;
                }
                pool = chosenPool;
            } else {
                CardCollectionView list = player.getCardsIn(cost.getFrom());
                list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
                pool = list;
            }

            final int amount = cost.getAbilityAmount(ability);
            final CardCollectionView selected = chooseCards(pool, amount, "Put cards to library for cost");
            if (selected == null || selected.size() < amount) {
                return null;
            }
            return PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostPutCounter cost) {
            if (cost.payCostFromSource()) {
                return PaymentDecision.card(source);
            }
            CardCollectionView list = player.getGame().getCardsIn(ZoneType.Battlefield);
            list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
            list = CardLists.filter(list, CardPredicates.canReceiveCounters(cost.getCounter()));
            if (list.isEmpty()) {
                return null;
            }
            final Card chosen = controller.chooseSingleEntityForEffect(
                    list,
                    ability,
                    "Choose permanent to put counter on",
                    null);
            return chosen == null ? null : PaymentDecision.card(chosen);
        }

        @Override
        public PaymentDecision visit(final CostTap cost) {
            return PaymentDecision.number(0);
        }

        @Override
        public PaymentDecision visit(final CostSacrifice cost) {
            final boolean shouldAsk =
                    (cost.payCostFromSource() && !isMandatory()) || "OriginalHost".equals(cost.getType());
            if (!confirm(cost, shouldAsk)) return null;
            if (cost.payCostFromSource()) {
                if (isSacrificeReserved(source)) {
                    return null;
                }
                reserveSacrifices(List.of(source));
                return PaymentDecision.card(source);
            }
            if ("OriginalHost".equals(cost.getType()) && ability.getOriginalHost() != null) {
                final Card originalHost = ability.getOriginalHost();
                if (isSacrificeReserved(originalHost)) {
                    return null;
                }
                reserveSacrifices(List.of(originalHost));
                return PaymentDecision.card(originalHost);
            }
            if ("All".equalsIgnoreCase(cost.getAmount())) {
                final CardCollection all = new CardCollection(CardLists.filter(
                        CardLists.getValidCards(player.getCardsIn(ZoneType.Battlefield), cost.getType().split(";"), player, source, ability),
                        CardPredicates.canBeSacrificedBy(ability, isEffect())));
                all.removeIf(HarnessCostPlumbing.this::isSacrificeReserved);
                reserveSacrifices(all);
                return PaymentDecision.card(all);
            }

            final int amount = cost.getAbilityAmount(ability);
            CardCollection valid = new CardCollection(CardLists.getValidCards(
                    player.getCardsIn(ZoneType.Battlefield),
                    cost.getType().split(";"),
                    player,
                    source,
                    ability));
            valid = new CardCollection(CardLists.filter(valid, CardPredicates.canBeSacrificedBy(ability, isEffect())));
            valid.removeIf(HarnessCostPlumbing.this::isSacrificeReserved);
            if (valid.size() < amount) {
                return null;
            }
            final CardCollectionView selected = controller.choosePermanentsToSacrifice(
                    ability, amount, amount, valid, "Choose permanents to sacrifice");
            if (selected == null || selected.size() < amount) {
                return null;
            }
            reserveSacrifices(selected);
            return PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostReturn cost) {
            final boolean shouldAsk = cost.payCostFromSource() || "OriginalHost".equals(cost.getType());
            if (!confirm(cost, shouldAsk)) return null;
            if (cost.payCostFromSource()) {
                return PaymentDecision.card(source);
            }
            final int amount = cost.getAbilityAmount(ability);
            CardCollectionView list = player.getCardsIn(ZoneType.Battlefield);
            list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
            if (list.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(list, amount, "Return cards for cost");
            if (selected == null || selected.size() < amount) {
                return null;
            }
            return PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostReveal cost) {
            CardCollectionView from = player.getCardsIn(cost.getRevealFrom());
            if (cost.payCostFromSource()) {
                return from.contains(source) ? PaymentDecision.card(source) : null;
            }
            if ("Hand".equals(cost.getType())) {
                return PaymentDecision.card(from);
            }

            final int amount = cost.getAbilityAmount(ability);
            if ("SameColor".equals(cost.getType())) {
                final CardCollection pool = new CardCollection(from);
                final CardCollection chosen = new CardCollection();
                while (chosen.size() < amount && !pool.isEmpty()) {
                    final CardCollectionView one = chooseCards(pool, 1, "Reveal cards sharing a color");
                    if (one == null || one.isEmpty()) {
                        return null;
                    }
                    final Card pick = one.get(0);
                    if (!chosen.isEmpty() && !pick.sharesColorWith(chosen.get(0))) {
                        pool.remove(pick);
                        continue;
                    }
                    chosen.add(pick);
                    pool.remove(pick);
                }
                return chosen.size() == amount ? PaymentDecision.card(chosen) : null;
            }

            from = CardLists.getValidCards(from, cost.getType().split(";"), player, source, ability);
            if (from.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(from, amount, "Reveal for cost");
            return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostRevealChosen cost) {
            return PaymentDecision.number(1);
        }

        @Override
        public PaymentDecision visit(final CostRemoveAnyCounter cost) {
            final int amount = cost.getAbilityAmount(ability);
            if (amount <= 0) {
                return null;
            }
            CardCollectionView list = player.getCardsIn(ZoneType.Battlefield);
            list = CardLists.getValidCards(list, cost.getType().split(";"), player, source, ability);
            if (list.isEmpty()) {
                return null;
            }
            final GameEntityCounterTable table = new GameEntityCounterTable();
            int remaining = amount;
            for (final Card card : list) {
                for (final Map.Entry<CounterType, Integer> e : card.getCounters().entrySet()) {
                    if (remaining <= 0) {
                        break;
                    }
                    final int remove = Math.min(remaining, e.getValue());
                    if (remove > 0) {
                        table.put(null, card, e.getKey(), remove);
                        remaining -= remove;
                    }
                }
                if (remaining <= 0) {
                    break;
                }
            }
            return remaining > 0 ? null : PaymentDecision.counters(table);
        }

        @Override
        public PaymentDecision visit(final CostRemoveCounter cost) {
            final boolean shouldAsk = !(source != null && source.isPlaneswalker());
            if (!confirm(cost, shouldAsk)) return null;
            final int amount = cost.getAbilityAmount(ability);
            if (amount <= 0) {
                return null;
            }

            final CardCollection candidates = new CardCollection();
            if (cost.payCostFromSource()) {
                candidates.add(source);
            } else if ("OriginalHost".equals(cost.getType())) {
                if (ability.getOriginalHost() != null) {
                    candidates.add(ability.getOriginalHost());
                }
            } else {
                candidates.addAll(CardLists.getValidCards(
                        player.getCardsIn(cost.zone),
                        cost.getType().split(";"),
                        player,
                        source,
                        ability));
            }
            if (candidates.isEmpty()) {
                return null;
            }
            final GameEntityCounterTable table = new GameEntityCounterTable();
            for (final Card card : candidates) {
                if (cost.counter != null) {
                    final int available = card.getCounters(cost.counter);
                    if (available >= amount) {
                        table.put(null, card, cost.counter, amount);
                        return PaymentDecision.counters(table);
                    }
                } else {
                    for (final Map.Entry<CounterType, Integer> e : card.getCounters().entrySet()) {
                        if (e.getValue() >= amount) {
                            table.put(null, card, e.getKey(), amount);
                            return PaymentDecision.counters(table);
                        }
                    }
                }
            }
            return null;
        }

        @Override
        public PaymentDecision visit(final CostUntapType cost) {
            CardCollection list = CardLists.getValidCards(
                    player.getGame().getCardsIn(ZoneType.Battlefield),
                    cost.getType().split(";"),
                    player,
                    source,
                    ability);
            if (!cost.canUntapSource) {
                list.remove(source);
            }
            list = CardLists.filter(list, c ->
                    c.canUntap(null, false) &&
                            (c.getCounters(forge.game.card.CounterEnumType.STUN) == 0
                                    || c.canRemoveCounters(forge.game.card.CounterEnumType.STUN)));
            final int amount = cost.getAbilityAmount(ability);
            if (list.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(list, amount, "Untap for cost");
            return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostUntap cost) {
            return PaymentDecision.number(0);
        }

        @Override
        public PaymentDecision visit(final CostUnattach cost) {
            if (!confirm(cost, true)) return null;
            final CardCollection cardToUnattach = cost.findCardToUnattach(source, player, ability);
            if (cardToUnattach.isEmpty()) {
                return null;
            }
            final CardCollectionView selected = chooseCards(cardToUnattach, 1, "Unattach for cost");
            return selected == null || selected.isEmpty() ? null : PaymentDecision.card(selected.get(0));
        }

        @Override
        public PaymentDecision visit(final CostTapType cost) {
            String type = cost.getType();
            boolean sameType = false;
            if (type.contains(".sharesCreatureTypeWith")) {
                sameType = true;
                type = type.replace(".sharesCreatureTypeWith", "");
            }
            int totalPowerRequired = -1;
            if (type.contains("+withTotalPowerGE")) {
                final String[] parts = type.split("\\+withTotalPowerGE");
                type = parts[0];
                totalPowerRequired = Integer.parseInt(parts[1].replaceAll("[^0-9]", ""));
            }
            CardCollection list = CardLists.getValidCards(
                    player.getCardsIn(ZoneType.Battlefield),
                    type.split(";"),
                    player,
                    source,
                    ability);
            if (!cost.canTapSource) {
                list.remove(source);
            }
            list = CardLists.filter(list, ability.isCrew() ? CardPredicates.CAN_CREW : CardPredicates.CAN_TAP);
            if (list.isEmpty()) {
                return null;
            }
            // Crew / withTotalPowerGE: select creatures greedily (highest power first)
            // until total power meets the threshold, matching the engine's canPay check.
            if (totalPowerRequired >= 0) {
                if (CardLists.getTotalPower(list, ability) < totalPowerRequired) {
                    return null;
                }
                // Sort by power descending so we tap fewer creatures.
                list.sort((a, b) -> b.getNetPower() - a.getNetPower());
                final CardCollection selected = new CardCollection();
                int accum = 0;
                for (final Card c : list) {
                    selected.add(c);
                    accum = CardLists.getTotalPower(selected, ability);
                    if (accum >= totalPowerRequired) {
                        break;
                    }
                }
                return accum >= totalPowerRequired ? PaymentDecision.card(selected) : null;
            }
            final int amount = cost.getAbilityAmount(ability);
            if (sameType) {
                final CardCollectionView first = chooseCards(list, 1, "Tap for cost");
                if (first == null || first.isEmpty()) {
                    return null;
                }
                final Card anchor = first.get(0);
                final CardCollection same = new CardCollection(CardLists.filter(list, CardPredicates.sharesCreatureTypeWith(anchor)));
                if (same.size() < amount) {
                    return null;
                }
                final CardCollectionView selected = chooseCards(same, amount, "Tap for cost");
                return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
            }
            if (list.size() < amount) {
                return null;
            }
            final CardCollectionView selected = chooseCards(list, amount, "Tap for cost");
            return selected == null || selected.size() < amount ? null : PaymentDecision.card(selected);
        }

        @Override
        public PaymentDecision visit(final CostPayShards cost) {
            if (!confirm(cost, true)) return null;
            final int amount = cost.getAbilityAmount(ability);
            return player.getNumManaShards() >= amount ? PaymentDecision.number(amount) : null;
        }

        @Override
        public PaymentDecision visit(final CostBlight cost) {
            return visit((CostPutCounter) cost);
        }

        @Override
        public boolean paysRightAfterDecision() {
            return false;
        }
    }
}
