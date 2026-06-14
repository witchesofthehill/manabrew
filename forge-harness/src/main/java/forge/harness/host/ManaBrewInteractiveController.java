package forge.harness.host;

import forge.harness.common.ActionSpace;
import forge.harness.common.AutoPay;
import forge.harness.common.ChoiceSpace;
import forge.harness.common.CombatChoiceSpace;
import forge.harness.common.EngineHandler;
import forge.harness.common.HarnessCostPlumbing;
import forge.harness.common.HarnessPlayHooks;
import forge.harness.common.HarnessPlayPlumbing;
import forge.harness.common.ParityOrder;
import forge.harness.common.SnapshotExtractor;

import com.google.common.collect.ListMultimap;
import com.google.common.collect.Lists;
import com.google.common.collect.Multimap;
import forge.LobbyPlayer;
import forge.ai.ComputerUtilCombat;
import forge.ai.ComputerUtilCost;
import forge.card.ColorSet;
import forge.card.ICardFace;
import forge.card.MagicColor.Color;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.*;
import forge.game.ability.AbilityKey;
import forge.game.ability.AbilityUtils;
import forge.game.ability.ApiType;
import forge.game.ability.effects.RollDiceEffect;
import forge.game.card.*;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.cost.*;
import forge.game.keyword.Keyword;
import forge.game.keyword.KeywordInterface;
import forge.game.mana.*;
import forge.game.player.*;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.*;
import forge.game.staticability.StaticAbility;
import forge.game.staticability.StaticAbilityManaConvert;
import forge.game.staticability.StaticAbilityMustTarget;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.MagicStack;
import forge.game.zone.PlayerZone;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.Aggregates;
import forge.util.ITriggerEvent;
import forge.util.Lang;
import forge.util.MessageUtil;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.function.Predicate;

public final class ManaBrewInteractiveController extends PlayerController implements HarnessPlayHooks {
    private final Game game;
    private final ManaBrewInteractiveSession session;
    private final HarnessCostPlumbing costPlumbing;
    private final AutoPay autoPay;
    private final HarnessPlayPlumbing playPlumbing;
    private String passUntilPhase;
    private boolean probingPayability;

    public ManaBrewInteractiveController(
            final Game game,
            final Player player,
            final LobbyPlayer lobbyPlayer,
            final ManaBrewInteractiveSession session
    ) {
        super(game, player, lobbyPlayer);
        this.game = game;
        this.session = session;
        this.costPlumbing = new HarnessCostPlumbing(this, player);
        this.autoPay = new AutoPay(player, costPlumbing, true);
        this.playPlumbing = new HarnessPlayPlumbing(this, player, costPlumbing);
    }

    private int me() {
        return SnapshotExtractor.playerIndex(game, player);
    }

    // ── HarnessPlayHooks ──────────────────────────────────────────────

    @Override
    public void markFailedPaymentCard(final Card card) {
        // Interactive play re-prompts naturally; no per-turn skip list.
    }

    @Override
    public boolean mulliganKeepHand(final Player mulliganingPlayer, final int cardsToReturn) {
        final boolean keep = session.awaitMulliganDecision(me(), cardsToReturn);
        if (keep && cardsToReturn > 0) {
            final CardCollection hand = new CardCollection(player.getCardsIn(ZoneType.Hand));
            final CardCollection selected = session.awaitMulliganPutBack(me(), hand, cardsToReturn);
            for (final Card card : selected) {
                game.getAction().moveToLibrary(card, -1, null);
            }
        }
        return keep;
    }

    @Override
    public CardCollection tuckCardsViaMulligan(final Player mulliganingPlayer, final int cardsToReturn) {
        return new CardCollection();
    }

    @Override
    public boolean confirmMulliganScry(final Player p) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Scry 1 after mulligan?", null, "confirm_mulligan_scry", null, null);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        final String until = passUntilPhase;
        passUntilPhase = null;
        if (until != null && PriorityFastForward.shouldSkip(game, until)) {
            return null;
        }
        while (true) {
            final List<SpellAbility> all;
            probingPayability = true;
            try {
                all = ChoiceSpace.sortNative(
                        new ArrayList<>(ActionSpace.getPossibleActions(player, true)),
                        ParityOrder.actionComparator());
            } finally {
                probingPayability = false;
            }
            final ManaBrewInteractiveSession.PriorityChoice choice =
                    session.awaitPriorityAction(me(), all, undoableManaSources());
            if (choice.kind() == ManaBrewInteractiveSession.PriorityActionKind.UNDO) {
                undoManaSource(choice.untapCard());
                continue;
            }
            passUntilPhase = choice.untilPhase();
            final SpellAbility selected = choice.action();
            return selected == null ? null : Lists.newArrayList(selected);
        }
    }

    private List<Card> undoableManaSources() {
        if (!game.getStack().canUndo(player)) {
            return new ArrayList<>();
        }
        final List<Card> sources = new ArrayList<>();
        for (final Card card : player.getCardsIn(ZoneType.Battlefield)) {
            if (game.getStack().filterUndoStackByHost(card).iterator().hasNext()) {
                sources.add(card);
            }
        }
        return sources;
    }

    private void undoManaSource(final Card source) {
        final MagicStack stack = game.getStack();
        if (source == null) {
            stack.undo();
            return;
        }
        for (final SpellAbility sa : Lists.newArrayList(stack.filterUndoStackByHost(source))) {
            if (sa.undo()) {
                stack.clearUndoStack(sa);
                new ManaRefundService(sa).refundManaPaid();
            } else {
                stack.clearUndoStack(sa);
                for (final Mana pay : sa.getPayingMana()) {
                    stack.clearUndoStack(pay.getManaAbility().getSourceSA());
                }
            }
        }
    }

    @Override
    public boolean playChosenSpellAbility(final SpellAbility sa) {
        final Integer staleX = sa.getXManaCostPaid();
        sa.setXManaCostPaid(null);
        session.beginCast(sa);
        try {
            final boolean played = playPlumbing.handlePlayingSpellAbility(player, sa, getGame());
            if (!played) {
                sa.setXManaCostPaid(staleX);
            }
            return played;
        } finally {
            session.endCast();
        }
    }

    @Override
    public void playSpellAbilityNoStack(final SpellAbility effectSA, final boolean mayChoseNewTargets) {
        if (mayChoseNewTargets && !effectSA.setupTargets()) {
            return;
        }
        playPlumbing.playNoStack(player, effectSA, getGame(), true);
    }

    @Override
    public void orderAndPlaySimultaneousSa(final List<SpellAbility> activePlayerSAs) {
        playPlumbing.orderAndPlaySimultaneousSa(activePlayerSAs, getGame());
    }

    @Override
    public boolean playTrigger(final Card host, final WrappedAbility wrapperAbility, final boolean isMandatory) {
        if (playPlumbing.prepareSingleSa(host, wrapperAbility, isMandatory)) {
            return playPlumbing.playNoStack(wrapperAbility.getActivatingPlayer(), wrapperAbility, getGame(), true);
        }
        return false;
    }

    @Override
    public boolean playSaFromPlayEffect(final SpellAbility tgtSA) {
        return playPlumbing.playSaFromPlayEffect(tgtSA, getGame());
    }

    @Override
    public SpellAbility getAbilityToPlay(final Card hostCard, final List<SpellAbility> abilities, final ITriggerEvent triggerEvent) {
        if (abilities == null || abilities.isEmpty()) {
            return null;
        }
        if (triggerEvent != null && !hostCard.isInPlay() && !hostCard.getOwner().equals(player)
                && !hostCard.getController().equals(player)
                && (!player.hasKeyword("Shaman's Trance") || !hostCard.isInZone(ZoneType.Graveyard))) {
            boolean noPermission = true;
            for (final CardPlayOption o : hostCard.mayPlay(player)) {
                if (o.grantsZonePermissions()) {
                    noPermission = false;
                    break;
                }
            }
            for (final SpellAbility sa : hostCard.getAllSpellAbilities()) {
                if (sa.hasParam("Activator")
                        && player.isValid(sa.getParam("Activator"), hostCard.getController(), hostCard, sa)) {
                    noPermission = false;
                    break;
                }
            }
            if (noPermission) {
                return null;
            }
        }
        if (abilities.size() == 1) {
            return abilities.get(0);
        }
        final List<String> labels = new ArrayList<>();
        for (final SpellAbility sa : abilities) {
            labels.add(sa == null ? "Ability" : sa.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 0, 1, hostCard == null ? null : hostCard.getName());
        if (chosen.isEmpty()) {
            return null;
        }
        final int idx = chosen.get(0);
        return idx >= 0 && idx < abilities.size() ? abilities.get(idx) : null;
    }

    @Override
    public void declareAttackers(final Player attacker, final Combat combat) {
        combat.clearAttackers();
        final List<Card> legalAttackers = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalAttackers(attacker, combat), ParityOrder.cardComparator());
        final List<Pair<Card, GameEntity>> assignments = session.awaitAttackAssignments(
                SnapshotExtractor.playerIndex(game, attacker), combat, legalAttackers);
        final CardCollection selected = new CardCollection();
        for (final Pair<Card, GameEntity> assignment : assignments) {
            final Card card = assignment.getLeft();
            final GameEntity defender = assignment.getRight();
            if (card != null && defender != null && !selected.contains(card)
                    && CombatUtil.canAttack(card, defender)) {
                combat.addAttacker(card, defender);
                selected.add(card);
            }
        }
    }

    @Override
    public void declareBlockers(final Player defender, final Combat combat) {
        final List<Card> attackers = ChoiceSpace.sortNative(
                new ArrayList<Card>(combat.getAttackers()), ParityOrder.cardComparator());
        final List<Card> blockers = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalBlockers(defender, combat), ParityOrder.cardComparator());
        final Map<Card, List<Card>> validByAttacker =
                EngineHandler.validBlockersByAttacker(combat, attackers, blockers);
        final int defenderIndex = SnapshotExtractor.playerIndex(game, defender);
        String error = null;
        while (true) {
            final List<Pair<Card, Card>> assignments =
                    session.awaitBlockers(defenderIndex, attackers, blockers, validByAttacker, error);
            error = EngineHandler.applyBlockerAssignments(combat, defender, assignments);
            if (error == null || session.isClosed() || game.isGameOver()) {
                return;
            }
        }
    }

    @Override
    public CardCollection orderBlockers(final Card attacker, final CardCollection blockers) {
        return session.awaitDamageAssignmentOrder(me(), attacker, blockers);
    }

    @Override
    public CardCollection orderBlocker(final Card attacker, final Card blocker, final CardCollection oldBlockers) {
        final CardCollection all = new CardCollection(oldBlockers);
        all.add(blocker);
        final CardCollection ordered = session.awaitDamageAssignmentOrder(me(), attacker, all);
        int previous = -1;
        for (final Card old : oldBlockers) {
            final int index = ordered.indexOf(old);
            if (index <= previous) {
                throw new IllegalArgumentException(
                        "damage assignment order must preserve the relative order of existing blockers");
            }
            previous = index;
        }
        return ordered;
    }

    @Override
    public CardCollection orderAttackers(final Card blocker, final CardCollection attackers) {
        return session.awaitDamageAssignmentOrder(me(), blocker, attackers);
    }

    private static final String DIVIDE_COMBAT_DAMAGE_KEYWORD =
            "You may assign CARDNAME's combat damage divided as you choose among "
                    + "defending player and/or any number of creatures they control.";

    @Override
    public Map<Card, Integer> assignCombatDamage(
            final Card attacker,
            final CardCollectionView blockers,
            final CardCollectionView remaining,
            final int damageDealt,
            final GameEntity defender,
            final boolean overrideOrder
    ) {
        final boolean dividesFreely = attacker.hasKeyword(DIVIDE_COMBAT_DAMAGE_KEYWORD) && overrideOrder;
        final boolean mustPrompt = (attacker.hasKeyword(Keyword.TRAMPLE) && defender != null)
                || blockers.size() > 1
                || (dividesFreely && !blockers.isEmpty())
                || (attacker.hasKeyword("Trample:Planeswalker") && defender instanceof Card);
        if (!mustPrompt) {
            final Map<Card, Integer> map = new LinkedHashMap<>();
            map.put(blockers.isEmpty() ? null : blockers.get(0), damageDealt);
            return map;
        }
        final boolean defenderAssignable = defender != null
                && (attacker.hasKeyword(Keyword.TRAMPLE)
                        || (attacker.hasKeyword("Trample:Planeswalker") && defender instanceof Card)
                        || (dividesFreely && !blockers.isEmpty()));
        final boolean maySkip = remaining != null && remaining.size() > 1 && attacker.isAttacking();
        final Map<Card, Integer> selected = session.awaitCombatDamageAssignment(
                me(), attacker, blockers, damageDealt, defender, defenderAssignable, maySkip);
        if (selected == null) {
            return null;
        }
        if (!selected.isEmpty()) {
            validateCombatDamageAssignment(selected, attacker, blockers, damageDealt, overrideOrder, dividesFreely);
            return selected;
        }
        return fallbackCombatDamage(attacker, blockers, damageDealt, defender);
    }

    private static void validateCombatDamageAssignment(
            final Map<Card, Integer> assignment,
            final Card attacker,
            final CardCollectionView blockers,
            final int damageDealt,
            final boolean overrideOrder,
            final boolean dividesFreely
    ) {
        int total = 0;
        for (final Integer damage : assignment.values()) {
            total += damage == null ? 0 : damage;
        }
        if (total != damageDealt) {
            throw new IllegalArgumentException(
                    "combat damage assignment must total " + damageDealt + ", got " + total);
        }
        if (dividesFreely) {
            return;
        }
        boolean priorLethal = true;
        boolean allBlockersLethal = true;
        for (final Card blocker : blockers) {
            final int assigned = assignment.getOrDefault(blocker, 0);
            if (assigned > 0 && !overrideOrder && !priorLethal) {
                throw new IllegalArgumentException(
                        "combat damage assigned out of damage assignment order to " + blocker);
            }
            final int lethal = ComputerUtilCombat.getEnoughDamageToKill(blocker, damageDealt, attacker, false, false);
            priorLethal &= assigned >= lethal;
            allBlockersLethal &= assigned >= lethal;
        }
        if (assignment.getOrDefault(null, 0) > 0 && !allBlockersLethal) {
            throw new IllegalArgumentException("trample damage assigned before all blockers have lethal damage");
        }
    }

    @Override
    public List<Card> exertAttackers(final List<Card> attackers) {
        if (attackers == null || attackers.isEmpty()) {
            return new ArrayList<>();
        }
        return chooseCardSubset(attackers, "Choose attackers to exert");
    }

    @Override
    public List<Card> enlistAttackers(final List<Card> attackers) {
        if (attackers == null || attackers.isEmpty() || CostEnlist.getCardsForEnlisting(player).isEmpty()) {
            return new ArrayList<>();
        }
        return chooseCardSubset(attackers, "Choose attackers to enlist");
    }


    @Override
    public boolean chooseTargetsFor(final SpellAbility currentAbility) {
        if (currentAbility == null || !currentAbility.usesTargeting()) {
            return true;
        }
        final TargetRestrictions tr = currentAbility.getTargetRestrictions();
        if (tr == null) {
            return true;
        }
        boolean canFilterMustTarget = true;
        SpellAbility checkSA = currentAbility.getParent();
        while (checkSA != null) {
            if (checkSA.usesTargeting()) {
                canFilterMustTarget = false;
                break;
            }
            checkSA = checkSA.getParent();
        }
        checkSA = currentAbility.getSubAbility();
        while (checkSA != null) {
            if (checkSA.usesTargeting()) {
                canFilterMustTarget = false;
                break;
            }
            checkSA = checkSA.getSubAbility();
        }
        if (!selectTargets(currentAbility, tr, null, null, isMandatoryTargeting(currentAbility, tr), canFilterMustTarget)) {
            return false;
        }
        return assignDividedAllocation(currentAbility, null);
    }

    private static boolean isMandatoryTargeting(final SpellAbility ability, final TargetRestrictions tr) {
        return ability.isTrigger() || tr.getMandatory();
    }

    private boolean selectTargets(
            final SpellAbility ability,
            final TargetRestrictions tr,
            final Integer numTargets,
            final Predicate<GameObject> filter,
            final boolean mandatory,
            final boolean canFilterMustTarget) {
        if (tr.isRandomTarget() && numTargets == null) {
            final List<GameEntity> candidates = tr.getAllCandidates(ability, true);
            final List<GameEntity> choices = new ArrayList<>();
            final int minTargets = ability.getMinTargets();
            final int top = Math.min(candidates.size(), ability.getMaxTargets());
            final int bot = minTargets > 0 ? minTargets : 1;
            final int num = tr.isRandomNumTargets() ? Aggregates.randomInt(bot, top) : minTargets;
            for (int i = 0; i < num; i++) {
                final GameEntity choice = Aggregates.random(candidates);
                if (choice != null) {
                    choices.add(choice);
                    candidates.remove(choice);
                }
            }
            return ability.getTargets().addAll(choices);
        }
        while (numTargets != null ? ability.getTargets().size() < numTargets : ability.canAddMoreTarget()) {
            List<Card> validCards = CardUtil.getValidCardsToTarget(ability);
            final boolean mustTargetFiltered = canFilterMustTarget
                    && StaticAbilityMustTarget.filterMustTargetCards(player, validCards, ability);
            if (mustTargetFiltered && validCards.isEmpty()) {
                return false;
            }
            final List<Pair<GameEntity, GameObject>> valid =
                    targetCandidates(ability, tr, filter, mustTargetFiltered ? validCards : null);
            if (valid.isEmpty()) {
                break;
            }
            final boolean mustChoose = mandatory && (numTargets != null || !ability.isMinTargetChosen());
            final Pair<GameEntity, GameObject> chosen = session.awaitTargetChoice(me(), ability, valid, mustChoose);
            if (chosen == null) {
                break;
            }
            ability.getTargets().add(chosen.getRight());
        }
        return numTargets != null ? ability.getTargets().size() == numTargets : ability.isTargetNumberValid();
    }

    private boolean assignDividedAllocation(final SpellAbility ability, final Collection<Integer> dividedValues) {
        if (!ability.isDividedAsYouChoose()) {
            return true;
        }
        final List<GameEntity> targets = new ArrayList<>();
        for (final GameEntity entity : ability.getTargets().getTargetEntities()) {
            targets.add(entity);
        }
        if (dividedValues != null) {
            final Iterator<Integer> values = dividedValues.iterator();
            for (final GameEntity entity : targets) {
                if (!values.hasNext()) {
                    return false;
                }
                ability.addDividedAllocation(entity, values.next());
            }
            return true;
        }
        final int size = targets.size();
        int amount = ability.getStillToDivide();
        if (size == 0 || amount <= 0) {
            return true;
        }
        if (ability.hasParam("DividedUpTo")) {
            amount = chooseNumber(ability, "How many?", size, amount);
        }
        if (size == 1) {
            ability.addDividedAllocation(targets.get(0), amount);
            return true;
        }
        if (size == amount) {
            for (final GameEntity entity : targets) {
                ability.addDividedAllocation(entity, 1);
            }
            return true;
        }
        if (amount == 0) {
            for (final GameEntity entity : targets) {
                ability.addDividedAllocation(entity, 0);
            }
            return true;
        }
        if (size > amount) {
            return false;
        }
        final Map<GameEntity, Integer> allocation = session.awaitDividedAllocation(me(), ability, targets, amount);
        for (final GameEntity entity : targets) {
            ability.addDividedAllocation(entity, allocation.getOrDefault(entity, 0));
        }
        return ability.getStillToDivide() <= 0;
    }

    @Override
    public TargetChoices chooseNewTargetsFor(final SpellAbility ability, final Predicate<GameObject> filter, final boolean optional) {
        final SpellAbility sa = ability.isWrapper() ? ((WrappedAbility) ability).getWrappedAbility() : ability;
        if (!sa.usesTargeting()) {
            return null;
        }
        final TargetRestrictions tr = sa.getTargetRestrictions();
        if (tr == null) {
            return null;
        }
        final TargetChoices oldTarget = sa.getTargets();
        final List<Integer> dividedValues =
                sa.isDividedAsYouChoose() ? Lists.newArrayList(oldTarget.getDividedValues()) : null;
        sa.clearTargets();
        if (selectTargets(sa, tr, oldTarget.size(), filter, isMandatoryTargeting(sa, tr) && !optional, false)
                && assignDividedAllocation(sa, dividedValues)) {
            return sa.getTargets();
        }
        sa.setTargets(oldTarget);
        return null;
    }

    @Override
    public Pair<SpellAbilityStackInstance, GameObject> chooseTarget(
            final SpellAbility sa,
            final List<Pair<SpellAbilityStackInstance, GameObject>> allTargets
    ) {
        if (allTargets == null || allTargets.isEmpty()) {
            return null;
        }
        if (allTargets.size() == 1) {
            return allTargets.get(0);
        }
        final List<String> labels = new ArrayList<>();
        for (final Pair<SpellAbilityStackInstance, GameObject> pair : allTargets) {
            labels.add(String.valueOf(pair.getRight()));
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, sourceName(sa));
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < allTargets.size() ? allTargets.get(idx) : allTargets.get(0);
    }


    @Override
    public CardCollection chooseCardsToDiscardFrom(
            final Player playerDiscard, final SpellAbility sa, final CardCollection validCards, final int min, final int max) {
        return session.awaitCardChoice("choose_discard", me(), validCards, min, max);
    }

    @Override
    public CardCollection chooseCardsToDiscardToMaximumHandSize(final int numDiscard) {
        final CardCollection hand = new CardCollection(player.getCardsIn(ZoneType.Hand));
        return session.awaitCardChoice("choose_discard", me(), hand, numDiscard, numDiscard);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardUnlessType(
            final int min, final CardCollectionView hand, final String param, final SpellAbility sa) {
        final String[] splitUTypes = param.split(",");
        final int max = Math.min(min, hand.size());
        if (max == 0) {
            return session.awaitCardChoice("choose_discard", me(), hand, 0, 0, sourceName(sa), null);
        }
        int guard = 0;
        while (guard++ < 512) {
            final CardCollection chosen =
                    session.awaitCardChoice("choose_discard", me(), hand, 1, max, sourceName(sa), null);
            if (chosen.size() >= max || containsType(chosen, splitUTypes, sa)) {
                return chosen;
            }
        }
        return new CardCollection(new CardCollection(hand).subList(0, max));
    }

    private static boolean containsType(final CardCollection chosen, final String[] splitUTypes, final SpellAbility sa) {
        for (final Card c : chosen) {
            if (c.isValid(splitUTypes, sa.getActivatingPlayer(), sa.getHostCard(), sa)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public CardCollectionView chooseCardsForEffect(
            final CardCollectionView sourceList,
            final SpellAbility sa,
            final String title,
            final int min,
            final int max,
            final boolean isOptional,
            final Map<String, Object> params
    ) {
        if (sourceList.isEmpty()) {
            return CardCollection.EMPTY;
        }
        return session.awaitCardChoice(
                "choose_cards_for_effect", me(), sourceList, min, max, sourceName(sa), title, isOptional);
    }

    @Override
    public CardCollection chooseCardsForEffectMultiple(
            final Map<String, CardCollection> validMap, final SpellAbility sa, final String title, final boolean isOptional) {
        final CardCollection result = new CardCollection();
        if (validMap == null || validMap.isEmpty()) {
            return result;
        }
        for (final Map.Entry<String, CardCollection> entry : validMap.entrySet()) {
            result.addAll(chooseCardsForEffect(
                    entry.getValue(), sa, title + " (" + entry.getKey() + ")", 0, 1, isOptional, null));
        }
        return result;
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(
            final FCollectionView<T> optionList,
            final DelayedReveal delayedReveal,
            final SpellAbility sa,
            final String title,
            final boolean isOptional,
            final Player relatedPlayer,
            final Map<String, Object> params
    ) {
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        if (optionList.isEmpty()) {
            return null;
        }
        if (!isOptional && optionList.size() == 1) {
            for (final T option : optionList) {
                return option;
            }
        }
        final CardCollection cards = cardOptions(optionList);
        if (cards == null) {
            return chooseSingleEntityGeneric(optionList, sa, title, isOptional);
        }
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect", me(), cards, 1, 1, sourceName(sa), title, isOptional);
        if (selected.isEmpty()) {
            return null;
        }
        final Card selectedCard = selected.get(0);
        for (final T option : optionList) {
            if (option == selectedCard) {
                return option;
            }
        }
        return null;
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(
            final FCollectionView<T> optionList,
            final int min,
            final int max,
            final DelayedReveal delayedReveal,
            final SpellAbility sa,
            final String title,
            final Player relatedPlayer,
            final Map<String, Object> params
    ) {
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        if (optionList.isEmpty()) {
            return new ArrayList<>();
        }
        final CardCollection cards = cardOptions(optionList);
        if (cards == null) {
            return chooseEntitiesGeneric(optionList, min, max, sa);
        }
        final CardCollection selected;
        if (sa != null && sa.getApi() == ApiType.Dig) {
            selected = session.awaitDigChoice(me(), cards, min, max, sourceName(sa));
        } else {
            selected = session.awaitCardChoice("choose_cards_for_effect", me(), cards, min, max, sourceName(sa), title);
        }
        final List<T> out = new ArrayList<>();
        for (final Card card : selected) {
            for (final T option : optionList) {
                if (option == card) {
                    out.add(option);
                    break;
                }
            }
        }
        return out;
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(
            final SpellAbility sa, final int min, final int max, final CardCollectionView validTargets, final String message) {
        final int cappedMax = Math.min(max, validTargets.size());
        if (cappedMax <= 0) {
            return CardCollection.EMPTY;
        }
        if (probingPayability) {
            final CardCollection sorted = new CardCollection(validTargets);
            CardLists.sortByCmcDesc(sorted);
            return new CardCollection(sorted.subList(0, Math.max(min, Math.min(cappedMax, 1))));
        }
        return session.awaitCardChoice("choose_cards_for_effect", me(), validTargets, min, cappedMax, sourceName(sa), message);
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(
            final SpellAbility sa, final int min, final int max, final CardCollectionView validTargets, final String message) {
        final int cappedMax = Math.min(max, validTargets.size());
        if (cappedMax <= 0) {
            return CardCollection.EMPTY;
        }
        return session.awaitCardChoice("choose_cards_for_effect", me(), validTargets, min, cappedMax, sourceName(sa), message);
    }

    @Override
    public Card chooseSingleCardForZoneChange(
            final ZoneType destination,
            final List<ZoneType> origin,
            final SpellAbility sa,
            final CardCollection fetchList,
            final DelayedReveal delayedReveal,
            final String selectPrompt,
            final boolean isOptional,
            final Player decider
    ) {
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        if (fetchList.isEmpty()) {
            return null;
        }
        if (!isOptional && fetchList.size() == 1) {
            return fetchList.get(0);
        }
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect", me(), fetchList, 1, 1, sourceName(sa), selectPrompt, isOptional);
        return selected.isEmpty() ? null : selected.get(0);
    }

    @Override
    public List<Card> chooseCardsForZoneChange(
            final ZoneType destination,
            final List<ZoneType> origin,
            final SpellAbility sa,
            final CardCollection fetchList,
            final int min,
            final int max,
            final DelayedReveal delayedReveal,
            final String selectPrompt,
            final Player decider
    ) {
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        if (fetchList.isEmpty()) {
            return new ArrayList<>();
        }
        return new ArrayList<Card>(session.awaitCardChoice(
                "choose_cards_for_effect", me(), fetchList, min, max, sourceName(sa), selectPrompt));
    }

    @Override
    public CardCollectionView chooseCardsToDelve(final int genericAmount, final CardCollection grave) {
        final int max = Math.min(genericAmount, grave.size());
        if (max <= 0) {
            return CardCollection.EMPTY;
        }
        if (probingPayability) {
            return new CardCollection(grave.subList(0, max));
        }
        return session.awaitCardChoice("choose_delve", me(), grave, 0, max);
    }

    @Override
    public Map<Card, ManaCostShard> chooseCardsForConvokeOrImprovise(
            final SpellAbility sa,
            final ManaCost manaCost,
            final CardCollectionView untappedCards,
            final boolean artifacts,
            final boolean creatures,
            final Integer maxReduction
    ) {
        final Map<Card, ManaCostShard> result = new LinkedHashMap<>();
        if (untappedCards == null || untappedCards.isEmpty()) {
            return result;
        }
        int cap = Math.min(manaCost.getCMC(), untappedCards.size());
        if (maxReduction != null) {
            cap = Math.max(0, Math.min(maxReduction, cap));
        }
        if (cap <= 0) {
            return result;
        }
        final ManaCostBeingPaid remainingCost = new ManaCostBeingPaid(manaCost);
        if (probingPayability) {
            for (final Card card : untappedCards) {
                if (result.size() >= cap) {
                    break;
                }
                final ManaCostShard shard = remainingCost.payManaViaConvoke(
                        convokeColor(card, remainingCost, artifacts, true));
                if (shard != null) {
                    result.put(card, shard);
                }
            }
            return result;
        }
        final String kind = artifacts && !creatures ? "choose_improvise" : "choose_convoke";
        String error = null;
        int guard = 0;
        while (true) {
            final ManaCostBeingPaid attempt = new ManaCostBeingPaid(manaCost);
            final CardCollection selected = session.awaitCardChoice(
                    kind, me(), untappedCards, 0, cap, sourceName(sa), manaCost.toString(), false, error);
            result.clear();
            Card unpayable = null;
            for (final Card card : selected) {
                final ManaCostShard shard = attempt.payManaViaConvoke(
                        convokeColor(card, attempt, artifacts, false));
                if (shard == null) {
                    unpayable = card;
                } else {
                    result.put(card, shard);
                }
            }
            if (unpayable == null || guard++ >= 512) {
                return result;
            }
            error = unpayable.getName() + " cannot help pay this cost";
        }
    }

    private byte convokeColor(
            final Card card, final ManaCostBeingPaid remainingCost, final boolean artifacts, final boolean silent) {
        if (artifacts) {
            return ManaCostShard.COLORLESS.getColorMask();
        }
        ColorSet colors = card.getColor();
        if (colors.isMulticolor()) {
            colors = ColorSet.fromMask(colors.getColor() & remainingCost.getUnpaidColors());
        }
        if (colors.isMulticolor()) {
            return silent
                    ? (byte) Integer.lowestOneBit(colors.getColor())
                    : chooseColorAllowColorless("Convoke " + card + "  for which color?", card, colors);
        }
        return colors.getColor();
    }

    @Override
    public List<Card> chooseCardsForSplice(final SpellAbility sa, final List<Card> cards) {
        if (cards == null || cards.isEmpty()) {
            return new ArrayList<>();
        }
        return new ArrayList<>(session.awaitCardChoice(
                "choose_cards_for_effect", me(), new CardCollection(cards), 0, cards.size(), sourceName(sa), "Splice"));
    }

    @Override
    public CardCollectionView chooseCardsToRevealFromHand(final int min, final int max, final CardCollectionView valid) {
        final int clampedMax = Math.min(max, valid.size());
        final int clampedMin = Math.min(min, clampedMax);
        return session.awaitCardChoice("reveal_cards", me(), valid, clampedMin, clampedMax);
    }

    @Override
    public List<Card> chooseContraptionsToCrank(final List<Card> contraptions) {
        if (contraptions == null || contraptions.isEmpty()) {
            return new ArrayList<>();
        }
        return new ArrayList<>(session.awaitCardChoice(
                "choose_cards_for_effect", me(), new CardCollection(contraptions), 0, contraptions.size(), null, "Crank contraptions"));
    }

    // ── Modes / spell-ability choices ─────────────────────────────────

    @Override
    public List<AbilitySub> chooseModeForAbility(
            final SpellAbility sa, final List<AbilitySub> possible, final int min, final int num, final boolean allowRepeat) {
        final List<String> labels = new ArrayList<>();
        for (final AbilitySub mode : possible) {
            labels.add(mode == null ? "Mode" : mode.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, min, num, sourceName(sa), allowRepeat);
        return EngineHandler.selectModes(possible, chosen, allowRepeat);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(
            final List<SpellAbility> spells, final SpellAbility sa, final String title, final int num, final Map<String, Object> params) {
        if (spells == null || spells.isEmpty() || num <= 0) {
            return new ArrayList<>();
        }
        final List<String> labels = new ArrayList<>();
        for (final SpellAbility spell : spells) {
            labels.add(spell == null ? "Ability" : spell.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, num, num, sourceName(sa));
        final List<SpellAbility> selected = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < spells.size()) {
                selected.add(spells.get(index));
            }
        }
        return selected;
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(
            final List<SpellAbility> spells, final SpellAbility sa, final String title, final Map<String, Object> params) {
        if (spells == null || spells.size() < 2) {
            return spells == null || spells.isEmpty() ? null : spells.get(0);
        }
        final List<SpellAbility> selected = chooseSpellAbilitiesForEffect(spells, sa, title, 1, params);
        return selected.isEmpty() ? null : selected.get(0);
    }

    @Override
    public List<SpellAbility> chooseSaToActivateFromOpeningHand(final List<SpellAbility> usableFromOpeningHand) {
        if (usableFromOpeningHand == null || usableFromOpeningHand.isEmpty()) {
            return new ArrayList<>();
        }
        final List<String> labels = new ArrayList<>();
        for (final SpellAbility sa : usableFromOpeningHand) {
            labels.add(sa == null ? "Ability" : sa.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 0, usableFromOpeningHand.size(), null);
        final List<SpellAbility> selected = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < usableFromOpeningHand.size()) {
                selected.add(usableFromOpeningHand.get(index));
            }
        }
        return selected;
    }

    @Override
    public ReplacementEffect chooseSingleReplacementEffect(final List<ReplacementEffect> possibleReplacers) {
        if (possibleReplacers == null || possibleReplacers.isEmpty()) {
            return null;
        }
        final ReplacementEffect first = possibleReplacers.get(0);
        if (possibleReplacers.size() == 1) {
            return first;
        }
        final String firstStr = first.toString();
        boolean allSame = true;
        for (int i = 1; i < possibleReplacers.size(); i++) {
            if (!possibleReplacers.get(i).toString().equals(firstStr)) {
                allSame = false;
                break;
            }
        }
        if (allSame) {
            return first;
        }
        final List<String> labels = new ArrayList<>();
        for (final ReplacementEffect replacer : possibleReplacers) {
            labels.add(replacer == null ? "Replacement effect" : replacer.getDescription());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, null);
        final int index = chosen.isEmpty() ? 0 : chosen.get(0);
        return index >= 0 && index < possibleReplacers.size() ? possibleReplacers.get(index) : possibleReplacers.get(0);
    }

    @Override
    public StaticAbility chooseSingleStaticAbility(final String prompt, final List<StaticAbility> possibleReplacers) {
        return possibleReplacers == null || possibleReplacers.isEmpty() ? null : possibleReplacers.get(0);
    }


    @Override
    public boolean confirmTrigger(final WrappedAbility sa) {
        if (sa != null) {
            final SpellAbility wrapped = sa.getWrappedAbility();
            if (wrapped.hasParam("Cost") && !wrapped.getParam("Cost").equals("0")) {
                return true;
            }
        }
        return session.awaitBooleanChoice(
                "choose_optional_trigger",
                me(),
                sa == null ? "Resolve optional trigger?" : sa.getStackDescription(),
                sa == null || sa.getHostCard() == null ? null : sa.getHostCard().getName(),
                "optional_trigger",
                null,
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
    }

    @Override
    public boolean confirmAction(
            final SpellAbility sa,
            final PlayerActionConfirmMode mode,
            final String message,
            final List<String> options,
            final Card cardToShow,
            final Map<String, Object> params
    ) {
        return session.awaitBooleanChoice(
                "confirm_action",
                me(),
                message == null ? "Confirm action?" : message,
                cardToShow != null ? cardToShow.getName() : sourceName(sa),
                "confirm_action",
                mode == null ? null : mode.toString(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString(),
                options != null && options.size() == 2 ? options : null,
                null);
    }

    @Override
    public boolean confirmBidAction(
            final SpellAbility sa, final PlayerActionConfirmMode bidlife, final String string, final int bid, final Player winner) {
        final String question = (string == null ? "Bid life? Current bid: " + bid : string)
                + " Highest Bidder " + winner;
        return session.awaitBooleanChoice(
                "confirm_action", me(), question, sourceName(sa), "confirm_bid", null, null);
    }

    @Override
    public boolean confirmReplacementEffect(
            final ReplacementEffect replacementEffect, final SpellAbility effectSA, final GameEntity affected, final String question) {
        final String description = replacementEffect == null ? "Apply replacement effect?" : replacementEffect.getDescription();
        final String source = replacementEffect != null && replacementEffect.getHostCard() != null
                ? replacementEffect.getHostCard().getName()
                : sourceName(effectSA);
        return session.awaitBooleanChoice(
                "choose_optional_trigger",
                me(),
                question == null ? description : question,
                source,
                "replacement_effect",
                null,
                effectSA == null || effectSA.getApi() == null ? null : effectSA.getApi().toString());
    }

    @Override
    public boolean confirmStaticApplication(
            final Card hostCard, final PlayerActionConfirmMode mode, final String message, final String logic) {
        return session.awaitBooleanChoice(
                "confirm_action",
                me(),
                message == null ? "Apply static effect?" : message,
                hostCard == null ? null : hostCard.getName(),
                "static_application",
                mode == null ? null : mode.toString(),
                logic);
    }

    @Override
    public boolean confirmPayment(final CostPart costPart, final String prompt, final SpellAbility sa) {
        if (costPart == null || costPart instanceof CostPartMana || probingPayability) {
            return true;
        }
        final String description = sourceNamePrompt(prompt == null ? "Confirm payment?" : prompt, sa);
        return session.awaitBooleanChoice(
                "confirm_action",
                me(),
                description,
                sourceName(sa),
                "confirm_payment",
                costPart.getClass().getSimpleName(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
    }

    @Override
    public boolean chooseBinary(
            final SpellAbility sa, final String question, final BinaryChoiceType kindOfChoice, final Boolean defaultChoice) {
        return session.awaitBooleanChoice(
                "confirm_action",
                me(),
                question == null ? "Choose" : question,
                sourceName(sa),
                "binary",
                kindOfChoice == null ? null : kindOfChoice.name(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString(),
                binaryLabels(kindOfChoice),
                defaultChoice == null || defaultChoice);
    }

    private static List<String> binaryLabels(final BinaryChoiceType kindOfChoice) {
        if (kindOfChoice == null) {
            return null;
        }
        switch (kindOfChoice) {
            case HeadsOrTails:
                return Lists.newArrayList("heads", "tails");
            case TapOrUntap:
                return Lists.newArrayList("Tap", "Untap");
            case OddsOrEvens:
                return Lists.newArrayList("Odds", "Evens");
            case UntapOrLeaveTapped:
                return Lists.newArrayList("Untap", "Leave tapped");
            case PlayOrDraw:
                return Lists.newArrayList("Play", "Draw");
            case LeftOrRight:
                return Lists.newArrayList("Left", "Right");
            case AddOrRemove:
                return Lists.newArrayList("Add Counter", "Remove Counter");
            case IncreaseOrDecrease:
                return Lists.newArrayList("Increase", "Decrease");
            default:
                return Lists.newArrayList(kindOfChoice.toString().split("Or"));
        }
    }

    @Override
    public boolean chooseFlipResult(final SpellAbility sa, final Player flipper, final boolean[] results, final boolean call) {
        final List<String> labels = call
                ? Lists.newArrayList("heads", "tails")
                : Lists.newArrayList("win the flip", "lose the flip");
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Choose a result", sourceName(sa), "flip_coin", null, null, labels, null);
    }

    @Override
    public boolean chooseCardsPile(
            final SpellAbility sa, final CardCollectionView pile1, final CardCollectionView pile2, final String faceUp) {
        final List<String> labels = new ArrayList<>();
        labels.add(pileLabel(1, pile1, "False".equals(faceUp)));
        labels.add(pileLabel(2, pile2, !"True".equals(faceUp)));
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, sourceName(sa));
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx == 0;
    }

    private static String pileLabel(final int pileNumber, final CardCollectionView pile, final boolean revealed) {
        final StringBuilder label = new StringBuilder()
                .append("-- Pile ").append(pileNumber).append(" (").append(pile.size()).append(" cards) --");
        if (revealed) {
            for (final Card card : pile) {
                label.append(" ").append(card.getName());
            }
        }
        return label.toString();
    }

    @Override
    public boolean willPutCardOnTop(final Card c) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Put on top of library?", c == null ? null : c.getName(), "put_on_top", null, null);
    }

    @Override
    public boolean helpPayForAssistSpell(final ManaCostBeingPaid cost, final SpellAbility sa, final int max, final int requested) {
        final String title = String.format(
                "%s trying to cast (%s) How much would you like to help pay for Assist? (Max: %s)",
                sa.getActivatingPlayer(), sa, max);
        final int willPay = chooseNumber(sa, title, 0, max);
        if (willPay <= 0) {
            return true;
        }
        final ManaCostBeingPaid assistCost = new ManaCostBeingPaid(ManaCost.get(willPay));
        final GameSnapshot snapshot = beginManaPaymentSnapshot();
        if (payManaInteractively(assistCost, sa, true, snapshot)) {
            cost.decreaseGenericMana(willPay);
            return true;
        }
        return false;
    }

    // ── Reveal ────────────────────────────────────────────────────────

    @Override
    public void reveal(
            final CardCollectionView cards, final ZoneType zone, final Player owner, final String messagePrefix, final boolean addMsgSuffix) {
        session.awaitRevealCards(me(), cards, zone, owner == null ? player : owner, messagePrefix);
    }

    @Override
    public void reveal(
            final List<CardView> cards, final ZoneType zone, final PlayerView owner, final String messagePrefix, final boolean addMsgSuffix) {
        session.awaitRevealCardViews(me(), cards, zone, owner, messagePrefix);
    }

    // ── Scry / surveil / library order ────────────────────────────────

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(final CardCollection topN) {
        final Pair<CardCollection, CardCollection> decision = session.awaitCardIdListChoice(
                "choose_scry", "scry_decision", "bottom_card_ids", me(), topN, sourceName(null));
        return ImmutablePair.of(decision.getRight(), decision.getLeft());
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(final CardCollection topN) {
        final Pair<CardCollection, CardCollection> decision = session.awaitCardIdListChoice(
                "choose_surveil", "surveil_decision", "graveyard_card_ids", me(), topN, sourceName(null));
        return ImmutablePair.of(decision.getRight(), decision.getLeft());
    }

    @Override
    public CardCollectionView orderMoveToZoneList(
            final CardCollectionView cards, final ZoneType destinationZone, final SpellAbility source) {
        if (cards.size() <= 1) {
            return new CardCollection(cards);
        }
        final boolean orderedByEffect = source != null && source.getApi() == ApiType.ReorderZone;
        if (destinationZone == ZoneType.Graveyard && !orderedByEffect) {
            return new CardCollection(cards);
        }
        switch (destinationZone) {
            case Library:
            case Battlefield:
            case Graveyard:
            case Exile:
            case PlanarDeck:
            case SchemeDeck:
            case AttractionDeck:
            case ContraptionDeck:
            case Stack:
            case None:
                break;
            default:
                return new CardCollection(cards);
        }
        final boolean topOfDeck = destinationZone.isDeck()
                && (source == null
                        || !source.hasParam("LibraryPosition")
                        || AbilityUtils.calculateAmount(source.getHostCard(), source.getParam("LibraryPosition"), source) >= 0);
        return session.awaitReorderZone(me(), cards, destinationZone, topOfDeck, sourceName(source));
    }

    // ── Numbers / colors / types / names ──────────────────────────────

    @Override
    public int chooseNumber(final SpellAbility sa, final String title, final int min, final int max) {
        return session.awaitNumberChoice(me(), min, max, sourceName(sa), title);
    }

    @Override
    public int chooseNumber(final SpellAbility sa, final String title, final List<Integer> values, final Player relatedPlayer) {
        if (values == null || values.isEmpty()) {
            return 0;
        }
        final List<String> labels = new ArrayList<>();
        for (final Integer value : values) {
            labels.add(String.valueOf(value));
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, sourceName(sa));
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < values.size() ? values.get(idx) : values.get(0);
    }

    @Override
    public int chooseNumberForCostReduction(final SpellAbility sa, final int min, final int max) {
        return max;
    }

    @Override
    public int chooseNumberForKeywordCost(
            final SpellAbility sa, final Cost cost, final KeywordInterface keyword, final String prompt, final int max) {
        return session.awaitNumberChoice(me(), 0, Math.max(0, max), sourceName(sa), prompt == null ? "Choose count" : prompt);
    }

    @Override
    public Integer announceRequirements(final SpellAbility ability, final String announce) {
        final int[] bounds = EngineHandler.announceBounds(player, ability, announce);
        if (bounds == null) {
            return null;
        }
        if (bounds[0] >= bounds[1]) {
            return bounds[0];
        }
        if (ability.getPayCosts() != null && ability.getPayCosts().isMandatory()) {
            return session.awaitNumberChoice(me(), bounds[0], bounds[1], sourceName(ability), "Announce " + announce);
        }
        return session.awaitCancellableNumberChoice(me(), bounds[0], bounds[1], sourceName(ability), "Announce " + announce);
    }

    @Override
    public byte chooseColor(final String message, final SpellAbility sa, final ColorSet colors) {
        final int cntColors = colors == null ? 0 : colors.countColors();
        switch (cntColors) {
            case 0:
                return 0;
            case 1:
                return colors.getColor();
            default:
                final List<String> colorNames = new ArrayList<>();
                for (final Color color : colors) {
                    colorNames.add(colorName(color));
                }
                final String chosen =
                        session.awaitStringChoice("choose_color", me(), colorNames, sourceName(sa), message);
                return colorMask(chosen);
        }
    }

    @Override
    public byte chooseColorAllowColorless(final String message, final Card c, final ColorSet colors) {
        final int cntColors = 1 + (colors == null ? 0 : colors.countColors());
        if (cntColors == 1) {
            return 0;
        }
        final List<String> colorNames = new ArrayList<>();
        for (final Color color : colors) {
            colorNames.add(colorName(color));
        }
        if (!colors.isColorless()) {
            colorNames.add(colorName(Color.COLORLESS));
        }
        final String chosen = session.awaitStringChoice(
                "choose_color", me(), colorNames, c == null ? null : c.getName(), message);
        return colorMask(chosen);
    }

    @Override
    public ColorSet chooseColors(final String message, final SpellAbility sa, final int min, final int max, final ColorSet options) {
        if (options == null || options.isColorless()) {
            return ColorSet.fromMask(0);
        }
        final List<String> labels = new ArrayList<>();
        final List<Byte> atoms = new ArrayList<>();
        for (final Color color : options) {
            labels.add(colorName(color));
            atoms.add(color.getColorMask());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, min, max, sourceName(sa));
        int mask = 0;
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < atoms.size()) {
                mask |= atoms.get(index);
            }
        }
        return ColorSet.fromMask(mask);
    }

    @Override
    public String chooseSomeType(
            final String kindOfType, final SpellAbility sa, final Collection<String> validTypes, final boolean isOptional) {
        final List<String> typeOptions = validTypes == null ? new ArrayList<>() : new ArrayList<>(validTypes);
        if (isOptional) {
            final List<Integer> chosen = session.awaitModeChoice(me(), typeOptions, 0, 1, sourceName(sa));
            if (chosen.isEmpty()) {
                return null;
            }
            final int idx = chosen.get(0);
            return idx >= 0 && idx < typeOptions.size() ? typeOptions.get(idx) : null;
        }
        final String chosen = session.awaitStringChoice("choose_type", me(), typeOptions, sourceName(sa), kindOfType == null ? "Card" : kindOfType);
        return EngineHandler.validateOption(chosen, typeOptions, isOptional);
    }

    @Override
    public String chooseSector(final Card assignee, final String ai, final List<String> sectors) {
        final List<String> options = sectors == null ? new ArrayList<>() : new ArrayList<>(sectors);
        final String chosen = session.awaitStringChoice(
                "choose_type", me(), options, assignee == null ? null : assignee.getName(), "Sector");
        return EngineHandler.validateOption(chosen, options, false);
    }

    @Override
    public int chooseSprocket(final Card assignee, final boolean forceDifferent) {
        final List<Integer> options = new ArrayList<>(List.of(1, 2, 3));
        if (forceDifferent && assignee != null) {
            options.remove(Integer.valueOf(assignee.getSprocket()));
        }
        return chooseNumber(null, "Choose sprocket", options, null);
    }

    @Override
    public String chooseKeywordForPump(final List<String> options, final SpellAbility sa, final String prompt, final Card tgtCard) {
        final List<String> choices = options == null ? new ArrayList<>() : new ArrayList<>(options);
        if (choices.size() <= 1) {
            return choices.isEmpty() ? null : choices.get(0);
        }
        final String chosen = session.awaitStringChoice("choose_type", me(), choices, sourceName(sa), prompt == null ? "Keyword" : prompt);
        return EngineHandler.validateOption(chosen, choices, false);
    }

    @Override
    public String chooseProtectionType(final String string, final SpellAbility sa, final List<String> choices) {
        final List<String> options = choices == null ? new ArrayList<>() : new ArrayList<>(choices);
        final String chosen = session.awaitStringChoice("choose_type", me(), options, sourceName(sa), string == null ? "Protection" : string);
        return EngineHandler.validateOption(chosen, options, false);
    }

    @Override
    public CounterType chooseCounterType(
            final List<CounterType> options, final SpellAbility sa, final String prompt, final Map<String, Object> params) {
        if (options == null || options.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final CounterType type : options) {
            labels.add(type == null ? "Counter" : type.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, sourceName(sa));
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < options.size() ? options.get(idx) : options.get(0);
    }

    @Override
    public String chooseCardName(final SpellAbility sa, final List<ICardFace> faces, final String message) {
        final ICardFace face = chooseSingleCardFace(sa, faces, message);
        return face == null ? "" : face.getName();
    }

    @Override
    public String chooseCardName(final SpellAbility sa, final Predicate<ICardFace> cpp, final String valid, final String message) {
        final List<ICardFace> faces = filterCardFaces(sa, cpp, valid);
        return chooseCardName(sa, faces, message);
    }

    @Override
    public ICardFace chooseSingleCardFace(final SpellAbility sa, final String message, final Predicate<ICardFace> cpp, final String name) {
        final List<ICardFace> faces = filterCardFaces(sa, cpp, null);
        return chooseSingleCardFace(sa, faces, message);
    }

    @Override
    public ICardFace chooseSingleCardFace(final SpellAbility sa, final List<ICardFace> faces, final String message) {
        if (faces == null || faces.isEmpty()) {
            return null;
        }
        final List<String> names = new ArrayList<>();
        for (final ICardFace face : faces) {
            names.add(face.getName());
        }
        final String chosen = session.awaitStringChoice("choose_card_name", me(), names, sourceName(sa), message);
        for (final ICardFace face : faces) {
            if (face.getName().equals(chosen)) {
                return face;
            }
        }
        return faces.get(0);
    }

    @Override
    public CardState chooseSingleCardState(
            final SpellAbility sa, final List<CardState> states, final String message, final Map<String, Object> params) {
        if (states == null || states.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final CardState state : states) {
            labels.add(state == null ? "Face" : state.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, sourceName(sa));
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < states.size() ? states.get(idx) : states.get(0);
    }

    // ── Optional / additional costs ───────────────────────────────────

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(final SpellAbility chosen, final List<OptionalCostValue> optionalCostValues) {
        if (optionalCostValues == null || optionalCostValues.isEmpty()) {
            return new ArrayList<>();
        }
        final List<String> labels = new ArrayList<>();
        for (final OptionalCostValue value : optionalCostValues) {
            labels.add(value == null ? "Optional cost" : value.toString());
        }
        final List<Integer> chosenIndices = session.awaitModeChoice(me(), labels, 0, optionalCostValues.size(), sourceName(chosen));
        final List<OptionalCostValue> selected = new ArrayList<>();
        for (final Integer index : chosenIndices) {
            if (index != null && index >= 0 && index < optionalCostValues.size()) {
                selected.add(optionalCostValues.get(index));
            }
        }
        return selected;
    }

    @Override
    public List<CostPart> orderCosts(final List<CostPart> costs) {
        return costs;
    }

    @Override
    public boolean payCostToPreventEffect(
            final Cost cost, final SpellAbility sa, final boolean alreadyPaid, final FCollectionView<Player> allPayers) {
        probingPayability = true;
        try {
            if (!ComputerUtilCost.canPayCost(cost, sa, player, true)) {
                return false;
            }
        } finally {
            probingPayability = false;
        }
        final boolean accept = session.awaitBooleanChoice(
                "pay_cost_to_prevent_effect",
                me(),
                cost == null ? "Pay cost?" : cost.toString(),
                sourceName(sa),
                "pay_cost_to_prevent_effect",
                cost == null ? null : cost.getClass().getSimpleName(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
        if (!accept) {
            return false;
        }
        return costPlumbing.payWithControllerDecision(cost, sa, true);
    }

    @Override
    public boolean payCostDuringRoll(final Cost cost, final SpellAbility sa, final FCollectionView<Player> allPayers) {
        probingPayability = true;
        try {
            if (!ComputerUtilCost.canPayCost(cost, sa, player, true)) {
                return false;
            }
        } finally {
            probingPayability = false;
        }
        final boolean accept = session.awaitBooleanChoice(
                "pay_cost_to_prevent_effect",
                me(),
                cost == null ? "Pay cost?" : cost.toString(),
                sourceName(sa),
                "pay_cost_during_roll",
                cost == null ? null : cost.getClass().getSimpleName(),
                null);
        return accept && costPlumbing.payWithControllerDecision(cost, sa, true);
    }

    @Override
    public boolean payCombatCost(final Card card, final Cost cost, final SpellAbility sa, final String prompt) {
        return costPlumbing.payWithControllerDecision(cost, sa, true);
    }

    // ── Mana payment (interactive) ────────────────────────────────────

    @Override
    public boolean payManaCost(
            final ManaCost toPay,
            final CostPartMana costPartMana,
            final SpellAbility sa,
            final String prompt,
            final ManaConversionMatrix matrix,
            final boolean effect
    ) {
        final ManaCostBeingPaid toPayBeing = effectiveManaCost(toPay, costPartMana, sa);
        final ManaCost payableCost = toPayBeing == null ? toPay : toPayBeing.toManaCost();
        if (sa == null
                || sa.isManaAbility()
                || payableCost == null
                || payableCost.isNoCost()) {
            if (sa != null && payableCost != null && !payableCost.isNoCost()) {
                applyManaConversionMatrix(matrix, sa);
            }
            return autoPay.payManaCost(payableCost, sa, effect);
        }
        final Player activator = sa.getActivatingPlayer() != null ? sa.getActivatingPlayer() : player;
        final GameSnapshot snapshot = beginManaPaymentSnapshot();
        final CardCollection cardsToDelve = new CardCollection();
        CostAdjustment.adjust(toPayBeing, sa, activator, cardsToDelve, false, effect);
        if ((sa.isOffering() && sa.getSacrificedAsOffering() == null)
                || (sa.isEmerge() && sa.getSacrificedAsEmerge() == null)) {
            restoreManaPaymentSnapshot(snapshot);
            sa.setSkip(true);
            return false;
        }
        boolean paid = toPayBeing.isPaid();
        if (!paid) {
            applyManaConversionMatrix(matrix, sa);
            paid = payManaInteractively(toPayBeing, sa, effect, snapshot);
            if (paid) {
                sa.getHostCard().setXManaCostPaidByColor(toPayBeing.getXManaCostPaidByColor());
            }
        }
        return handleOfferingConvokeAndDelve(sa, cardsToDelve, !paid);
    }

    private ManaCostBeingPaid effectiveManaCost(final ManaCost toPay, final CostPartMana costPartMana, final SpellAbility sa) {
        if (sa != null && sa.getManaCostBeingPaid() != null) {
            return new ManaCostBeingPaid(sa.getManaCostBeingPaid());
        }
        if (toPay == null) {
            return null;
        }
        final ManaCostBeingPaid toPayBeing = new ManaCostBeingPaid(toPay);
        if (sa == null) {
            return toPayBeing;
        }
        final Card source = sa.getHostCard();
        final String xInCard = sa.getParamOrDefault("XAlternative", sa.getSVar("X"));
        String xColor = sa.getXColor();
        if (source != null && source.hasKeyword("Spend only colored mana on X. No more than one mana of each color may be spent this way.")) {
            xColor = "WUBRGX";
        }
        if (costPartMana != null && costPartMana.getAmountOfX() > 0 && !"Count$xPaid".equals(xInCard)) {
            final int xPaid = AbilityUtils.calculateAmount(source, xInCard, sa);
            toPayBeing.setXManaCostPaid(xPaid, xColor);
            sa.setXManaCostPaid(xPaid);
        } else if (sa.getXManaCostPaid() != null) {
            toPayBeing.setXManaCostPaid(sa.getXManaCostPaid(), xColor);
        }
        return toPayBeing;
    }

    private void applyManaConversionMatrix(final ManaConversionMatrix matrix, final SpellAbility sa) {
        ManaConversionMatrix extraMatrix = matrix;
        if (extraMatrix == null) {
            extraMatrix = new ManaConversionMatrix();
            extraMatrix.restoreColorReplacements();
            final Player activator = sa.getActivatingPlayer() != null ? sa.getActivatingPlayer() : player;
            StaticAbilityManaConvert.manaConvert(extraMatrix, activator, sa.getHostCard(), null);
        }
        player.getManaPool().applyCardMatrix(extraMatrix);
    }

    private boolean handleOfferingConvokeAndDelve(
            final SpellAbility ability, final CardCollection cardsToDelve, final boolean manaInputCancelled) {
        final Card hostCard = ability.getHostCard();
        final CardZoneTable table = new CardZoneTable(game.getLastStateBattlefield(), game.getLastStateGraveyard());
        final Map<AbilityKey, Object> params = AbilityKey.newMap();
        AbilityKey.addCardZoneTableParams(params, table);

        if (!manaInputCancelled && !cardsToDelve.isEmpty()) {
            for (final Card c : cardsToDelve) {
                hostCard.addDelved(c);
                final Card d = game.getAction().exile(c, null, params);
                hostCard.addExiledCard(d);
                d.setExiledWith(hostCard);
                d.setExiledBy(hostCard.getController());
                d.setExiledSA(ability);
            }
        }
        if (ability.isOffering() && ability.getSacrificedAsOffering() != null) {
            final Card offering = ability.getSacrificedAsOffering();
            offering.setUsedToPay(false);
            if (!manaInputCancelled) {
                game.getAction().sacrifice(new CardCollection(offering), ability, false, params);
            }
            ability.resetSacrificedAsOffering();
        }
        if (ability.isEmerge() && ability.getSacrificedAsEmerge() != null) {
            final Card emerge = ability.getSacrificedAsEmerge();
            emerge.setUsedToPay(false);
            if (!manaInputCancelled) {
                game.getAction().sacrifice(new CardCollection(emerge), ability, false, params);
                ability.setSacrificedAsEmerge(game.getChangeZoneLKIInfo(emerge));
            } else {
                ability.resetSacrificedAsEmerge();
            }
        }
        if (!table.isEmpty() && !manaInputCancelled) {
            table.triggerChangesZoneAll(game, ability);
        }
        return !manaInputCancelled;
    }

    private boolean payManaInteractively(
            final ManaCostBeingPaid unpaid, final SpellAbility sa, final boolean effect, final GameSnapshot sessionSnapshot) {
        final ManaPool pool = player.getManaPool();
        final Map<Integer, Card> sessionTapped = new LinkedHashMap<>();
        // CR 118.3c: a mandatory cost the pool can already cover may not be cancelled
        // (mirrors InputPayManaOfCostPayment's constructor).
        boolean mandatory = false;
        if (sa.getPayCosts() != null && sa.getPayCosts().isMandatory()) {
            final List<Mana> refund = new ArrayList<>();
            mandatory = pool.payManaCostFromPool(new ManaCostBeingPaid(unpaid), sa, true, refund);
            pool.refundMana(refund);
        }
        int guard = 0;
        while (guard++ < 512) {
            final List<SpellAbility> sources = autoPay.manaSources(sa);
            final List<Card> untappable = sessionTappedCards(sessionTapped);
            final boolean canConfirm = poolCanCover(pool, unpaid, sa);
            final boolean lifeInsteadBlack =
                    player.hasKeyword("PayLifeInsteadOf:B") && unpaid.hasAnyKind(ManaAtom.BLACK);
            final boolean canPayLife = (unpaid.containsPhyrexianMana() || lifeInsteadBlack)
                    && player.canPayLife(2, effect, sa);
            final ManaBrewInteractiveSession.ManaPaymentChoice choice = session.awaitManaPaymentChoice(
                    me(), sa.getHostCard(), unpaid.toString(), sources, untappable, pool.totalMana(),
                    canConfirm, !mandatory, canPayLife, 2);
            switch (choice.kind()) {
                case TAP: {
                    final SpellAbility chosen = choice.tapAbility();
                    if (chosen == null) {
                        break;
                    }
                    if (choice.color() != null && chosen.getManaPart() != null) {
                        chosen.getManaPart().setExpressChoice(choice.color());
                    }
                    final Card source = chosen.getHostCard();
                    if (autoPay.floatManaFromSource(chosen, effect) && source != null) {
                        sessionTapped.put(source.getId(), source);
                    }
                    break;
                }
                case UNTAP:
                    untapSource(choice.untapCard(), sessionTapped);
                    break;
                case PAY_LIFE: {
                    if (player.canPayLife(2, effect, sa)) {
                        if (unpaid.payPhyrexian()) {
                            sa.setSpendPhyrexianMana(true);
                            player.payLife(2, sa, effect);
                        } else if (player.hasKeyword("PayLifeInsteadOf:B") && unpaid.hasAnyKind(ManaAtom.BLACK)) {
                            unpaid.decreaseShard(ManaCostShard.BLACK, 1);
                            player.payLife(2, sa, effect);
                        }
                    }
                    if (unpaid.isPaid()) {
                        return true;
                    }
                    break;
                }
                case PAY: {
                    if (choice.auto()) {
                        if (autoPay.payManaCost(unpaid.toManaCost(), sa, effect)) {
                            return true;
                        }
                        break;
                    }
                    // Only commit when floating mana fully covers the cost — a partial
                    // payManaCostFromPool spend cannot be cleanly rolled back on cancel.
                    if (!canConfirm) {
                        break;
                    }
                    pool.payManaCostFromPool(unpaid, sa, false, new ArrayList<>());
                    if (unpaid.isPaid()) {
                        return true;
                    }
                    break;
                }
                case CANCEL:
                    if (mandatory) {
                        break;
                    }
                    restoreManaPaymentSnapshot(sessionSnapshot);
                    sa.setSkip(true);
                    return false;
                default:
                    break;
            }
        }
        restoreManaPaymentSnapshot(sessionSnapshot);
        sa.setSkip(true);
        return false;
    }

    private boolean poolCanCover(final ManaPool pool, final ManaCostBeingPaid unpaid, final SpellAbility sa) {
        final ManaCostBeingPaid probe = new ManaCostBeingPaid(unpaid.toManaCost());
        final List<Mana> spent = new ArrayList<>();
        final boolean paid = pool.payManaCostFromPool(probe, sa, true, spent);
        if (!paid) {
            pool.refundMana(spent);
        }
        return paid;
    }

    private List<Card> sessionTappedCards(final Map<Integer, Card> sessionTapped) {
        final List<Card> out = new ArrayList<>();
        for (final Card source : sessionTapped.values()) {
            if (source != null && !out.contains(source)) {
                out.add(source);
            }
        }
        return out;
    }

    private GameSnapshot beginManaPaymentSnapshot() {
        final GameSnapshot snapshot = new GameSnapshot(getGame());
        snapshot.makeCopy();
        return snapshot;
    }

    private void untapSource(final Card source, final Map<Integer, Card> sessionTapped) {
        if (source == null) {
            return;
        }
        undoManaSource(source);
        sessionTapped.remove(source.getId());
    }

    private void restoreManaPaymentSnapshot(final GameSnapshot snapshot) {
        snapshot.restoreGameState(getGame());
    }

    // ── Voting / division / mana from pool ────────────────────────────

    @Override
    public Object vote(
            final SpellAbility sa,
            final String prompt,
            final List<Object> options,
            final ListMultimap<Object, Player> votes,
            final Player forPlayer,
            final boolean optional
    ) {
        if (options == null || options.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final Object option : options) {
            labels.add(String.valueOf(option));
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, optional ? 0 : 1, 1, sourceName(sa));
        if (chosen.isEmpty()) {
            return null;
        }
        final int idx = chosen.get(0);
        return idx >= 0 && idx < options.size() ? options.get(idx) : null;
    }

    @Override
    public Map<GameEntity, Integer> divideShield(final Card effectSource, final Map<GameEntity, Integer> affected, final int shieldAmount) {
        final Map<GameEntity, Integer> out = new LinkedHashMap<>();
        if (affected == null || shieldAmount <= 0) {
            return out;
        }
        final List<GameEntity> pool = new ArrayList<>();
        for (final Map.Entry<GameEntity, Integer> e : affected.entrySet()) {
            if (e.getKey() != null && e.getValue() != null && e.getValue() > 0) {
                pool.add(e.getKey());
                out.put(e.getKey(), 0);
            }
        }
        int remaining = shieldAmount;
        while (remaining > 0 && !pool.isEmpty()) {
            final List<String> labels = new ArrayList<>();
            for (final GameEntity entity : pool) {
                labels.add(entity.getName());
            }
            final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, effectSource == null ? null : effectSource.getName());
            final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
            final GameEntity entity = pool.get(idx >= 0 && idx < pool.size() ? idx : 0);
            final int current = out.getOrDefault(entity, 0);
            final int cap = affected.getOrDefault(entity, 0);
            out.put(entity, current + 1);
            remaining--;
            if (current + 1 >= cap) {
                pool.remove(entity);
            }
        }
        return out;
    }

    @Override
    public Map<Byte, Integer> specifyManaCombo(final SpellAbility sa, final ColorSet colorSet, final int manaAmount, final boolean different) {
        final Map<Byte, Integer> result = new LinkedHashMap<>();
        ColorSet mutable = colorSet == null
                ? ColorSet.fromMask(0)
                : ColorSet.fromMask(colorSet.getColor() & ~Color.COLORLESS.getColorMask());
        int remaining = different ? Math.min(manaAmount, mutable.countColors()) : manaAmount;
        while (remaining > 0 && !mutable.isColorless()) {
            final byte chosen = chooseColor("", sa, mutable);
            result.put(chosen, result.getOrDefault(chosen, 0) + 1);
            if (different) {
                mutable = ColorSet.fromMask(mutable.getColor() & ~chosen);
            }
            remaining--;
        }
        return result;
    }

    @Override
    public Mana chooseManaFromPool(final List<Mana> manaChoices) {
        if (manaChoices == null || manaChoices.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final Mana mana : manaChoices) {
            labels.add(mana == null ? "Mana" : mana.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, null);
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < manaChoices.size() ? manaChoices.get(idx) : manaChoices.get(0);
    }

    @Override
    public Player choosePlayerToAssistPayment(final FCollectionView<Player> optionList, final SpellAbility sa, final String title, final int max) {
        if (probingPayability) {
            return null;
        }
        final List<Player> players = new ArrayList<>();
        for (final Player p : optionList) {
            players.add(p);
        }
        if (players.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final Player p : players) {
            labels.add(p.getName());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 0, 1, sourceName(sa));
        if (chosen.isEmpty()) {
            return null;
        }
        final int idx = chosen.get(0);
        return idx >= 0 && idx < players.size() ? players.get(idx) : null;
    }

    @Override
    public Player chooseStartingPlayer(final boolean isFirstGame) {
        final List<Player> players = getGame().getPlayers();
        if (players.size() <= 1) {
            return players.get(0);
        }
        return session.awaitFirstPlayerRoll(me(), players);
    }

    @Override
    public PlayerZone chooseStartingHand(final List<PlayerZone> zones) {
        if (zones == null || zones.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final PlayerZone zone : zones) {
            labels.add(zone == null ? "Hand" : zone.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, null);
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < zones.size() ? zones.get(idx) : zones.get(0);
    }

    // ── Dice ──────────────────────────────────────────────────────────

    @Override
    public PlanarDice choosePDRollToIgnore(final List<PlanarDice> rolls) {
        return chooseFromList(rolls);
    }

    @Override
    public Integer chooseRollToIgnore(final List<Integer> rolls) {
        return chooseFromList(rolls);
    }

    @Override
    public List<Integer> chooseDiceToReroll(final List<Integer> rolls) {
        if (rolls == null || rolls.isEmpty()) {
            return new ArrayList<>();
        }
        final List<String> labels = new ArrayList<>();
        for (final Integer roll : rolls) {
            labels.add(String.valueOf(roll));
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 0, rolls.size(), null);
        final List<Integer> out = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < rolls.size()) {
                out.add(rolls.get(index));
            }
        }
        return out;
    }

    @Override
    public Integer chooseRollToModify(final List<Integer> rolls) {
        return chooseFromListOptional(rolls);
    }

    @Override
    public RollDiceEffect.DieRollResult chooseRollToSwap(final List<RollDiceEffect.DieRollResult> rolls) {
        return chooseFromListOptional(rolls);
    }

    @Override
    public String chooseRollSwapValue(final List<String> swapChoices, final Integer currentResult, final int power, final int toughness) {
        return chooseFromListOptional(swapChoices);
    }

    // ── Deck / ante / headless no-ops ─────────────────────────────────

    @Override
    public List<PaperCard> sideboard(final Deck deck, final GameType gameType, final String message) {
        return null;
    }

    @Override
    public List<PaperCard> chooseCardsYouWonToAddToDeck(final List<PaperCard> losses) {
        return null;
    }

    @Override
    public void notifyOfValue(final SpellAbility saSource, final GameObject realtedTarget, final String value) {
        final String message = MessageUtil.formatNotificationMessage(saSource, player, realtedTarget, value);
        if (saSource != null && saSource.isManaAbility()) {
            game.getGameLog().add(GameLogEntryType.LAND, message);
        } else {
            session.awaitNotifyAcknowledgement(me(), message);
        }
    }

    @Override
    public void revealAnte(final String message, final Multimap<Player, PaperCard> removedAnteCards) {
        for (final Player p : removedAnteCards.keySet()) {
            session.awaitNotifyAcknowledgement(me(), fromPlayerDeckMessage(message, p)
                    + ": " + paperCardNames(removedAnteCards.get(p)));
        }
    }

    @Override
    public void revealAISkipCards(final String message, final Map<Player, Map<DeckSection, List<? extends PaperCard>>> deckCards) {
        for (final Player p : deckCards.keySet()) {
            final Map<DeckSection, List<? extends PaperCard>> removedUnplayableCards = deckCards.get(p);
            final StringBuilder labels = new StringBuilder();
            for (final DeckSection s : new TreeSet<>(removedUnplayableCards.keySet())) {
                labels.append(" === ").append(s).append(" === ");
                labels.append(paperCardNames(removedUnplayableCards.get(s)));
            }
            session.awaitNotifyAcknowledgement(me(), fromPlayerDeckMessage(message, p) + ":" + labels);
        }
    }

    @Override
    public void revealUnsupported(final Map<Player, List<PaperCard>> unsupported) {
        for (final Player p : unsupported.keySet()) {
            final List<PaperCard> removed = unsupported.get(p);
            if (removed == null || removed.isEmpty()) {
                continue;
            }
            session.awaitNotifyAcknowledgement(me(), fromPlayerDeckMessage("Removed", p)
                    + ": " + paperCardNames(removed));
        }
    }

    private String fromPlayerDeckMessage(final String message, final Player p) {
        return message + " from " + Lang.getInstance().getPossessedObject(MessageUtil.mayBeYou(player, p), "deck");
    }

    private static String paperCardNames(final Iterable<? extends PaperCard> cards) {
        final List<String> names = new ArrayList<>();
        for (final PaperCard card : cards) {
            names.add(card.getName());
        }
        return String.join(", ", names);
    }

    @Override
    public void resetAtEndOfTurn() {
    }

    @Override
    public void autoPassCancel() {
    }

    @Override
    public void awaitNextInput() {
    }

    @Override
    public void cancelAwaitNextInput() {
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private <T> T chooseFromList(final List<T> options) {
        if (options == null || options.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final T option : options) {
            labels.add(String.valueOf(option));
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, null);
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < options.size() ? options.get(idx) : options.get(0);
    }

    private <T> T chooseFromListOptional(final List<T> options) {
        if (options == null || options.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final T option : options) {
            labels.add(String.valueOf(option));
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 0, 1, null);
        if (chosen.isEmpty()) {
            return null;
        }
        final int idx = chosen.get(0);
        return idx >= 0 && idx < options.size() ? options.get(idx) : null;
    }

    private List<Card> chooseCardSubset(final List<Card> cards, final String title) {
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect", me(), new CardCollection(cards), 0, cards.size(), null, title);
        return new ArrayList<>(selected);
    }

    private <T extends GameEntity> T chooseSingleEntityGeneric(
            final FCollectionView<T> optionList, final SpellAbility sa, final String title, final boolean isOptional) {
        final List<T> opts = new ArrayList<>();
        for (final T option : optionList) {
            opts.add(option);
        }
        if (opts.isEmpty()) {
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final T option : opts) {
            labels.add(option == null ? "?" : option.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, isOptional ? 0 : 1, 1, sourceName(sa));
        if (chosen.isEmpty()) {
            return null;
        }
        final int idx = chosen.get(0);
        return idx >= 0 && idx < opts.size() ? opts.get(idx) : null;
    }

    private <T extends GameEntity> List<T> chooseEntitiesGeneric(
            final FCollectionView<T> optionList, final int min, final int max, final SpellAbility sa) {
        final List<T> opts = new ArrayList<>();
        for (final T option : optionList) {
            opts.add(option);
        }
        final List<String> labels = new ArrayList<>();
        for (final T option : opts) {
            labels.add(option == null ? "?" : option.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, min, max, sourceName(sa));
        final List<T> out = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < opts.size()) {
                out.add(opts.get(index));
            }
        }
        return out;
    }

    private List<ICardFace> filterCardFaces(final SpellAbility sa, final Predicate<ICardFace> cpp, final String valid) {
        final Card source = sa == null ? null : sa.getHostCard();
        final Predicate<ICardFace> faceFilter = cpp == null ? x -> true : cpp;
        final List<ICardFace> faces = new ArrayList<>();
        forge.StaticData.instance().getCommonCards().streamAllFaces()
                .filter(faceFilter)
                .filter(face -> {
                    if (valid == null || valid.isEmpty()) {
                        return true;
                    }
                    final PaperCard cp = forge.StaticData.instance().getCommonCards().getCard(face.getName());
                    if (cp == null) {
                        return false;
                    }
                    final Card instanceForPlayer = Card.fromPaperCard(cp, player);
                    final Player sourceController = source == null ? player : source.getController();
                    return instanceForPlayer.isValid(valid, sourceController, source, sa);
                })
                .sorted()
                .forEach(faces::add);
        return faces;
    }

    private List<Pair<GameEntity, GameObject>> targetCandidates(
            final SpellAbility ability,
            final TargetRestrictions restrictions,
            final Predicate<GameObject> filter,
            final List<Card> mustTargetCards) {
        final List<Pair<GameEntity, GameObject>> valid = new ArrayList<>();
        for (final GameEntity candidate : restrictions.getAllCandidates(ability, true)) {
            if (mustTargetCards != null && (!(candidate instanceof Card) || !mustTargetCards.contains(candidate))) {
                continue;
            }
            final GameObject normalized = normalizeStackTargetCandidate(candidate);
            if (ability.canTarget(normalized) && (filter == null || filter.test(normalized))) {
                valid.add(ImmutablePair.of(candidate, normalized));
            }
        }
        if (mustTargetCards == null) {
            valid.addAll(ActionSpace.getStackTargetCandidates(ability));
        }
        final Map<String, Pair<GameEntity, GameObject>> deduped = new LinkedHashMap<>();
        for (final Pair<GameEntity, GameObject> pair : valid) {
            deduped.putIfAbsent(targetCandidateKey(pair), pair);
        }
        return new ArrayList<>(deduped.values());
    }

    private GameObject normalizeStackTargetCandidate(final GameObject candidate) {
        if (candidate instanceof Card && ((Card) candidate).isInZone(ZoneType.Stack)) {
            final Card card = (Card) candidate;
            for (final SpellAbilityStackInstance item : card.getGame().getStack()) {
                if (item.getSourceCard() == card) {
                    return item.getSpellAbility();
                }
            }
        }
        return candidate;
    }

    private String targetCandidateKey(final Pair<GameEntity, GameObject> pair) {
        final GameObject normalized = pair == null ? null : pair.getRight();
        if (normalized instanceof SpellAbility) {
            return "spell:" + ((SpellAbility) normalized).getId();
        }
        if (normalized instanceof Card) {
            return "card:" + ((Card) normalized).getId();
        }
        if (normalized instanceof Player) {
            return "player:" + ((Player) normalized).getId();
        }
        return String.valueOf(normalized);
    }

    private static String sourceName(final SpellAbility sa) {
        return sa == null || sa.getHostCard() == null ? null : sa.getHostCard().getName();
    }

    private static String sourceNamePrompt(final String prompt, final SpellAbility sa) {
        final String name = sourceName(sa);
        if (name == null) {
            return prompt;
        }
        return prompt.replace("CARDNAME", name).replace("NICKNAME", Lang.getInstance().getNickName(name));
    }

    private static <T extends GameEntity> CardCollection cardOptions(final FCollectionView<T> optionList) {
        final CardCollection cards = new CardCollection();
        for (final T option : optionList) {
            if (!(option instanceof Card)) {
                return null;
            }
            cards.add((Card) option);
        }
        return cards;
    }

    private static String colorName(final Color color) {
        if (color == Color.WHITE) {
            return "White";
        }
        if (color == Color.BLUE) {
            return "Blue";
        }
        if (color == Color.BLACK) {
            return "Black";
        }
        if (color == Color.RED) {
            return "Red";
        }
        if (color == Color.GREEN) {
            return "Green";
        }
        return "Colorless";
    }

    private static byte colorMask(final String color) {
        if ("White".equals(color)) {
            return Color.WHITE.getColorMask();
        }
        if ("Blue".equals(color)) {
            return Color.BLUE.getColorMask();
        }
        if ("Black".equals(color)) {
            return Color.BLACK.getColorMask();
        }
        if ("Red".equals(color)) {
            return Color.RED.getColorMask();
        }
        if ("Green".equals(color)) {
            return Color.GREEN.getColorMask();
        }
        return Color.COLORLESS.getColorMask();
    }

    private Map<Card, Integer> fallbackCombatDamage(
            final Card attacker, final CardCollectionView blockers, final int damageDealt, final GameEntity defender) {
        final Map<Card, Integer> result = new LinkedHashMap<>();
        int damageLeft = damageDealt;
        final boolean canTrampleToDefender = defender != null && attacker != null && attacker.hasKeyword("Trample");
        for (final Card blocker : blockers) {
            final int lethal = ComputerUtilCombat.getEnoughDamageToKill(blocker, damageLeft, attacker, false, false);
            final int assign = Math.min(lethal, damageLeft);
            result.put(blocker, assign);
            damageLeft -= assign;
            if (damageLeft <= 0) {
                break;
            }
        }
        if (damageLeft > 0) {
            if (canTrampleToDefender) {
                result.put(null, damageLeft);
            } else if (!blockers.isEmpty()) {
                final Card last = blockers.get(blockers.size() - 1);
                result.put(last, result.getOrDefault(last, 0) + damageLeft);
            }
        }
        return result;
    }
}
