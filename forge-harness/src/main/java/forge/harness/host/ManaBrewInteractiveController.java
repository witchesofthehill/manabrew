package forge.harness.host;

import forge.harness.parity.GuiRepro;

import forge.harness.common.ActionSpace;
import forge.harness.common.AutoPay;
import forge.harness.common.ChoiceSpace;
import forge.harness.common.CombatChoiceSpace;
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
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.*;
import forge.game.ability.ApiType;
import forge.game.ability.effects.RollDiceEffect;
import forge.game.card.*;
import forge.game.combat.Combat;
import forge.game.cost.*;
import forge.game.keyword.KeywordInterface;
import forge.game.mana.*;
import forge.game.player.*;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.*;
import forge.game.staticability.StaticAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.PlayerZone;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.ITriggerEvent;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

public final class ManaBrewInteractiveController extends PlayerController implements HarnessPlayHooks {
    private final Game game;
    private final ManaBrewInteractiveSession session;
    private final HarnessCostPlumbing costPlumbing;
    private final AutoPay autoPay;
    private final HarnessPlayPlumbing playPlumbing;

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
        this.autoPay = new AutoPay(player, costPlumbing);
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
    public boolean confirmPlayEffectOptional() {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Play this spell or ability?", null, "play_effect_optional", null, null);
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
        while (true) {
            final List<SpellAbility> all = ChoiceSpace.sortNative(
                    new ArrayList<>(ActionSpace.getPossibleActions(player, true)),
                    ParityOrder.actionComparator());
            final ManaBrewInteractiveSession.PriorityChoice choice =
                    session.awaitPriorityAction(me(), all, undoableManaSources());
            if (choice.kind() == ManaBrewInteractiveSession.PriorityActionKind.UNDO) {
                game.getStack().undo();
                continue;
            }
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

    @Override
    public boolean playChosenSpellAbility(final SpellAbility sa) {
        session.beginCast(sa);
        try {
            return playPlumbing.handlePlayingSpellAbility(player, sa, getGame());
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
        if (abilities.size() == 1) {
            return abilities.get(0);
        }
        final List<String> labels = new ArrayList<>();
        for (final SpellAbility sa : abilities) {
            labels.add(sa == null ? "Ability" : sa.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, 1, 1, hostCard == null ? null : hostCard.getName());
        final int idx = chosen.isEmpty() ? 0 : chosen.get(0);
        return idx >= 0 && idx < abilities.size() ? abilities.get(idx) : abilities.get(0);
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
            if (card != null && defender != null && !selected.contains(card)) {
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
        final List<Pair<Card, Card>> assignments = session.awaitBlockers(
                SnapshotExtractor.playerIndex(game, defender), attackers, blockers);
        for (final Pair<Card, Card> assignment : assignments) {
            final Card blocker = assignment.getLeft();
            final Card attacker = assignment.getRight();
            if (blocker != null && attacker != null && CombatChoiceSpace.canBlock(attacker, blocker, combat)) {
                combat.addBlocker(attacker, blocker);
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
        return session.awaitDamageAssignmentOrder(me(), attacker, all);
    }

    @Override
    public CardCollection orderAttackers(final Card blocker, final CardCollection attackers) {
        return session.awaitDamageAssignmentOrder(me(), blocker, attackers);
    }

    @Override
    public Map<Card, Integer> assignCombatDamage(
            final Card attacker,
            final CardCollectionView blockers,
            final CardCollectionView remaining,
            final int damageDealt,
            final GameEntity defender,
            final boolean overrideOrder
    ) {
        final Map<Card, Integer> selected = session.awaitCombatDamageAssignment(me(), attacker, blockers, damageDealt, defender);
        if (!selected.isEmpty()) {
            return selected;
        }
        return fallbackCombatDamage(attacker, blockers, damageDealt, defender);
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
        while (!currentAbility.isTargetNumberValid()) {
            final List<Pair<GameEntity, GameObject>> valid = targetCandidates(currentAbility, tr);
            if (valid.isEmpty()) {
                return currentAbility.isTargetNumberValid();
            }
            final Pair<GameEntity, GameObject> chosen = session.awaitTargetChoice(me(), currentAbility, valid);
            if (chosen == null) {
                return currentAbility.isTargetNumberValid();
            }
            currentAbility.getTargets().add(chosen.getRight());
            if (!currentAbility.canAddMoreTarget()) {
                break;
            }
        }
        return currentAbility.isTargetNumberValid();
    }

    @Override
    public TargetChoices chooseNewTargetsFor(final SpellAbility ability, final Predicate<GameObject> filter, final boolean optional) {
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
        return session.awaitCardChoice("choose_discard", me(), hand, min, min, sourceName(sa), null);
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
        return session.awaitCardChoice("choose_cards_for_effect", me(), sourceList, isOptional ? 0 : min, max, sourceName(sa), title);
    }

    @Override
    public CardCollection chooseCardsForEffectMultiple(
            final Map<String, CardCollection> validMap, final SpellAbility sa, final String title, final boolean isOptional) {
        final CardCollection chosen = new CardCollection();
        if (validMap == null || validMap.isEmpty()) {
            return chosen;
        }
        for (final CardCollection pool : validMap.values()) {
            if (pool == null || pool.isEmpty()) {
                continue;
            }
            final CardCollection remaining = new CardCollection(pool);
            remaining.removeAll(chosen);
            if (remaining.isEmpty()) {
                continue;
            }
            final CardCollection pick = session.awaitCardChoice(
                    "choose_cards_for_effect", me(), remaining, isOptional ? 0 : 1, 1, sourceName(sa), title);
            chosen.addAll(pick);
        }
        return chosen;
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
        final CardCollection cards = cardOptions(optionList);
        if (cards == null) {
            return chooseSingleEntityGeneric(optionList, sa, title, isOptional);
        }
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect", me(), cards, isOptional ? 0 : 1, 1, sourceName(sa), title);
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
        final CardCollection cards = cardOptions(optionList);
        if (cards == null) {
            return chooseEntitiesGeneric(optionList, min, max, sa);
        }
        final CardCollection selected;
        if (sa != null && sa.getApi() == ApiType.Dig) {
            selected = session.awaitDigChoice(me(), cards, max, min == 0, sourceName(sa));
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
        return session.awaitCardChoice("choose_cards_for_effect", me(), validTargets, min, max, sourceName(sa), message);
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(
            final SpellAbility sa, final int min, final int max, final CardCollectionView validTargets, final String message) {
        return session.awaitCardChoice("choose_cards_for_effect", me(), validTargets, min, max, sourceName(sa), message);
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
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect", me(), fetchList, isOptional ? 0 : 1, 1, sourceName(sa), selectPrompt);
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
        return new ArrayList<Card>(session.awaitCardChoice(
                "choose_cards_for_effect", me(), fetchList, min, max, sourceName(sa), selectPrompt));
    }

    @Override
    public CardCollectionView chooseCardsToDelve(final int genericAmount, final CardCollection grave) {
        return session.awaitCardChoice("choose_delve", me(), grave, 0, Math.min(genericAmount, grave.size()));
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
        final String kind = artifacts && !creatures ? "choose_improvise" : "choose_convoke";
        final Map<Card, ManaCostShard> result = new LinkedHashMap<>();
        if (untappedCards == null || untappedCards.isEmpty()) {
            return result;
        }
        final int cap = maxReduction == null
                ? untappedCards.size()
                : Math.max(0, Math.min(maxReduction, untappedCards.size()));
        final CardCollection selected = session.awaitCardChoice(
                kind, me(), untappedCards, 0, cap, sourceName(sa), manaCost == null ? null : manaCost.toString());
        for (final Card card : selected) {
            result.put(card, ManaCostShard.GENERIC);
        }
        return result;
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
        return session.awaitCardChoice("reveal_cards", me(), valid, min, max);
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
        final List<Integer> chosen = session.awaitModeChoice(me(), labels, min, num, sourceName(sa));
        final List<AbilitySub> selected = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < possible.size()) {
                selected.add(possible.get(index));
            }
        }
        return selected;
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
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
    }

    @Override
    public boolean confirmBidAction(
            final SpellAbility sa, final PlayerActionConfirmMode bidlife, final String string, final int bid, final Player winner) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), string == null ? "Bid life?" : string, sourceName(sa), "confirm_bid", null, null);
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
        if (costPart == null || costPart instanceof CostPartMana) {
            return true;
        }
        if (HarnessCostPlumbing.isSpellPaymentContext(sa)) {
            return true;
        }
        return session.awaitBooleanChoice(
                "confirm_action",
                me(),
                prompt == null ? "Confirm payment?" : prompt,
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
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
    }

    @Override
    public boolean chooseFlipResult(final SpellAbility sa, final Player flipper, final boolean[] results, final boolean call) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Call heads?", sourceName(sa), "flip_coin", null, null);
    }

    @Override
    public boolean chooseCardsPile(
            final SpellAbility sa, final CardCollectionView pile1, final CardCollectionView pile2, final String faceUp) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Choose the first pile?", sourceName(sa), "cards_pile", null, null);
    }

    @Override
    public boolean willPutCardOnTop(final Card c) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Put on top of library?", c == null ? null : c.getName(), "put_on_top", null, null);
    }

    @Override
    public boolean helpPayForAssistSpell(final ManaCostBeingPaid cost, final SpellAbility sa, final int max, final int requested) {
        return session.awaitBooleanChoice(
                "confirm_action", me(), "Assist with payment?", sourceName(sa), "assist_payment", null, null);
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
        final CardCollection bottom = session.awaitCardIdListChoice(
                "choose_scry", "scry_decision", "bottom_card_ids", me(), topN, sourceName(null));
        final CardCollection top = new CardCollection(topN);
        top.removeAll(bottom);
        return ImmutablePair.of(top, bottom);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(final CardCollection topN) {
        final CardCollection graveyard = session.awaitCardIdListChoice(
                "choose_surveil", "surveil_decision", "graveyard_card_ids", me(), topN, sourceName(null));
        final CardCollection top = new CardCollection(topN);
        top.removeAll(graveyard);
        return ImmutablePair.of(top, graveyard);
    }

    @Override
    public CardCollectionView orderMoveToZoneList(
            final CardCollectionView cards, final ZoneType destinationZone, final SpellAbility source) {
        if (destinationZone != ZoneType.Library) {
            return new CardCollection(cards);
        }
        return session.awaitReorderLibrary(me(), cards, sourceName(source));
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
        return session.awaitNumberChoice(me(), min, max, sourceName(sa), "Choose amount");
    }

    @Override
    public int chooseNumberForKeywordCost(
            final SpellAbility sa, final Cost cost, final KeywordInterface keyword, final String prompt, final int max) {
        return session.awaitNumberChoice(me(), 0, Math.max(0, max), sourceName(sa), prompt == null ? "Choose count" : prompt);
    }

    @Override
    public Integer announceRequirements(final SpellAbility ability, final String announce) {
        final int[] bounds = GuiRepro.announceBounds(player, ability, announce);
        if (bounds == null) {
            return null;
        }
        if (bounds[0] >= bounds[1]) {
            return bounds[0];
        }
        return session.awaitNumberChoice(me(), bounds[0], bounds[1], sourceName(ability), "Announce " + announce);
    }

    @Override
    public byte chooseColor(final String message, final SpellAbility sa, final ColorSet colors) {
        final List<String> colorNames = new ArrayList<>();
        if (colors != null) {
            for (final Color color : colors) {
                colorNames.add(colorName(color));
            }
        }
        final String chosen = session.awaitStringChoice("choose_color", me(), colorNames, sourceName(sa), message);
        return colorMask(chosen);
    }

    @Override
    public byte chooseColorAllowColorless(final String message, final Card c, final ColorSet colors) {
        final List<String> colorNames = new ArrayList<>();
        if (colors != null) {
            for (final Color color : colors) {
                colorNames.add(colorName(color));
            }
        }
        if (colorNames.isEmpty()) {
            return Color.COLORLESS.getColorMask();
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
        return session.awaitStringChoice("choose_type", me(), typeOptions, sourceName(sa), kindOfType == null ? "Card" : kindOfType);
    }

    @Override
    public String chooseSector(final Card assignee, final String ai, final List<String> sectors) {
        final List<String> options = sectors == null ? new ArrayList<>() : new ArrayList<>(sectors);
        return session.awaitStringChoice(
                "choose_type", me(), options, assignee == null ? null : assignee.getName(), "Sector");
    }

    @Override
    public int chooseSprocket(final Card assignee, final boolean forceDifferent) {
        return session.awaitNumberChoice(me(), 1, 3, assignee == null ? null : assignee.getName(), "Choose sprocket");
    }

    @Override
    public String chooseKeywordForPump(final List<String> options, final SpellAbility sa, final String prompt, final Card tgtCard) {
        final List<String> choices = options == null ? new ArrayList<>() : new ArrayList<>(options);
        return session.awaitStringChoice("choose_type", me(), choices, sourceName(sa), prompt == null ? "Keyword" : prompt);
    }

    @Override
    public String chooseProtectionType(final String string, final SpellAbility sa, final List<String> choices) {
        final List<String> options = choices == null ? new ArrayList<>() : new ArrayList<>(choices);
        return session.awaitStringChoice("choose_type", me(), options, sourceName(sa), string == null ? "Protection" : string);
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
        final List<String> names = new ArrayList<>();
        for (final ICardFace face : faces) {
            names.add(face.getName());
        }
        return session.awaitStringChoice("choose_card_name", me(), names, sourceName(sa), message);
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
        if (!ComputerUtilCost.canPayCost(cost, sa, player, true)) {
            return false;
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
        return alreadyPaid || costPlumbing.payWithControllerDecision(cost, sa, true);
    }

    @Override
    public boolean payCostDuringRoll(final Cost cost, final SpellAbility sa, final FCollectionView<Player> allPayers) {
        if (!ComputerUtilCost.canPayCost(cost, sa, player, true)) {
            return false;
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
        return playPlumbing.playNoStack(card.getController(), sa, getGame(), true);
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
        final ManaCost payableCost = effectiveManaCost(toPay, sa, effect);
        if (sa == null
                || sa.isManaAbility()
                || payableCost == null
                || payableCost.isNoCost()
                || payableCost.isZero()) {
            return autoPay.payManaCost(payableCost, sa, effect);
        }
        return payManaInteractively(payableCost, sa, effect);
    }

    private ManaCost effectiveManaCost(final ManaCost toPay, final SpellAbility sa, final boolean effect) {
        ManaCost payableCost = toPay;
        if (sa != null && sa.getXManaCostPaid() != null && toPay != null && toPay.countX() > 0) {
            final ManaCostBeingPaid expanded = new ManaCostBeingPaid(toPay);
            expanded.setXManaCostPaid(sa.getXManaCostPaid(), sa.getXColor());
            payableCost = expanded.toManaCost();
        }
        if (sa != null && sa.getManaCostBeingPaid() != null) {
            return new ManaCostBeingPaid(sa.getManaCostBeingPaid()).toManaCost();
        }
        if (sa != null
                && sa.isSpell()
                && sa.getHostCard() != null
                && payableCost != null
                && !payableCost.isNoCost()) {
            final ManaCostBeingPaid adjusted = new ManaCostBeingPaid(payableCost);
            final Player payer = sa.getActivatingPlayer() != null ? sa.getActivatingPlayer() : player;
            if (CostAdjustment.adjust(adjusted, sa, payer, null, true, effect)) {
                payableCost = adjusted.toManaCost();
            }
        }
        return payableCost;
    }

    private boolean payManaInteractively(final ManaCost payableCost, final SpellAbility sa, final boolean effect) {
        final ManaCostBeingPaid unpaid = new ManaCostBeingPaid(payableCost);
        final ManaPool pool = player.getManaPool();
        final Set<Integer> sessionTapped = new LinkedHashSet<>();
        int guard = 0;
        while (guard++ < 512) {
            final List<SpellAbility> sources = autoPay.manaSources(sa);
            final List<Card> untappable = sessionTappedCards(sessionTapped);
            final boolean canConfirm = poolCanCover(pool, unpaid, sa);
            final ManaBrewInteractiveSession.ManaPaymentChoice choice = session.awaitManaPaymentChoice(
                    me(), sa.getHostCard(), unpaid.toString(), sources, untappable, pool.totalMana(), canConfirm);
            switch (choice.kind()) {
                case TAP: {
                    final SpellAbility chosen = choice.tapAbility();
                    if (chosen == null) {
                        break;
                    }
                    if (choice.color() != null && chosen.getManaPart() != null) {
                        chosen.getManaPart().setExpressChoice(choice.color());
                    }
                    if (autoPay.floatManaFromSource(chosen, effect) && chosen.getHostCard() != null) {
                        sessionTapped.add(chosen.getHostCard().getId());
                    }
                    break;
                }
                case UNTAP:
                    untapSource(choice.untapCard(), pool, sessionTapped);
                    break;
                case PAY: {
                    if (choice.auto()) {
                        if (autoPay.payManaCost(unpaid.toManaCost(), sa, effect)) {
                            CostPayment.handleOfferings(sa, false, true);
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
                        CostPayment.handleOfferings(sa, false, true);
                        return true;
                    }
                    break;
                }
                case CANCEL:
                    refundSession(pool, sessionTapped);
                    sa.setSkip(true);
                    CostPayment.handleOfferings(sa, false, false);
                    return false;
                default:
                    break;
            }
        }
        refundSession(pool, sessionTapped);
        sa.setSkip(true);
        CostPayment.handleOfferings(sa, false, false);
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

    private List<Card> sessionTappedCards(final Set<Integer> sessionTapped) {
        final List<Card> out = new ArrayList<>();
        for (final Mana mana : player.getManaPool()) {
            final Card source = mana.getSourceCard();
            if (source != null && sessionTapped.contains(source.getId()) && !out.contains(source)) {
                out.add(source);
            }
        }
        return out;
    }

    private void untapSource(final Card source, final ManaPool pool, final Set<Integer> sessionTapped) {
        if (source == null) {
            return;
        }
        final List<Mana> toRemove = new ArrayList<>();
        for (final Mana mana : pool) {
            if (mana.getSourceCard() != null && mana.getSourceCard().getId() == source.getId()) {
                toRemove.add(mana);
            }
        }
        for (final Mana mana : toRemove) {
            pool.removeMana(mana);
        }
        source.untap();
        sessionTapped.remove(source.getId());
    }

    private void refundSession(final ManaPool pool, final Set<Integer> sessionTapped) {
        for (final Card source : sessionTappedCards(sessionTapped)) {
            untapSource(source, pool, sessionTapped);
        }
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
        ColorSet mutable = colorSet;
        for (int i = 0; i < manaAmount; i++) {
            final byte chosen = chooseColor("", sa, mutable);
            result.put(chosen, result.getOrDefault(chosen, 0) + 1);
            if (different) {
                mutable = ColorSet.fromMask(mutable.getColor() & ~chosen);
            }
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
        final boolean playFirst = session.awaitBooleanChoice(
                "confirm_action",
                me(),
                "Play first?",
                null,
                "choose_starting_player",
                null,
                null);
        if (playFirst) {
            return player;
        }
        for (final Player other : players) {
            if (other != player) {
                return other;
            }
        }
        return player;
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
        return chooseFromList(rolls);
    }

    @Override
    public RollDiceEffect.DieRollResult chooseRollToSwap(final List<RollDiceEffect.DieRollResult> rolls) {
        return chooseFromList(rolls);
    }

    @Override
    public String chooseRollSwapValue(final List<String> swapChoices, final Integer currentResult, final int power, final int toughness) {
        final List<String> options = swapChoices == null ? new ArrayList<>() : new ArrayList<>(swapChoices);
        return session.awaitStringChoice("choose_type", me(), options, null, "Swap value");
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
        // interactive client reads state from snapshots — nothing to push here
    }

    @Override
    public void revealAnte(final String message, final Multimap<Player, PaperCard> removedAnteCards) {
    }

    @Override
    public void revealAISkipCards(final String message, final Map<Player, Map<DeckSection, List<? extends PaperCard>>> deckCards) {
    }

    @Override
    public void revealUnsupported(final Map<Player, List<PaperCard>> unsupported) {
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

    private List<Pair<GameEntity, GameObject>> targetCandidates(final SpellAbility ability, final TargetRestrictions restrictions) {
        final List<Pair<GameEntity, GameObject>> valid = new ArrayList<>();
        for (final GameEntity candidate : restrictions.getAllCandidates(ability, true)) {
            final GameObject normalized = normalizeStackTargetCandidate(candidate);
            if (ability.canTarget(normalized)) {
                valid.add(ImmutablePair.of(candidate, normalized));
            }
        }
        valid.addAll(ActionSpace.getStackTargetCandidates(ability));
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
