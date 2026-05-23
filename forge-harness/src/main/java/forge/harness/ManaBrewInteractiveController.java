package forge.harness;

import com.google.common.collect.Lists;
import forge.ai.ComputerUtilCombat;
import forge.ai.ComputerUtilCost;
import forge.LobbyPlayer;
import forge.card.ColorSet;
import forge.card.ICardFace;
import forge.card.MagicColor.Color;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.game.ability.ApiType;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.cost.Cost;
import forge.game.cost.CostPart;
import forge.game.cost.CostPartMana;
import forge.game.player.DelayedReveal;
import forge.game.player.Player;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.player.PlayerView;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.spellability.TargetRestrictions;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class ManaBrewInteractiveController extends DeterministicController {
    private final Game game;
    private final ManaBrewInteractiveSession session;
    private final DeterministicCostPlumbing interactiveCostPlumbing;

    public ManaBrewInteractiveController(
            final Game game,
            final Player player,
            final LobbyPlayer lobbyPlayer,
            final ManaBrewInteractiveSession session
    ) {
        super(game, player, lobbyPlayer, new CountingRandom(0), false, true);
        this.game = game;
        this.session = session;
        this.interactiveCostPlumbing = new DeterministicCostPlumbing(this, player);
    }

    @Override
    public boolean mulliganKeepHand(final Player mulliganingPlayer, final int cardsToReturn) {
        final boolean keep = session.awaitMulliganDecision(
                SnapshotExtractor.playerIndex(game, player),
                cardsToReturn);
        if (keep && cardsToReturn > 0) {
            final CardCollection hand = new CardCollection(player.getCardsIn(ZoneType.Hand));
            final CardCollection selected = session.awaitMulliganPutBack(
                    SnapshotExtractor.playerIndex(game, player),
                    hand,
                    cardsToReturn);
            for (final forge.game.card.Card card : selected) {
                game.getAction().moveToLibrary(card, -1, null);
            }
            onCallback("choose_cards_to_bottom", selected.toString(), String.valueOf(hand.size()),
                    String.valueOf(cardsToReturn));
        }
        onCallback("mulligan_decision", Boolean.toString(keep),
                String.valueOf(player.getCardsIn(ZoneType.Hand).size()),
                String.valueOf(cardsToReturn));
        return keep;
    }

    @Override
    public CardCollection tuckCardsViaMulligan(final Player mulliganingPlayer, final int cardsToReturn) {
        return new CardCollection();
    }

    @Override
    public void declareAttackers(final Player attacker, final Combat combat) {
        combat.clearAttackers();
        final List<Card> legalAttackers = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalAttackers(attacker, combat),
                ParityOrder.cardComparator());
        final List<Pair<Card, GameEntity>> assignments = session.awaitAttackAssignments(
                SnapshotExtractor.playerIndex(game, attacker),
                combat,
                legalAttackers);
        final CardCollection selected = new CardCollection();
        for (final Pair<Card, GameEntity> assignment : assignments) {
            final Card card = assignment.getLeft();
            final GameEntity defender = assignment.getRight();
            if (card != null && defender != null && !selected.contains(card)) {
                combat.addAttacker(card, defender);
                selected.add(card);
            }
        }
        onCallback("choose_attackers", selected.toString(), String.valueOf(legalAttackers.size()),
                String.valueOf(combat.getDefenders().size()));
    }

    @Override
    public void declareBlockers(final Player defender, final Combat combat) {
        final List<Card> attackers = ChoiceSpace.sortNative(
                new ArrayList<Card>(combat.getAttackers()),
                ParityOrder.cardComparator());
        final List<Card> blockers = ChoiceSpace.sortNative(
                CombatChoiceSpace.legalBlockers(defender, combat),
                ParityOrder.cardComparator());
        final List<Pair<Card, Card>> assignments = session.awaitBlockers(
                SnapshotExtractor.playerIndex(game, defender),
                attackers,
                blockers);
        final List<String> pairDescs = new ArrayList<>();
        for (final Pair<Card, Card> assignment : assignments) {
            final Card blocker = assignment.getLeft();
            final Card attacker = assignment.getRight();
            if (blocker != null && attacker != null && CombatChoiceSpace.canBlock(attacker, blocker, combat)) {
                combat.addBlocker(attacker, blocker);
                pairDescs.add(blocker.getName() + " -> " + attacker.getName());
            }
        }
        onCallback("choose_blockers",
                pairDescs.isEmpty() ? "[]" : "[" + String.join(", ", pairDescs) + "]",
                String.valueOf(attackers.size()),
                String.valueOf(blockers.size()),
                "none");
    }

    @Override
    public CardCollection orderBlockers(final Card attacker, final CardCollection blockers) {
        final CardCollection ordered = session.awaitDamageAssignmentOrder(
                SnapshotExtractor.playerIndex(game, player),
                attacker,
                blockers);
        onCallback("choose_damage_assignment_order", ordered.toString(), attacker == null ? "null" : attacker.getName());
        return ordered;
    }

    @Override
    public CardCollection orderBlocker(final Card attacker, final Card blocker, final CardCollection oldBlockers) {
        final CardCollection all = new CardCollection(oldBlockers);
        all.add(blocker);
        final CardCollection ordered = session.awaitDamageAssignmentOrder(
                SnapshotExtractor.playerIndex(game, player),
                attacker,
                all);
        onCallback("choose_damage_assignment_order", ordered.toString(), attacker == null ? "null" : attacker.getName());
        return ordered;
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
        final Map<Card, Integer> selected = session.awaitCombatDamageAssignment(
                SnapshotExtractor.playerIndex(game, player),
                attacker,
                blockers,
                damageDealt,
                defender);
        if (!selected.isEmpty()) {
            onCallback("assign_combat_damage", selected.toString(),
                    attacker == null ? "null" : attacker.getName(),
                    String.valueOf(damageDealt));
            return selected;
        }
        final Map<Card, Integer> fallback = fallbackCombatDamage(attacker, blockers, damageDealt, defender);
        onCallback("assign_combat_damage", fallback.toString(),
                attacker == null ? "null" : attacker.getName(),
                String.valueOf(damageDealt));
        return fallback;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        final List<SpellAbility> all = ChoiceSpace.sortNative(
                new ArrayList<>(ActionSpace.getPossibleActions(player)),
                ParityOrder.actionComparator());
        final SpellAbility selected = session.awaitPriorityAction(
                SnapshotExtractor.playerIndex(game, player), all);
        if (selected == null) {
            onCallback("choose_action", "PassPriority");
            return null;
        }
        onCallback("choose_action", selected.toString());
        return Lists.newArrayList(selected);
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(
            final Player playerDiscard,
            final SpellAbility sa,
            final CardCollection validCards,
            final int min,
            final int max
    ) {
        final CardCollection selected = session.awaitCardChoice(
                "choose_discard",
                SnapshotExtractor.playerIndex(game, player),
                validCards,
                min,
                max);
        onCallback("choose_discard", selected.toString(), String.valueOf(validCards.size()),
                String.valueOf(min), String.valueOf(max));
        return selected;
    }

    @Override
    public CardCollection chooseCardsToDiscardToMaximumHandSize(final int numDiscard) {
        final CardCollection hand = new CardCollection(player.getCardsIn(ZoneType.Hand));
        final CardCollection selected = session.awaitCardChoice(
                "choose_discard",
                SnapshotExtractor.playerIndex(game, player),
                hand,
                numDiscard,
                numDiscard);
        onCallback("choose_discard", selected.toString(), String.valueOf(hand.size()),
                String.valueOf(numDiscard), String.valueOf(numDiscard));
        return selected;
    }

    @Override
    public boolean confirmPayment(final CostPart costPart, final String prompt, final SpellAbility sa) {
        if (costPart == null || costPart instanceof CostPartMana) {
            return true;
        }
        if (DeterministicCostPlumbing.isSpellPaymentContext(sa)) {
            return true;
        }
        final boolean accept = session.awaitBooleanChoice(
                "confirm_action",
                SnapshotExtractor.playerIndex(game, player),
                prompt == null ? "Confirm payment?" : prompt,
                sourceName(sa),
                "confirm_payment",
                costPart.getClass().getSimpleName(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
        onCallback("confirm_payment", Boolean.toString(accept),
                prompt == null ? "?" : prompt,
                sourceName(sa) == null ? "?" : sourceName(sa),
                costPart.getClass().getSimpleName(),
                sa == null || sa.getApi() == null ? "None" : sa.getApi().toString());
        return accept;
    }

    @Override
    public boolean payCostToPreventEffect(
            final Cost cost,
            final SpellAbility sa,
            final boolean alreadyPaid,
            final FCollectionView<Player> allPayers
    ) {
        if (!ComputerUtilCost.canPayCost(cost, sa, player, true)) {
            onCallback("pay_cost_to_prevent_effect", "false", "cannot_pay");
            return false;
        }
        final boolean accept = session.awaitBooleanChoice(
                "pay_cost_to_prevent_effect",
                SnapshotExtractor.playerIndex(game, player),
                cost == null ? "Pay cost?" : cost.toString(),
                sourceName(sa),
                "pay_cost_to_prevent_effect",
                cost == null ? null : cost.getClass().getSimpleName(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
        if (!accept) {
            onCallback("pay_cost_to_prevent_effect", "false", "declined");
            return false;
        }
        final boolean result = alreadyPaid || interactiveCostPlumbing.payWithDeterministicDecision(cost, sa, true);
        onCallback("pay_cost_to_prevent_effect", Boolean.toString(result));
        return result;
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(
            final SpellAbility chosen,
            final List<OptionalCostValue> optionalCostValues
    ) {
        if (optionalCostValues == null || optionalCostValues.isEmpty()) {
            onCallback("choose_optional_costs", "[]", "0");
            return new ArrayList<>();
        }
        final List<String> labels = new ArrayList<>();
        for (final OptionalCostValue value : optionalCostValues) {
            labels.add(value == null ? "Optional cost" : value.toString());
        }
        final List<Integer> chosenIndices = session.awaitModeChoice(
                SnapshotExtractor.playerIndex(game, player),
                labels,
                0,
                optionalCostValues.size(),
                sourceName(chosen));
        final List<OptionalCostValue> selected = new ArrayList<>();
        for (final Integer index : chosenIndices) {
            if (index != null && index >= 0 && index < optionalCostValues.size()) {
                selected.add(optionalCostValues.get(index));
            }
        }
        onCallback("choose_optional_costs", selected.toString(), String.valueOf(optionalCostValues.size()));
        return selected;
    }

    @Override
    public int chooseNumberForKeywordCost(
            final SpellAbility sa,
            final Cost cost,
            final forge.game.keyword.KeywordInterface keyword,
            final String prompt,
            final int max
    ) {
        final int chosen = session.awaitNumberChoice(
                SnapshotExtractor.playerIndex(game, player),
                0,
                Math.max(0, max),
                sourceName(sa),
                prompt == null ? "Choose count" : prompt);
        onCallback("choose_number_for_keyword_cost", String.valueOf(chosen), String.valueOf(max));
        return chosen;
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
        final CardCollectionView selected = session.awaitCardChoice(
                "choose_cards_for_effect",
                SnapshotExtractor.playerIndex(game, player),
                sourceList,
                isOptional ? 0 : min,
                max,
                sourceName(sa),
                title);
        onCallback("choose_cards_for_effect", selected.toString(), String.valueOf(sourceList.size()),
                String.valueOf(min), String.valueOf(max));
        return selected;
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
            return super.chooseSingleEntityForEffect(optionList, null, sa, title, isOptional, relatedPlayer, params);
        }
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect",
                SnapshotExtractor.playerIndex(game, player),
                cards,
                isOptional ? 0 : 1,
                1,
                sourceName(sa),
                title);
        onCallback("choose_single_entity_for_effect", selected.toString(), String.valueOf(cards.size()));
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
            return super.chooseEntitiesForEffect(optionList, min, max, null, sa, title, relatedPlayer, params);
        }
        final CardCollection selected;
        if (sa != null && sa.getApi() == ApiType.Dig) {
            selected = session.awaitDigChoice(
                    SnapshotExtractor.playerIndex(game, player),
                    cards,
                    max,
                    min == 0,
                    sourceName(sa));
            onCallback("choose_dig", selected.toString(), String.valueOf(cards.size()), String.valueOf(min),
                    String.valueOf(max));
        } else {
            selected = session.awaitCardChoice(
                    "choose_cards_for_effect",
                    SnapshotExtractor.playerIndex(game, player),
                    cards,
                    min,
                    max,
                    sourceName(sa),
                    title);
            onCallback("choose_entities_for_effect", selected.toString(), String.valueOf(cards.size()),
                    String.valueOf(min), String.valueOf(max));
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
            final SpellAbility sa,
            final int min,
            final int max,
            final CardCollectionView validTargets,
            final String message
    ) {
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect",
                SnapshotExtractor.playerIndex(game, player),
                validTargets,
                min,
                max,
                sourceName(sa),
                message);
        onCallback("choose_sacrifice", selected.toString(), String.valueOf(validTargets.size()),
                String.valueOf(min), String.valueOf(max));
        return selected;
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(
            final SpellAbility sa,
            final int min,
            final int max,
            final CardCollectionView validTargets,
            final String message
    ) {
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect",
                SnapshotExtractor.playerIndex(game, player),
                validTargets,
                min,
                max,
                sourceName(sa),
                message);
        onCallback("choose_destroy", selected.toString(), String.valueOf(validTargets.size()),
                String.valueOf(min), String.valueOf(max));
        return selected;
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
                "choose_cards_for_effect",
                SnapshotExtractor.playerIndex(game, player),
                fetchList,
                isOptional ? 0 : 1,
                1,
                sourceName(sa),
                selectPrompt);
        onCallback("choose_single_card_for_zone_change", selected.toString(),
                String.valueOf(fetchList.size()), selectPrompt == null ? "?" : selectPrompt);
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
        final CardCollection selected = session.awaitCardChoice(
                "choose_cards_for_effect",
                SnapshotExtractor.playerIndex(game, player),
                fetchList,
                min,
                max,
                sourceName(sa),
                selectPrompt);
        onCallback("choose_cards_for_zone_change", selected.toString(),
                String.valueOf(fetchList.size()), String.valueOf(min), String.valueOf(max));
        return new ArrayList<Card>(selected);
    }

    @Override
    public CardCollectionView chooseCardsToDelve(final int genericAmount, final CardCollection grave) {
        final CardCollection selected = session.awaitCardChoice(
                "choose_delve",
                SnapshotExtractor.playerIndex(game, player),
                grave,
                0,
                Math.min(genericAmount, grave.size()));
        onCallback("choose_delve", selected.toString(), String.valueOf(grave.size()), String.valueOf(genericAmount));
        return selected;
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
            onCallback(kind, "[]", "0", maxReduction == null ? "none" : String.valueOf(maxReduction));
            return result;
        }
        final int cap = maxReduction == null
                ? untappedCards.size()
                : Math.max(0, Math.min(maxReduction, untappedCards.size()));
        final CardCollection selected = session.awaitCardChoice(
                kind,
                SnapshotExtractor.playerIndex(game, player),
                untappedCards,
                0,
                cap,
                sourceName(sa),
                manaCost == null ? null : manaCost.toString());
        for (final Card card : selected) {
            result.put(card, ManaCostShard.GENERIC);
        }
        onCallback(kind, selected.toString(), String.valueOf(untappedCards.size()), String.valueOf(cap));
        return result;
    }

    @Override
    public void reveal(
            final CardCollectionView cards,
            final ZoneType zone,
            final Player owner,
            final String messagePrefix,
            final boolean addMsgSuffix
    ) {
        session.awaitRevealCards(
                SnapshotExtractor.playerIndex(game, player),
                cards,
                zone,
                owner == null ? player : owner,
                messagePrefix);
        onCallback("reveal_cards", cards == null ? "[]" : cards.toString());
    }

    @Override
    public void reveal(
            final List<CardView> cards,
            final ZoneType zone,
            final PlayerView owner,
            final String messagePrefix,
            final boolean addMsgSuffix
    ) {
        session.awaitRevealCardViews(
                SnapshotExtractor.playerIndex(game, player),
                cards,
                zone,
                owner,
                messagePrefix);
        onCallback("reveal_card_views", cards == null ? "[]" : cards.toString());
    }

    @Override
    public boolean chooseTargetsFor(final SpellAbility currentAbility) {
        if (currentAbility == null || !currentAbility.usesTargeting()) {
            onCallback("choose_targets_for", "true", currentAbility == null ? "null" : currentAbility.toString());
            return true;
        }

        final TargetRestrictions tr = currentAbility.getTargetRestrictions();
        if (tr == null) {
            onCallback("choose_targets_for", "true", currentAbility.toString());
            return true;
        }

        while (!currentAbility.isTargetNumberValid()) {
            final List<Pair<GameEntity, forge.game.GameObject>> valid = targetCandidates(currentAbility, tr);
            if (valid.isEmpty()) {
                final boolean result = currentAbility.isTargetNumberValid();
                onCallback("choose_targets_for", Boolean.toString(result), currentAbility.toString());
                return result;
            }

            final Pair<GameEntity, forge.game.GameObject> chosen = session.awaitTargetChoice(
                    SnapshotExtractor.playerIndex(game, player),
                    currentAbility,
                    valid);
            if (chosen == null) {
                final boolean result = currentAbility.isTargetNumberValid();
                onCallback("choose_targets_for", Boolean.toString(result), currentAbility.toString());
                return result;
            }

            currentAbility.getTargets().add(chosen.getRight());
            if (!currentAbility.canAddMoreTarget()) {
                break;
            }
        }

        final boolean result = currentAbility.isTargetNumberValid();
        onCallback("choose_targets_for", Boolean.toString(result), currentAbility.toString());
        return result;
    }

    @Override
    public List<AbilitySub> chooseModeForAbility(
            final SpellAbility sa,
            final List<AbilitySub> possible,
            final int min,
            final int num,
            final boolean allowRepeat
    ) {
        final List<String> labels = new ArrayList<>();
        for (final AbilitySub mode : possible) {
            labels.add(mode == null ? "Mode" : mode.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(
                SnapshotExtractor.playerIndex(game, player),
                labels,
                min,
                num,
                sourceName(sa));
        final List<AbilitySub> selected = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < possible.size()) {
                selected.add(possible.get(index));
            }
        }
        onCallback("choose_mode", selected.toString(), String.valueOf(possible.size()),
                String.valueOf(min), String.valueOf(num));
        return selected;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(
            final List<SpellAbility> spells,
            final SpellAbility sa,
            final String title,
            final int num,
            final Map<String, Object> params
    ) {
        if (spells == null || spells.isEmpty() || num <= 0) {
            onCallback("choose_spell_abilities_for_effect", "[]", "0", String.valueOf(num));
            return new ArrayList<>();
        }
        final List<String> labels = new ArrayList<>();
        for (final SpellAbility spell : spells) {
            labels.add(spell == null ? "Ability" : spell.toString());
        }
        final List<Integer> chosen = session.awaitModeChoice(
                SnapshotExtractor.playerIndex(game, player),
                labels,
                num,
                num,
                sourceName(sa));
        final List<SpellAbility> selected = new ArrayList<>();
        for (final Integer index : chosen) {
            if (index != null && index >= 0 && index < spells.size()) {
                selected.add(spells.get(index));
            }
        }
        onCallback("choose_spell_abilities_for_effect", String.valueOf(selected.size()),
                String.valueOf(spells.size()), String.valueOf(num));
        return selected;
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(
            final List<SpellAbility> spells,
            final SpellAbility sa,
            final String title,
            final Map<String, Object> params
    ) {
        final List<SpellAbility> selected = chooseSpellAbilitiesForEffect(spells, sa, title, 1, params);
        return selected.isEmpty() ? null : selected.get(0);
    }

    @Override
    public boolean confirmTrigger(final WrappedAbility sa) {
        final boolean accept = session.awaitBooleanChoice(
                "choose_optional_trigger",
                SnapshotExtractor.playerIndex(game, player),
                sa == null ? "Resolve optional trigger?" : sa.getStackDescription(),
                sa == null || sa.getHostCard() == null ? null : sa.getHostCard().getName(),
                "optional_trigger",
                null,
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
        onCallback("choose_optional_trigger", Boolean.toString(accept));
        return accept;
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
        final boolean accept = session.awaitBooleanChoice(
                "confirm_action",
                SnapshotExtractor.playerIndex(game, player),
                message == null ? "Confirm action?" : message,
                cardToShow != null ? cardToShow.getName() : sourceName(sa),
                "confirm_action",
                mode == null ? null : mode.toString(),
                sa == null || sa.getApi() == null ? null : sa.getApi().toString());
        onCallback("confirm_action", Boolean.toString(accept), message == null ? "?" : message);
        return accept;
    }

    @Override
    public boolean confirmReplacementEffect(
            final ReplacementEffect replacementEffect,
            final SpellAbility effectSA,
            final GameEntity affected,
            final String question
    ) {
        final String description = replacementEffect == null ? "Apply replacement effect?" : replacementEffect.getDescription();
        final String source = replacementEffect != null && replacementEffect.getHostCard() != null
                ? replacementEffect.getHostCard().getName()
                : sourceName(effectSA);
        final boolean accept = session.awaitBooleanChoice(
                "choose_optional_trigger",
                SnapshotExtractor.playerIndex(game, player),
                question == null ? description : question,
                source,
                "replacement_effect",
                null,
                effectSA == null || effectSA.getApi() == null ? null : effectSA.getApi().toString());
        onCallback("confirm_replacement_effect", Boolean.toString(accept),
                question == null ? "?" : question,
                description,
                source == null ? "?" : source);
        return accept;
    }

    @Override
    public boolean confirmStaticApplication(
            final Card hostCard,
            final PlayerActionConfirmMode mode,
            final String message,
            final String logic
    ) {
        final boolean accept = session.awaitBooleanChoice(
                "confirm_action",
                SnapshotExtractor.playerIndex(game, player),
                message == null ? "Apply static effect?" : message,
                hostCard == null ? null : hostCard.getName(),
                "static_application",
                mode == null ? null : mode.toString(),
                logic);
        onCallback("confirm_static_application", Boolean.toString(accept),
                hostCard == null ? "?" : hostCard.getName(),
                message == null ? "?" : message);
        return accept;
    }

    @Override
    public ReplacementEffect chooseSingleReplacementEffect(final List<ReplacementEffect> possibleReplacers) {
        if (possibleReplacers == null || possibleReplacers.isEmpty()) {
            onCallback("choose_single_replacement_effect", "null", "0");
            return null;
        }
        final List<String> labels = new ArrayList<>();
        for (final ReplacementEffect replacer : possibleReplacers) {
            labels.add(replacer == null ? "Replacement effect" : replacer.getDescription());
        }
        final List<Integer> chosen = session.awaitModeChoice(
                SnapshotExtractor.playerIndex(game, player),
                labels,
                1,
                1,
                null);
        final int index = chosen.isEmpty() ? -1 : chosen.get(0);
        final ReplacementEffect result = index >= 0 && index < possibleReplacers.size()
                ? possibleReplacers.get(index)
                : null;
        onCallback("choose_single_replacement_effect",
                result == null ? "null" : result.getDescription(),
                String.valueOf(possibleReplacers.size()));
        return result;
    }

    @Override
    public byte chooseColor(final String message, final SpellAbility sa, final ColorSet colors) {
        final List<String> colorNames = new ArrayList<>();
        if (colors != null) {
            for (final Color color : colors) {
                colorNames.add(colorName(color));
            }
        }
        final String chosen = session.awaitStringChoice(
                "choose_color",
                SnapshotExtractor.playerIndex(game, player),
                colorNames,
                sourceName(sa),
                message);
        onCallback("choose_color", chosen, String.valueOf(colorNames.size()));
        return colorMask(chosen);
    }

    @Override
    public String chooseSomeType(
            final String kindOfType,
            final SpellAbility sa,
            final Collection<String> validTypes,
            final boolean isOptional
    ) {
        final List<String> typeOptions = validTypes == null ? new ArrayList<>() : new ArrayList<>(validTypes);
        final String chosen = session.awaitStringChoice(
                "choose_type",
                SnapshotExtractor.playerIndex(game, player),
                typeOptions,
                sourceName(sa),
                kindOfType == null ? "Card" : kindOfType);
        onCallback("choose_type", chosen, kindOfType == null ? "?" : kindOfType,
                String.valueOf(typeOptions.size()));
        return chosen;
    }

    @Override
    public String chooseCardName(final SpellAbility sa, final List<ICardFace> faces, final String message) {
        final List<String> names = new ArrayList<>();
        for (final ICardFace face : faces) {
            names.add(face.getName());
        }
        final String chosen = session.awaitStringChoice(
                "choose_card_name",
                SnapshotExtractor.playerIndex(game, player),
                names,
                sourceName(sa),
                message);
        onCallback("choose_card_name", chosen, String.valueOf(names.size()));
        return chosen;
    }

    @Override
    public int chooseNumber(final SpellAbility sa, final String title, final int min, final int max) {
        final int chosen = session.awaitNumberChoice(
                SnapshotExtractor.playerIndex(game, player),
                min,
                max,
                sourceName(sa),
                title);
        onCallback("choose_number", String.valueOf(chosen), String.valueOf(min), String.valueOf(max));
        return chosen;
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(final CardCollection topN) {
        final CardCollection bottom = session.awaitCardIdListChoice(
                "choose_scry",
                "scry_decision",
                "bottom_card_ids",
                SnapshotExtractor.playerIndex(game, player),
                topN,
                sourceName(null));
        final CardCollection top = new CardCollection(topN);
        top.removeAll(bottom);
        onCallback("choose_scry", bottom.toString(), String.valueOf(topN.size()));
        return ImmutablePair.of(top, bottom);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(final CardCollection topN) {
        final CardCollection graveyard = session.awaitCardIdListChoice(
                "choose_surveil",
                "surveil_decision",
                "graveyard_card_ids",
                SnapshotExtractor.playerIndex(game, player),
                topN,
                sourceName(null));
        final CardCollection top = new CardCollection(topN);
        top.removeAll(graveyard);
        onCallback("choose_surveil", graveyard.toString(), String.valueOf(topN.size()));
        return ImmutablePair.of(top, graveyard);
    }

    @Override
    public CardCollectionView orderMoveToZoneList(
            final CardCollectionView cards,
            final ZoneType destinationZone,
            final SpellAbility source
    ) {
        if (destinationZone != ZoneType.Library) {
            return super.orderMoveToZoneList(cards, destinationZone, source);
        }
        final CardCollection ordered = session.awaitReorderLibrary(
                SnapshotExtractor.playerIndex(game, player),
                cards,
                sourceName(source));
        onCallback("choose_reorder_library", ordered.toString(), String.valueOf(cards.size()));
        return ordered;
    }

    private List<Pair<GameEntity, forge.game.GameObject>> targetCandidates(
            final SpellAbility ability,
            final TargetRestrictions restrictions
    ) {
        final List<Pair<GameEntity, forge.game.GameObject>> valid = new ArrayList<>();
        for (final GameEntity candidate : restrictions.getAllCandidates(ability, true)) {
            final forge.game.GameObject normalized = normalizeStackTargetCandidate(candidate);
            if (ability.canTarget(normalized)) {
                valid.add(ImmutablePair.of(candidate, normalized));
            }
        }
        valid.addAll(ActionSpace.getStackTargetCandidates(ability));

        final Map<String, Pair<GameEntity, forge.game.GameObject>> deduped = new LinkedHashMap<>();
        for (final Pair<GameEntity, forge.game.GameObject> pair : valid) {
            deduped.putIfAbsent(targetCandidateKey(pair), pair);
        }
        return new ArrayList<>(deduped.values());
    }

    private forge.game.GameObject normalizeStackTargetCandidate(final forge.game.GameObject candidate) {
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

    private String targetCandidateKey(final Pair<GameEntity, forge.game.GameObject> pair) {
        final forge.game.GameObject normalized = pair == null ? null : pair.getRight();
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
            final Card attacker,
            final CardCollectionView blockers,
            final int damageDealt,
            final GameEntity defender
    ) {
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
