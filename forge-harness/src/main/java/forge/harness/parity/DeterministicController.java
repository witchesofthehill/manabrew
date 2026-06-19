package forge.harness.parity;

import forge.harness.common.ActionSpace;
import forge.harness.common.AutoPay;
import forge.harness.common.ChoiceSpace;
import forge.harness.common.CombatChoiceSpace;
import forge.harness.common.CountingRandom;
import forge.harness.common.EngineHandler;
import forge.harness.common.DecisionLog;
import forge.harness.common.HarnessCostPlumbing;
import forge.harness.common.HarnessPlayHooks;
import forge.harness.common.HarnessPlayPlumbing;
import forge.harness.common.ParityCardMap;
import forge.harness.common.ParityLog;
import forge.harness.common.ParityOrder;

import com.google.common.collect.Lists;
import com.google.common.collect.ListMultimap;
import com.google.common.collect.Multimap;
import forge.StaticData;
import forge.LobbyPlayer;
import forge.ai.AiCostDecision;
import forge.ai.ComputerUtilCombat;
import forge.ai.ComputerUtilCost;
import forge.game.ability.ApiType;
import forge.game.ability.effects.RollDiceEffect;
import forge.game.cost.Cost;
import forge.game.cost.CostAdjustment;
import forge.game.cost.CostDecisionMakerBase;
import forge.game.cost.CostEnlist;
import forge.game.cost.CostPart;
import forge.game.cost.CostPartWithList;
import forge.game.player.PlayerController;
import forge.game.cost.CostPartMana;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.card.ColorSet;
import forge.card.MagicColor.Color;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.*;
import forge.game.card.*;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.mana.Mana;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.mana.ManaConversionMatrix;
import forge.game.player.*;
import forge.game.card.CounterType;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.*;
import forge.card.ICardFace;
import forge.game.keyword.KeywordInterface;
import forge.game.staticability.StaticAbility;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.PlayerZone;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.ITriggerEvent;
import forge.util.collect.FCollectionView;

import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.*;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * A hybrid deterministic PlayerController for cross-engine parity testing.
 * <p>
 * Uses RNG for 4 core decisions (play choice, attackers, blockers, targeting)
 * and fixed values for everything else. This avoids RNG desync caused by
 * Java and Rust calling non-core callbacks at different times.
 * <p>
 * Both sides share a {@code java.util.Random} / {@code JavaRandom} seeded
 * identically. Core decisions sort options alphabetically then use
 * {@code rng.nextInt()} to pick, consuming the RNG in the same order.
 */
public class DeterministicController extends PlayerController implements HarnessPlayHooks {
    private static final int PREFER_ACTION_WEIGHT = 3;
    private static final int STACK_ACTION_SPACE_SKIP_THRESHOLD = 20;
    private static final int CARD_COPY_GUARD_THRESHOLD = 100;
    private final CountingRandom rng;
    private final boolean preferActions;
    private final boolean deep;
    private final HarnessCostPlumbing costPlumbing;
    private final AutoPay autoPay;
    private final HarnessPlayPlumbing playPlumbing;
    private final Set<Integer> failedPaymentCardsThisTurn = new HashSet<>();
    private final int[] verboseTurns;
    /** Current turn number, updated via game events. */
    private int currentTurn;
    private boolean probingPayability;

    public DeterministicController(Game game, Player p, LobbyPlayer lp, CountingRandom rng, boolean preferActions, boolean deep) {
        this(game, p, lp, rng, preferActions, deep, null);
    }

    public DeterministicController(Game game, Player p, LobbyPlayer lp, CountingRandom rng, boolean preferActions, boolean deep, int[] verboseTurns) {
        super(game, p, lp);
        this.rng = rng;
        this.preferActions = preferActions;
        this.deep = deep;
        this.verboseTurns = verboseTurns;
        this.currentTurn = 0;
        this.costPlumbing = new HarnessCostPlumbing(this, this.player);
        this.autoPay = new AutoPay(this.player, this.costPlumbing);
        this.playPlumbing = new HarnessPlayPlumbing(this, this.player, this.costPlumbing);
    }

    public int getCurrentTurn() {
        return this.currentTurn;
    }

    /** Update the current turn number (called from game event subscribers). */
    public void setCurrentTurn(int turn) {
        if (this.currentTurn != turn) {
            failedPaymentCardsThisTurn.clear();
        }
        this.currentTurn = turn;
    }

    /** Log a turn change (called from game event subscribers). */
    public void logTurnChanged(int turn, int activePlayer) {
        if (isVerbose()) {
            System.err.printf("[parity-agent-java p%d] === Turn %d (P%d active) ===%n",
                player.getId(), turn, activePlayer);
        }
    }

    /** Log a phase change (called from game event subscribers). */
    public void logPhaseChanged(String phase) {
        if (isVerbose()) {
            System.err.printf("[parity-agent-java p%d] --- Phase: %s ---%n",
                player.getId(), phase);
        }
    }

    private boolean isVerbose() {
        if (verboseTurns == null) {
            return false;
        }
        if (verboseTurns.length == 0) {
            return true; // bare --verbose, all turns
        }
        for (int t : verboseTurns) {
            if (t == currentTurn) return true;
        }
        return false;
    }

    /** Callbacks silenced from the parity log (e.g. handled differently by each engine). */
    private static final Set<String> IGNORED_CALLBACKS = Set.of(
            "mulligan_decision"
    );

    public void onCallback(String callbackName, String callbackOutcome, String... args) {
        if (IGNORED_CALLBACKS.contains(callbackName)) return;
        final List<String> choiceLogs = ParityLog.drain();
        DecisionLog.logCallback(player, callbackName, callbackOutcome, choiceLogs, args);
    }

    private void captureDeepCheckpoint(final String kind) {
        if (deep) {
            DecisionLog.logCheckpoint(player, kind);
        }
    }


    private static String formatCard(final Card card) {
        if (card == null) {
            return "null";
        }
        return card.getName() + "@" + ParityCardMap.parityId(card);
    }

    private static String formatCards(final Iterable<? extends Card> cards) {
        if (cards == null) {
            return "null";
        }
        final List<String> out = new ArrayList<>();
        for (final Card card : cards) {
            out.add(formatCard(card));
        }
        return "[" + String.join(", ", out) + "]";
    }

    private static String formatEntity(final GameEntity entity) {
        if (entity == null) {
            return "null";
        }
        if (entity instanceof Player p) {
            return "Player(" + p.getId() + ")";
        }
        if (entity instanceof Card c) {
            return "Card(" + formatCard(c) + ")";
        }
        return entity.getClass().getSimpleName() + "(" + entity.getName() + ")";
    }

    private static String targetCandidateKey(final Pair<GameEntity, GameObject> pair) {
        final GameObject normalized = pair == null ? null : pair.getRight();
        if (normalized instanceof SpellAbility sa) {
            return "spell:" + sa.getId();
        }
        if (normalized instanceof Card c) {
            return "card:" + c.getId();
        }
        if (normalized instanceof Player p) {
            return "player:" + p.getId();
        }

        final GameEntity entity = pair == null ? null : pair.getLeft();
        if (entity instanceof Card c) {
            return "entity-card:" + c.getId();
        }
        if (entity instanceof Player p) {
            return "entity-player:" + p.getId();
        }
        return String.valueOf(normalized);
    }

    private static String formatChooseActionResult(final SpellAbility chosen, final Player player) {
        if (chosen == null) {
            return "PassPriority";
        }
        if (chosen.isActivatedAbility() || chosen.isManaAbility()) {
            final Card host = chosen.getHostCard();
            final int abilityIndex = host == null ? -1 : host.getAllPossibleAbilities(player, false).indexOf(chosen);
            return "ActivateAbility(AbilityRef { card: "
                    + formatCard(host)
                    + ", ability_index: "
                    + abilityIndex
                    + " })";
        }
        return "CastSpell(PlayOption { card: " + formatCard(chosen.getHostCard()) + ", mode: Normal })";
    }

    private static String formatActionSpace(final List<SpellAbility> actions, final Player player) {
        final List<String> rendered = new ArrayList<>();
        for (int i = 0; i < actions.size(); i++) {
            rendered.add("#" + i + " " + formatChooseActionResult(actions.get(i), player));
        }
        rendered.add("PASS");
        return "[" + String.join(" | ", rendered) + "]";
    }

    @Override
    public void markFailedPaymentCard(final Card card) {
        if (card != null) {
            failedPaymentCardsThisTurn.add(card.getId());
        }
    }

    @Override
    public CostDecisionMakerBase getCostDecisionMaker(Player player, SpellAbility ability, boolean effect, String prompt) {
        return new AiCostDecision(player, ability, effect);
    }

    private List<SpellAbility> filterFailedPaymentActions(final List<SpellAbility> actions) {
        if (failedPaymentCardsThisTurn.isEmpty()) {
            return actions;
        }
        return actions.stream()
                .filter(sa -> {
                    final Card host = sa.getHostCard();
                    return host == null || !failedPaymentCardsThisTurn.contains(host.getId());
                })
                .collect(Collectors.toList());
    }

    private boolean chooseDeterministicBooleanDecision(final String decisionType, final String falseLabel, final String trueLabel) {
        final boolean result = ChoiceSpace.pickBool(rng);
        onCallback(decisionType, Boolean.toString(result), falseLabel, trueLabel);
        return result;
    }

    // ── Mulligan ──────────────────────────────────────────────────────

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        // parity runner starts from prebuilt opening hands; always keep
        final boolean result = true;
        onCallback("mulligan_decision", Boolean.toString(result),
                String.valueOf(player.getCardsIn(ZoneType.Hand).size()),
                String.valueOf(cardsToReturn));
        return result;
    }

    public boolean confirmMulliganScry(Player p) {
        onCallback("confirm_mulligan_scry", "false");
        return false;
    }

    // ── Main Phase Action ─────────────────────────────────────────────

    private boolean stopIfCardCopyGuardTripped() {
        Map<String, Integer> counts = new HashMap<>();
        for (Player p : player.getGame().getPlayers()) {
            for (Card c : p.getCardsIn(ZoneType.Battlefield)) {
                int count = counts.getOrDefault(c.getName(), 0) + 1;
                if (count > CARD_COPY_GUARD_THRESHOLD) {
                    DecisionLog.logSnapshot(player.getGame());
                    System.err.printf(
                        "[harness] Truncating parity run: %d copies of %s on battlefield (limit %d)%n",
                        count, c.getName(), CARD_COPY_GUARD_THRESHOLD);
                    player.getGame().setGameOver(GameEndReason.Draw);
                    return true;
                }
                counts.put(c.getName(), count);
            }
        }
        return false;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        if (stopIfCardCopyGuardTripped()) {
            return null;
        }
        if (player.getGame().getStack().size() >= STACK_ACTION_SPACE_SKIP_THRESHOLD) {
            onCallback("$ACTION_SPACE", "SKIPPED stack_depth>=20");
            return null;
        }
        captureDeepCheckpoint("main_action");
        final List<SpellAbility> possible;
        probingPayability = true;
        try {
            possible = new ArrayList<>(ActionSpace.getPossibleActions(player, false));
        } finally {
            probingPayability = false;
        }
        final List<SpellAbility> all = filterFailedPaymentActions(ChoiceSpace.sortNative(
                possible, ParityOrder.actionComparator()));
        if (!all.isEmpty()) {
            onCallback("$ACTION_SPACE", formatActionSpace(all, player));
        }
        if (all.isEmpty()) {
            onCallback("choose_action", "PassPriority");
            return null;
        }

        final int idx;
        if (preferActions) {
            idx = ChoiceSpace.pickWeightedIndexWithPass(all.size(), PREFER_ACTION_WEIGHT, rng);
        } else {
            idx = ChoiceSpace.pickIndexWithPass(all.size(), rng);
        }
        if (idx >= all.size()) {
            onCallback("choose_action", "PassPriority",
                    preferActions ? "weighted_pass" : "pass",
                    String.valueOf(all.size()));
            return null;
        }

        final SpellAbility chosen = all.get(idx);
        onCallback("choose_action", formatChooseActionResult(chosen, player),
                String.valueOf(idx), String.valueOf(all.size()));
        return Lists.newArrayList(chosen);
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility sa) {
        final Integer staleX = sa.getXManaCostPaid();
        sa.setXManaCostPaid(null);
        // Force X to max available mana — matches Rust's choose_x_value default.
        Cost payCosts = sa.getPayCosts();
        if (payCosts != null) {
            ManaCost mana = payCosts.getTotalMana();
            if (mana != null && mana.countX() > 0) {
                int maxX = ComputerUtilCost.setMaxXValue(sa, player, sa.isTrigger());
                sa.setXManaCostPaid(Math.max(maxX, 0));
            }
        }

        final boolean played = playPlumbing.handlePlayingSpellAbility(player, sa, getGame());
        if (!played) {
            sa.setXManaCostPaid(staleX);
        }
        return played;
    }

    @Override
    public void playSpellAbilityNoStack(SpellAbility effectSA, boolean canSetupTargets) {
        if (canSetupTargets && !effectSA.setupTargets()) {
            return;
        }
        playPlumbing.playNoStack(player, effectSA, getGame(), true);
    }

    boolean chooseDeterministicBoolean(
            final String decisionType,
            final String falseLabel,
            final String trueLabel
    ) {
        return chooseDeterministicBooleanDecision(decisionType, falseLabel, trueLabel);
    }

    @Override
    public boolean chooseTargetsFor(final SpellAbility currentAbility) {
        captureDeepCheckpoint("choose_targets_for");
        if (currentAbility == null || !currentAbility.usesTargeting()) {
            onCallback("choose_targets_for", "true", currentAbility.toString());
            return true;
        }

        final TargetRestrictions tr = currentAbility.getTargetRestrictions();
        if (tr == null) {
            onCallback("choose_targets_for", "true", currentAbility.toString());
            return true;
        }

        while (!currentAbility.isTargetNumberValid()) {
            final List<GameEntity> candidates = tr.getAllCandidates(currentAbility, false);
            final List<Pair<GameEntity, GameObject>> valid = new ArrayList<>();
            for (final GameEntity candidate : candidates) {
                final GameObject normalized = normalizeStackTargetCandidate(candidate);
                if (currentAbility.canTarget(normalized)) {
                    valid.add(ImmutablePair.of(candidate, normalized));
                }
            }

            // Java's TargetRestrictions.getAllCandidates() does not enumerate stack
            // spell targets here even when the restriction zone is Stack; the engine
            // handles those separately via canTargetSpellAbility(). Mirror that path
            // in the deterministic harness so counterspell targeting is legal.
            valid.addAll(ActionSpace.getStackTargetCandidates(currentAbility));
            final Map<String, Pair<GameEntity, GameObject>> deduped = new LinkedHashMap<>();
            for (final Pair<GameEntity, GameObject> pair : valid) {
                deduped.putIfAbsent(targetCandidateKey(pair), pair);
            }
            valid.clear();
            valid.addAll(deduped.values());
            final List<String> validNames = new ArrayList<>(valid.size());
            for (final Pair<GameEntity, GameObject> pair : valid) {
                validNames.add(formatEntity(pair.getLeft()));
            }
            DecisionLog.logCallback(
                    player,
                    "choose_targets_for(candidates)",
                    validNames.toString(),
                    new ArrayList<>(),
                    ""
            );

            if (valid.isEmpty()) {
                final boolean result = currentAbility.isTargetNumberValid();
                onCallback("choose_targets_for", Boolean.toString(result), currentAbility.toString());
                return result;
            }

            // Sort valid targets canonically (players first by index, then cards by name+parityId)
            // to ensure deterministic cross-engine parity regardless of internal iteration order.
            valid.sort(Comparator.comparing(pair -> ParityOrder.targetSortKey(pair.getLeft())));

            final Pair<GameEntity, GameObject> chosen = ChoiceSpace.pickOne(valid, rng);
            if (chosen == null) {
                final boolean result = currentAbility.isTargetNumberValid();
                onCallback("choose_targets_for", Boolean.toString(result), currentAbility.toString());
                return result;
            }
            // getAllCandidates returns Cards from the Stack zone, but CounterEffect.resolve()
            // calls getTargetSpells() which filters for SpellAbility instances. Convert the
            // Card to its corresponding SpellAbility so the counter actually resolves.
            GameObject toAdd = chosen.getRight();
            currentAbility.getTargets().add(toAdd);

            if (!currentAbility.canAddMoreTarget()) {
                break;
            }

            // For abilities that permit extra targets above minimum, stop or continue
            // via RNG so we stay deterministic without AI heuristics.
            if (currentAbility.isMinTargetChosen() && !ChoiceSpace.pickBool(rng)) {
                break;
            }
        }

        final boolean result = currentAbility.isTargetNumberValid();
        final List<String> targetNames = new ArrayList<>();
        for (final Card c : currentAbility.getTargets().getTargetCards()) {
            targetNames.add(formatCard(c));
        }
        for (final Player p : currentAbility.getTargets().getTargetPlayers()) {
            targetNames.add("Player(" + p.getId() + ")");
        }
        onCallback("choose_targets_for", "[" + String.join(", ", targetNames) + "]", currentAbility.toString());
        return result;
    }

    private GameObject normalizeStackTargetCandidate(final GameObject candidate) {
        if (candidate instanceof Card c && c.isInZone(ZoneType.Stack)) {
            for (final SpellAbilityStackInstance si : c.getGame().getStack()) {
                if (si.getSourceCard() == c) {
                    return si.getSpellAbility();
                }
            }
        }
        return candidate;
    }

    // ── Combat ────────────────────────────────────────────────────────

    @Override
    public void declareAttackers(Player attacker, Combat combat) {
        captureDeepCheckpoint("combat_attacker_choice");
        // PhaseHandler may re-prompt attack declaration after invalid selections
        // or unpaid attack costs; always rebuild from an empty declaration.
        combat.clearAttackers();
        final List<Card> legalAttackers = new ArrayList<>();
        for (final Card c : attacker.getCreaturesInPlay()) {
            for (final GameEntity defender : combat.getDefenders()) {
                if (CombatUtil.canAttack(c, defender)) {
                    legalAttackers.add(c);
                    break;
                }
            }
        }
        final List<Card> candidates = ChoiceSpace.sortNative(legalAttackers, ParityOrder.cardComparator());
        final List<String> attackerLabels = ParityCardMap.disambiguateCards(candidates, Card::getName);
        for (int cIdx = 0; cIdx < candidates.size(); cIdx++) {
            final Card c = candidates.get(cIdx);
            final String attackerLabel = attackerLabels.get(cIdx);
            List<GameEntity> defenders = new ArrayList<>();
            for (final GameEntity defender : combat.getDefenders()) {
                if (CombatUtil.canAttack(c, defender)) {
                    defenders.add(defender);
                }
            }
            defenders = ParityOrder.sortDefenders(defenders);
            final List<String> options = new ArrayList<>();
            options.add("PASS");
            for (int i = 0; i < defenders.size(); i++) {
                options.add("ATTACK:" + attackerLabel + "->D" + i);
            }

            final int roll = ChoiceSpace.pickIndex(2, rng);
            String choice = "PASS";
            if (roll == 1) {
                final GameEntity defender = ChoiceSpace.pickOne(defenders, rng);
                if (defender != null) {
                    combat.addAttacker(c, defender);
                    final int idx = defenders.indexOf(defender);
                    if (idx >= 0) {
                        choice = "ATTACK:" + attackerLabel + "->D" + idx;
                    }
                }
            }
        }

        // Summary callback mirroring Rust's choose_attackers
        final CardCollectionView declared = combat.getAttackers();
        final String availableCount = String.valueOf(candidates.size());
        final String defenderCount = String.valueOf(combat.getDefenders().size());
        if (declared.isEmpty()) {
            onCallback("choose_attackers", "[]", availableCount, defenderCount);
        } else {
            final List<String> names = new ArrayList<>();
            for (final Card c : declared) {
                names.add(formatCard(c));
            }
            onCallback("choose_attackers", "[" + String.join(", ", names) + "]", availableCount, defenderCount);
        }

        // Intentionally do not "fix up" invalid declarations here.
        // PhaseHandler is the canonical owner of attacker-validation/re-prompt flow.
    }

    @Override
    public void declareBlockers(Player defender, Combat combat) {
        captureDeepCheckpoint("combat_blocker_choice");
        List<Card> attackers = new ArrayList<>(combat.getAttackers());
        if (attackers.isEmpty()) {
            onCallback("choose_blockers", "[]", "0", "0", "none");
            return;
        }

        final List<Card> blockers = ChoiceSpace.sortNative(CombatChoiceSpace.legalBlockers(defender, combat),
                ParityOrder.cardComparator());
        final List<String> blockerLabels = ParityCardMap.disambiguateCards(blockers, Card::getName);
        for (int bIdx = 0; bIdx < blockers.size(); bIdx++) {
            final Card blocker = blockers.get(bIdx);
            final String blockerLabel = blockerLabels.get(bIdx);
            final List<Card> legalForBlocker = new ArrayList<>();
            for (final Card attacker : attackers) {
                if (CombatUtil.canBlock(attacker, blocker, combat)) {
                    legalForBlocker.add(attacker);
                }
            }
            final List<Card> options = ChoiceSpace.sortNative(legalForBlocker, ParityOrder.cardComparator());
            final List<String> optionLabels = ParityCardMap.disambiguateCards(options, Card::getName);
            final List<String> loggedOptions = new ArrayList<>();
            loggedOptions.add("PASS");
            for (final String attackerLabel : optionLabels) {
                loggedOptions.add("BLOCK:" + blockerLabel + "->" + attackerLabel);
            }
            final int choice = ChoiceSpace.pickIndexWithPass(options.size(), rng);
            String loggedChoice = "PASS";
            if (choice > 0 && choice <= options.size()) {
                final Card chosen = options.get(choice - 1);
                combat.addBlocker(chosen, blocker);
                loggedChoice = "BLOCK:" + blockerLabel + "->" + optionLabels.get(choice - 1);
            }
        }

        // Summary callback mirroring Rust's choose_blockers
        final String attackerCount = String.valueOf(attackers.size());
        final String blockerCount = String.valueOf(blockers.size());
        final String maxStr = "none"; // Java doesn't pass max_blockers here
        final List<String> pairDescs = new ArrayList<>();
        for (final Card blocker : blockers) {
            final Card blocked = combat.getAttackersBlockedBy(blocker).isEmpty()
                    ? null : combat.getAttackersBlockedBy(blocker).get(0);
            if (blocked != null) {
                pairDescs.add(blocker.getName() + " → " + blocked.getName());
            }
        }
        if (pairDescs.isEmpty()) {
            onCallback("choose_blockers", "[]", attackerCount, blockerCount, maxStr);
        } else {
            onCallback("choose_blockers", "[" + String.join(", ", pairDescs) + "]", attackerCount, blockerCount, maxStr);
        }
    }

    @Override
    public CardCollection orderBlockers(Card attacker, CardCollection blockers) {
        blockers.sort(Comparator.comparing((Card c) -> c.getName()).thenComparingInt(ParityCardMap::parityId));
        onCallback("choose_damage_assignment_order", formatCards(blockers), formatCard(attacker));
        return blockers;
    }

    @Override
    public CardCollection orderBlocker(Card attacker, Card blocker, CardCollection oldBlockers) {
        CardCollection all = new CardCollection(oldBlockers);
        all.add(blocker);
        all.sort(Comparator.comparing((Card c) -> c.getName()).thenComparingInt(ParityCardMap::parityId));
        onCallback("choose_damage_assignment_order", formatCards(all), formatCard(attacker));
        return all;
    }

    @Override
    public CardCollection orderAttackers(Card blocker, CardCollection attackers) {
        attackers.sort(Comparator.comparing((Card c) -> c.getName()).thenComparingInt(ParityCardMap::parityId));
        onCallback("order_attackers", formatCards(attackers), formatCard(blocker));
        return attackers;
    }

    @Override
    public Map<Card, Integer> assignCombatDamage(Card attacker, CardCollectionView blockers,
            CardCollectionView remaining, int damageDealt, GameEntity defender, boolean overrideOrder) {
        Map<Card, Integer> result = new LinkedHashMap<>();
        int damageLeft = damageDealt;
        final boolean canTrampleToDefender = defender != null && attacker.hasKeyword("Trample");
        for (Card blocker : blockers) {
            int lethal = ComputerUtilCombat.getEnoughDamageToKill(blocker, damageLeft, attacker, false, false);
            int assign = Math.min(lethal, damageLeft);
            result.put(blocker, assign);
            damageLeft -= assign;
            if (damageLeft <= 0) break;
        }
        if (damageLeft > 0) {
            if (canTrampleToDefender) {
                // Java controller contract: null key means defending entity.
                result.put(null, damageLeft);
            } else if (!blockers.isEmpty()) {
                Card last = blockers.get(blockers.size() - 1);
                result.put(last, result.getOrDefault(last, 0) + damageLeft);
            }
        }
        final List<String> assignments = new ArrayList<>();
        for (final Map.Entry<Card, Integer> e : result.entrySet()) {
            assignments.add(formatCard(e.getKey()) + "=" + e.getValue());
        }
        onCallback("assign_combat_damage", "[" + String.join(", ", assignments) + "]",
                formatCard(attacker), String.valueOf(damageDealt));
        return result;
    }

    // ── Targeting & Choices ───────────────────────────────────────────

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList,
            DelayedReveal delayedReveal, SpellAbility sa, String title, boolean isOptional,
            Player relatedPlayer, Map<String, Object> params) {
        if (delayedReveal != null) reveal(delayedReveal);
        // Sort by (name, parityId) for deterministic cross-engine parity.
        // Avoids HashMap/collection ordering differences between Java and Rust.
        java.util.List<T> sorted = new java.util.ArrayList<>(optionList);
        sorted.sort(java.util.Comparator.comparing((T e) -> e.getName())
                .thenComparingInt(e -> (e instanceof Card) ? ParityCardMap.parityId((Card) e) : 0));
        final T picked = ChoiceSpace.pickOne(sorted, rng);
        final String validCount = String.valueOf(sorted.size());
        if (picked == null) {
            onCallback("choose_single_entity_for_effect", "null", title, validCount);
        } else {
            onCallback("choose_single_entity_for_effect", formatEntity(picked), title, validCount);
        }
        return picked;
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView sourceList, SpellAbility sa,
            String title, int min, int max, boolean isOptional, Map<String, Object> params) {
        // Sort cards canonically for deterministic cross-engine parity
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(sourceList));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, max, rng);
        final String validCount = String.valueOf(sourceList.size());
        final String minStr = String.valueOf(min);
        final String maxStr = String.valueOf(max);
        onCallback("choose_cards_for_effect", formatCards(result), validCount, minStr, maxStr);
        return result;
    }

    @Override
    public CardCollection chooseCardsForEffectMultiple(
            Map<String, CardCollection> validMap,
            SpellAbility sa,
            String title,
            boolean isOptional
    ) {
        final CardCollection chosen = new CardCollection();
        if (validMap == null || validMap.isEmpty()) {
            onCallback("choose_cards_for_effect_multiple", "[]", "0");
            return chosen;
        }
        for (final CardCollection pool : validMap.values()) {
            if (pool == null || pool.isEmpty()) {
                continue;
            }
            final CardCollection remaining = new CardCollection(pool);
            remaining.removeAll(chosen);
            final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(remaining));
            final Card pick = ChoiceSpace.pickOne(sorted, rng);
            if (pick != null) {
                chosen.add(pick);
            }
        }
        onCallback("choose_cards_for_effect_multiple", formatCards(chosen), String.valueOf(validMap.size()));
        return chosen;
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(
            FCollectionView<T> optionList, int min, int max, DelayedReveal delayedReveal, SpellAbility sa,
            String title, Player relatedPlayer, Map<String, Object> params) {
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        final List<T> pool = new ArrayList<>(optionList);
        // Sort pool canonically for deterministic cross-engine parity (matches Rust sort).
        pool.sort(Comparator.comparing(ParityOrder::targetSortKey));
        final int count = ChoiceSpace.pickCount(min, max, pool.size(), rng);
        final List<T> selected = new ArrayList<>(count);
        for (int i = 0; i < count && !pool.isEmpty(); i++) {
            selected.add(pool.remove(ChoiceSpace.pickIndex(pool.size(), rng)));
        }

        if (sa != null && sa.getApi() == ApiType.Dig) {
            final List<String> options = new ArrayList<>(pool.size() + selected.size() + 1);
            final List<Card> cards = new ArrayList<>();
            for (final T entity : optionList) {
                if (entity instanceof Card) {
                    cards.add((Card) entity);
                }
            }
            if (cards.size() == optionList.size()) {
                options.addAll(ParityCardMap.disambiguateCards(cards, Card::getName));
            } else {
                for (final T entity : optionList) {
                    options.add(entity == null ? "?" : entity.toString());
                }
            }

            final String choice;
            if (selected.isEmpty()) {
                choice = "[]";
            } else {
                final List<String> chosenLabels = new ArrayList<>();
                for (final T entity : selected) {
                    chosenLabels.add(entity instanceof GameEntity ? formatEntity((GameEntity) entity) : String.valueOf(entity));
                }
                choice = "[" + String.join(", ", chosenLabels) + "]";
            }
            onCallback("choose_dig", choice, String.valueOf(optionList.size()), String.valueOf(min), String.valueOf(max));
        }

        return selected;
    }

    // ── Sacrifice / Destroy ────────────────────────────────────────────
    // Rust's choose_sacrifice sorts alphabetically by name, picks first.

    @Override
    public CardCollectionView chooseCardsForCost(CardCollectionView optionList, SpellAbility sa,
            CostPartWithList cpl, int amount, boolean isOptional, String prompt) {
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(optionList));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), amount, amount, rng);
        onCallback("choose_cards_for_cost", formatCards(result), String.valueOf(optionList.size()), String.valueOf(amount));
        return result;
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(SpellAbility sa, int min, int max,
            CardCollectionView validTargets, String message) {
        captureDeepCheckpoint("choose_sacrifice");
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(validTargets));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, max, rng);
        final String validCount = String.valueOf(validTargets.size());
        final String minStr = String.valueOf(min);
        final String maxStr = String.valueOf(max);
        onCallback("choose_sacrifice", formatCards(result), validCount, minStr, maxStr);
        return result;
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(SpellAbility sa, int min, int max,
            CardCollectionView validTargets, String message) {
        captureDeepCheckpoint("choose_destroy");
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(validTargets));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, max, rng);
        onCallback("choose_destroy", formatCards(result),
                String.valueOf(validTargets.size()), String.valueOf(min), String.valueOf(max));
        return result;
    }

    // ── Zone Change (Search/Tutor) ──────────────────────────────────

    @Override
    public Card chooseSingleCardForZoneChange(ZoneType destination, List<ZoneType> origin,
            SpellAbility sa, CardCollection fetchList, DelayedReveal delayedReveal,
            String selectPrompt, boolean isOptional, Player decider) {
        captureDeepCheckpoint("choose_zone_change");
        if (delayedReveal != null) reveal(delayedReveal);
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId((List<Card>) fetchList);
        final Card result = ChoiceSpace.pickOne(sorted, rng);
        onCallback("choose_single_card_for_zone_change",
                result == null ? "null" : formatCard(result),
                String.valueOf(fetchList.size()),
                selectPrompt == null ? "?" : selectPrompt,
                String.valueOf(isOptional));
        return result;
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player playerDiscard, SpellAbility sa,
            CardCollection validCards, int min, int max, CardCollectionView visibleToChooser) {
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(validCards));
        final CardCollection result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, max, rng);
        onCallback("choose_discard", formatCards(result), String.valueOf(validCards.size()), String.valueOf(min), String.valueOf(max));
        return result;
    }

    @Override
    public CardCollection chooseCardsToDiscardToMaximumHandSize(int numDiscard) {
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(player.getCardsIn(ZoneType.Hand)));
        final CardCollection result = ChoiceSpace.pickManyCards(new CardCollection(sorted), numDiscard, numDiscard, rng);
        onCallback("choose_discard", formatCards(result), String.valueOf(sorted.size()), String.valueOf(numDiscard), String.valueOf(numDiscard));
        return result;
    }

    // ── Scry / Surveil / Library Manipulation ───────────────────────

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        CardCollection top = new CardCollection(topN);
        CardCollection bottom = new CardCollection();
        for (Card c : new ArrayList<>(topN)) {
            if (ChoiceSpace.pickBool(rng)) {
                top.remove(c);
                bottom.add(c);
            }
        }
        onCallback("choose_scry", formatCards(bottom), String.valueOf(topN.size()));
        return ImmutablePair.of(top, bottom);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        CardCollection top = new CardCollection(topN);
        CardCollection gy = new CardCollection();
        for (Card c : new ArrayList<>(topN)) {
            if (ChoiceSpace.pickBool(rng)) {
                top.remove(c);
                gy.add(c);
            }
        }
        onCallback("choose_surveil", formatCards(gy), String.valueOf(topN.size()));
        return ImmutablePair.of(top, gy);
    }

    @Override
    public CardCollectionView orderMoveToZoneList(CardCollectionView cards, ZoneType destinationZone,
            SpellAbility source) {
        onCallback("choose_reorder_library", formatCards(cards), String.valueOf(cards.size()));
        return new CardCollection(cards);
    }

    // ── Charm / Modal ────────────────────────────────────────────────

    @Override
    public List<AbilitySub> chooseModeForAbility(SpellAbility sa, List<AbilitySub> possible, int min, int num, boolean allowRepeat) {
        captureDeepCheckpoint("choose_mode");
        if (possible == null || possible.isEmpty()) {
            onCallback("choose_mode", "[]", "0", String.valueOf(min), String.valueOf(num));
            return new ArrayList<>();
        }
        int count = ChoiceSpace.pickCount(min, num, possible.size(), rng);
        List<AbilitySub> pool = new ArrayList<>(possible);
        List<AbilitySub> result = new ArrayList<>();
        for (int i = 0; i < count && !pool.isEmpty(); i++) {
            result.add(pool.remove(ChoiceSpace.pickIndex(pool.size(), rng)));
        }
        final List<String> labels = new ArrayList<>();
        for (final AbilitySub mode : result) {
            labels.add(mode == null ? "?" : mode.toString());
        }
        onCallback("choose_mode",
                labels.isEmpty() ? "[]" : String.join(", ", labels),
                String.valueOf(possible.size()), String.valueOf(min), String.valueOf(num));
        return result;
    }

    @Override
    public boolean confirmTrigger(WrappedAbility sa) {
        captureDeepCheckpoint("optional_trigger");
        final boolean result = chooseDeterministicBooleanDecision("optional_trigger", "DECLINE", "ACCEPT");
        final String desc = sa != null ? sa.getStackDescription() : "?";
        final String cardName = sa != null && sa.getHostCard() != null ? sa.getHostCard().getName() : "?";
        final String api = sa != null && sa.getApi() != null ? sa.getApi().toString() : "None";
        onCallback("choose_optional_trigger", Boolean.toString(result), desc, cardName, api);
        return result;
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message,
            List<String> options, Card cardToShow, Map<String, Object> params) {
        captureDeepCheckpoint("confirm_action");
        final boolean result = chooseDeterministicBooleanDecision("confirm_action", "DECLINE", "ACCEPT");
        final String cardName = cardToShow != null ? cardToShow.getName() : (sa != null && sa.getHostCard() != null ? sa.getHostCard().getName() : "?");
        final String modeStr = mode != null ? mode.toString() : "None";
        final String apiStr = sa != null && sa.getApi() != null ? sa.getApi().toString() : "None";
        onCallback("confirm_action", Boolean.toString(result),
                message != null ? message : "?", cardName, modeStr, apiStr);
        return result;
    }

    @Override
    public boolean confirmPayment(final forge.game.cost.CostPart costPart, final String prompt, final SpellAbility sa) {
        if (costPart == null || costPart instanceof CostPartMana) {
            return true;
        }
        if (HarnessCostPlumbing.isSpellPaymentContext(sa)) {
            return true;
        }
        captureDeepCheckpoint("confirm_payment");
        final boolean result = chooseDeterministicBooleanDecision("confirm_payment", "DECLINE", "ACCEPT");
        final String cardName = sa != null && sa.getHostCard() != null ? sa.getHostCard().getName() : "?";
        final String costKind = costPart.getClass().getSimpleName();
        final String apiStr = sa != null && sa.getApi() != null ? sa.getApi().toString() : "None";
        onCallback("confirm_payment", Boolean.toString(result),
                prompt != null ? prompt : "?", cardName, costKind, apiStr);
        return result;
    }

    @Override
    public boolean chooseBinary(final SpellAbility sa, final String question, final BinaryChoiceType kindOfChoice, final Boolean defaultVal) {
        captureDeepCheckpoint("choose_binary");
        final boolean result = chooseDeterministicBooleanDecision("choose_binary",
                kindOfChoice.name() + ":RIGHT", kindOfChoice.name() + ":LEFT");
        final String cardName = sa != null && sa.getHostCard() != null ? sa.getHostCard().getName() : "?";
        final String apiStr = sa != null && sa.getApi() != null ? sa.getApi().toString() : "None";
        onCallback("choose_binary", Boolean.toString(result),
                question != null ? question : "?", cardName, kindOfChoice.name(), apiStr);
        return result;
    }

    @Override
    public boolean chooseBinary(final SpellAbility sa, final String question, final BinaryChoiceType kindOfChoice, final Map<String, Object> params) {
        return chooseBinary(sa, question, kindOfChoice, (Boolean) null);
    }

    // ── Additional Costs (Kicker, Buyback, Multikicker, Replicate) ────
    // Rust defaults: choose_kicker→false, choose_buyback→false,
    // choose_multikicker→0, choose_replicate→0.
    // We must match by never paying optional costs.

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(SpellAbility chosen,
            List<OptionalCostValue> optionalCostValues) {
        onCallback("choose_optional_costs", "[]",
                String.valueOf(optionalCostValues == null ? 0 : optionalCostValues.size()));
        return Collections.emptyList();
    }

    @Override
    public int chooseNumberForKeywordCost(SpellAbility sa, Cost cost,
            KeywordInterface keyword, String prompt, int max) {
        final int result = ChoiceSpace.pickIntInRange(0, max, rng);
        onCallback("choose_number_for_keyword_cost", String.valueOf(result), String.valueOf(max));
        return result;
    }

    // ── X-Cost ────────────────────────────────────────────────────────
    // Rust default choose_x_value returns max_x (spend all available mana).
    // NOTE: This mirrors engine-side bounds logic from PlayerControllerHuman.
    // We do not use ComputerUtilCost here because announceRequirements is about
    // choosing a legal announced value (X / AnnounceMax / target-limited ranges),
    // not about paying or validating an entire cost payment plan.

    @Override
    public Integer announceRequirements(SpellAbility ability, int min, int max, String announce) {
        Integer result = EngineHandler.announceRequirements(player, ability, announce, rng);
        if (result != null) {
            result = Math.max(min, Math.min(max, result));
        }
        onCallback("announce_requirements", String.valueOf(result), announce != null ? announce : "?");
        return result;
    }

    // ── Numbers & Colors ──────────────────────────────────────────────

    @Override
    public byte chooseColor(String message, SpellAbility sa, ColorSet colors) {
        captureDeepCheckpoint("choose_color");
        List<Byte> colorList = ParityOrder.sortColors(colors);
        final byte result = colorList.isEmpty()
                ? Color.WHITE.getColorMask()
                : colorList.get(ChoiceSpace.pickIndex(colorList.size(), rng));
        onCallback("choose_color", Byte.toString(result), String.valueOf(colorList.size()));
        return result;
    }

    @Override
    public byte chooseColorAllowColorless(String message, Card card, ColorSet colors) {
        List<Byte> colorList = ParityOrder.sortColors(colors);
        if (colorList.isEmpty()) {
            onCallback("choose_color_allow_colorless", "colorless", "0");
            return Color.COLORLESS.getColorMask();
        }
        final byte result = colorList.get(ChoiceSpace.pickIndex(colorList.size(), rng));
        onCallback("choose_color_allow_colorless", Byte.toString(result), String.valueOf(colorList.size()));
        return result;
    }

    // ── Type / Card Name / Number Selection ────────────────────────────
    // Rust defaults: first valid type, first valid name, min value.

    @Override
    public String chooseSomeType(String kindOfType, SpellAbility sa, Collection<String> validTypes, boolean isOptional) {
        if (validTypes == null || validTypes.isEmpty()) {
            onCallback("choose_type", "", kindOfType == null ? "?" : kindOfType, "0");
            return "";
        }
        List<String> values = new ArrayList<>(validTypes);
        Collections.sort(values);
        final String chosen = values.get(ChoiceSpace.pickIndex(values.size(), rng));
        onCallback("choose_type", chosen, kindOfType == null ? "?" : kindOfType, String.valueOf(values.size()));
        return chosen;
    }

    @Override
    public String chooseCardName(SpellAbility sa, Predicate<ICardFace> cpp, String valid, String message) {
        captureDeepCheckpoint("choose_card_name");
        final Card source = sa.getHostCard();
        final Predicate<ICardFace> faceFilter = cpp == null ? x -> true : cpp;
        final List<ICardFace> faces = StaticData.instance().getCommonCards().streamAllFaces()
                .filter(faceFilter)
                .filter(face -> {
                    if (valid == null || valid.isEmpty()) {
                        return true;
                    }
                    final PaperCard cp = StaticData.instance().getCommonCards().getCard(face.getName());
                    if (cp == null) {
                        return false;
                    }
                    final Card instanceForPlayer = Card.fromPaperCard(cp, player);
                    final Player sourceController = source == null ? player : source.getController();
                    return instanceForPlayer.isValid(valid, sourceController, source, sa);
                })
                .sorted()
                .collect(Collectors.toList());
        return chooseCardName(sa, faces, message);
    }

    @Override
    public String chooseCardName(SpellAbility sa, List<ICardFace> faces, String message) {
        if (faces == null || faces.isEmpty()) {
            onCallback("choose_card_name", "", "0");
            return "";
        }
        final String chosen = faces.get(ChoiceSpace.pickIndex(faces.size(), rng)).getName();
        onCallback("choose_card_name", chosen, String.valueOf(faces.size()));
        return chosen;
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max) {
        captureDeepCheckpoint("choose_number");
        final int result = ChoiceSpace.pickIntInRange(min, max, rng);
        onCallback("choose_number", String.valueOf(result), String.valueOf(min), String.valueOf(max));
        return result;
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, List<Integer> values, Player relatedPlayer) {
        captureDeepCheckpoint("choose_number_from_list");
        if (values == null || values.isEmpty()) {
            onCallback("choose_number_from_list", "0", "0");
            return 0;
        }
        final int result = values.get(ChoiceSpace.pickIndex(values.size(), rng));
        onCallback("choose_number_from_list", String.valueOf(result), String.valueOf(values.size()));
        return result;
    }

    @Override
    public int chooseNumberForCostReduction(final SpellAbility sa, final int min, final int max) {
        final int result = ChoiceSpace.pickIntInRange(min, max, rng);
        onCallback("choose_number_for_cost_reduction", String.valueOf(result), String.valueOf(min), String.valueOf(max));
        return result;
    }

    // ── Coin Flip ─────────────────────────────────────────────────────
    // Rust default flip_coin_call returns true (always call heads).

    @Override
    public boolean chooseFlipResult(SpellAbility sa, Player flipper, boolean call) {
        final boolean chosen = ChoiceSpace.pickBool(rng);
        onCallback("flip_coin_call", String.valueOf(chosen));
        return chosen;
    }

    // ── Mulligan Bottom Selection ────────────────────────────────────
    // Rust default choose_cards_to_bottom returns first N cards.

    @Override
    public CardCollectionView tuckCardsViaMulligan(CardCollectionView hand, int cardsToReturn) {
        CardCollection pool = new CardCollection(hand);
        CardCollection out = new CardCollection();
        int count = Math.min(cardsToReturn, pool.size());
        for (int i = 0; i < count && !pool.isEmpty(); i++) {
            out.add(pool.remove(ChoiceSpace.pickIndex(pool.size(), rng)));
        }
        if (out.isEmpty()) {
            onCallback("choose_cards_to_bottom", "NONE", String.valueOf(hand.size()), String.valueOf(cardsToReturn));
        } else {
            final List<String> names = new ArrayList<>();
            for (final Card c : out) names.add(c.getName());
            onCallback("choose_cards_to_bottom", String.join(", ", names), String.valueOf(hand.size()), String.valueOf(cardsToReturn));
        }
        return out;
    }

    // ── Misc ──────────────────────────────────────────────────────────

    @Override
    public Player chooseStartingPlayer(boolean isFirstGame) {
        final Player result = getGame().getPlayers().get(0);
        onCallback("choose_starting_player", String.valueOf(result.getId()));
        return result;
    }

    // ── Reveal (headless no-ops) ──────────────────────────────────────

    @Override
    public void reveal(CardCollectionView cards, ZoneType zone, Player owner,
            String messagePrefix, boolean addMsgSuffix) {
        // headless — no-op
    }

    @Override
    public void reveal(List<CardView> cards, ZoneType zone, PlayerView owner,
            String messagePrefix, boolean addMsgSuffix) {
        // headless — no-op
    }

    @Override
    public void notifyOfValue(SpellAbility saSource, GameObject relatedTarget, String value) {
        // headless — no-op
    }

    // ── Unless Costs (shock lands etc.) ───────────────────────────────

    @Override
    public boolean payCostToPreventEffect(Cost cost, SpellAbility sa, boolean alreadyPaid,
            FCollectionView<Player> allPayers) {
        if (!ComputerUtilCost.canPayCost(cost, sa, player, true)
                && !canPayManaOnlyPreventCostDeterministically(cost, sa)) {
            onCallback("pay_cost_to_prevent_effect", "false", "cannot_pay");
            return false;
        }
        final boolean result = costPlumbing.payWithControllerDecision(cost, sa, true);
        onCallback("pay_cost_to_prevent_effect", Boolean.toString(result));
        return result;
    }

    private boolean canPayManaOnlyPreventCostDeterministically(final Cost cost, final SpellAbility sa) {
        return cost != null
                && cost.isOnlyManaCost()
                && cost.hasManaCost()
                && ActionSpace.canPayManaCostFromCurrentSources(
                cost.getTotalMana(),
                sa,
                player,
                costPlumbing.currentReservedSacrifices());
    }

    @Override
    public boolean payCombatCost(Card c, Cost cost, SpellAbility sa, String prompt) {
        final boolean result = playPlumbing.playNoStack(c.getController(), sa, getGame(), true);
        onCallback("pay_combat_cost", Boolean.toString(result), formatCard(c));
        return result;
    }

    @Override
    public List<SpellAbility> orderSimultaneousSa(List<SpellAbility> activePlayerSAs) {
        return playPlumbing.orderSimultaneousSa(activePlayerSAs);
    }

    @Override
    public void orderAndPlaySimultaneousSa(List<SpellAbility> activePlayerSAs) {
        playPlumbing.orderAndPlaySimultaneousSa(activePlayerSAs, getGame());
    }

    @Override
    public boolean playTrigger(Card host, WrappedAbility wrapperAbility, boolean isMandatory) {
        if (playPlumbing.prepareSingleSa(host, wrapperAbility, isMandatory)) {
            return playPlumbing.playNoStack(
                    wrapperAbility.getActivatingPlayer(), wrapperAbility, getGame(), true);
        }
        return false;
    }

    @Override
    public boolean playSaFromPlayEffect(SpellAbility tgtSA) {
        return playPlumbing.playSaFromPlayEffect(tgtSA, getGame());
    }

    @Override
    public SpellAbility getAbilityToPlay(Card hostCard, List<SpellAbility> abilities, ITriggerEvent triggerEvent) {
        final SpellAbility result = ChoiceSpace.pickOne(abilities, rng);
        onCallback("get_ability_to_play",
                result == null ? "null" : result.toString(),
                formatCard(hostCard), String.valueOf(abilities.size()));
        return result;
    }

    @Override
    public List<PaperCard> sideboard(Deck deck, GameType gameType, String message) {
        return null;
    }

    @Override
    public TargetChoices chooseNewTargetsFor(SpellAbility ability, Predicate<GameObject> filter, boolean optional) {
        onCallback("choose_new_targets_for", "null");
        return null;
    }

    @Override
    public Pair<SpellAbilityStackInstance, GameObject> chooseTarget(
            SpellAbility sa,
            List<Pair<SpellAbilityStackInstance, GameObject>> allTargets
    ) {
        final Pair<SpellAbilityStackInstance, GameObject> result = ChoiceSpace.pickOne(allTargets, rng);
        onCallback("choose_target_spell", result == null ? "null" : result.toString(), String.valueOf(allTargets.size()));
        return result;
    }

    @Override
    public boolean helpPayForAssistSpell(ManaCostBeingPaid cost, SpellAbility sa, int max, int requested) {
        final boolean result = ChoiceSpace.pickBool(rng);
        onCallback("help_pay_assist", Boolean.toString(result), String.valueOf(max), String.valueOf(requested));
        return result;
    }

    @Override
    public Player choosePlayerToAssistPayment(FCollectionView<Player> optionList, SpellAbility sa, String title, int max) {
        final Player result = ChoiceSpace.pickOne(optionList, rng);
        onCallback("choose_player_to_assist", result == null ? "null" : String.valueOf(result.getId()), String.valueOf(optionList.size()));
        return result;
    }

    @Override
    public List<PaperCard> chooseCardsYouWonToAddToDeck(List<PaperCard> losses) {
        onCallback("choose_cards_you_won", losses == null ? "null" : String.valueOf(losses.size()));
        return losses == null ? null : new ArrayList<>(losses);
    }

    @Override
    public Map<GameEntity, Integer> divideShield(Card effectSource, Map<GameEntity, Integer> affected, int shieldAmount) {
        final Map<GameEntity, Integer> out = new LinkedHashMap<>();
        if (affected == null || shieldAmount <= 0) {
            onCallback("divide_shield", "{}", "0");
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
            final GameEntity chosen = pool.get(ChoiceSpace.pickIndex(pool.size(), rng));
            final int current = out.getOrDefault(chosen, 0);
            final int cap = affected.getOrDefault(chosen, 0);
            if (current >= cap) {
                pool.remove(chosen);
                continue;
            }
            out.put(chosen, current + 1);
            remaining--;
        }
        onCallback("divide_shield", out.toString(), String.valueOf(shieldAmount));
        return out;
    }

    @Override
    public Map<Byte, Integer> specifyManaCombo(SpellAbility sa, ColorSet colorSet, int manaAmount, boolean different) {
        final Map<Byte, Integer> result = new LinkedHashMap<>();
        ColorSet mutable = colorSet;
        for (int i = 0; i < manaAmount; i++) {
            final byte chosen = chooseColor("", sa, mutable);
            result.put(chosen, result.getOrDefault(chosen, 0) + 1);
            if (different) {
                mutable = ColorSet.fromMask(mutable.getColor() & ~chosen);
            }
        }
        onCallback("specify_mana_combo", result.toString(), String.valueOf(manaAmount));
        return result;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(
            List<SpellAbility> spells,
            SpellAbility sa,
            String title,
            int num,
            Map<String, Object> params
    ) {
        if (spells == null || spells.isEmpty() || num <= 0) {
            onCallback("choose_spell_abilities_for_effect", "[]", "0", String.valueOf(num));
            return new ArrayList<>();
        }
        final List<SpellAbility> pool = new ArrayList<>(spells);
        final int count = Math.min(num, pool.size());
        final List<SpellAbility> out = new ArrayList<>(count);
        for (int i = 0; i < count && !pool.isEmpty(); i++) {
            out.add(pool.remove(ChoiceSpace.pickIndex(pool.size(), rng)));
        }
        onCallback("choose_spell_abilities_for_effect", String.valueOf(out.size()),
                String.valueOf(spells.size()), String.valueOf(num));
        return out;
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(List<SpellAbility> spells, SpellAbility sa, String title, Map<String, Object> params) {
        final SpellAbility result = ChoiceSpace.pickOne(spells, rng);
        onCallback("choose_single_spell_for_effect",
                result == null ? "null" : result.toString(),
                String.valueOf(spells == null ? 0 : spells.size()));
        return result;
    }

    @Override
    public boolean confirmBidAction(SpellAbility sa, PlayerActionConfirmMode bidlife, String string, int bid, Player winner) {
        final boolean result = ChoiceSpace.pickBool(rng);
        onCallback("confirm_bid_action", Boolean.toString(result), String.valueOf(bid));
        return result;
    }

    @Override
    public boolean confirmReplacementEffect(ReplacementEffect replacementEffect, SpellAbility effectSA, GameEntity affected, String question) {
        final boolean accept = ChoiceSpace.pickBool(rng);
        final String desc = replacementEffect != null ? replacementEffect.getDescription() : "?";
        final String cardName = replacementEffect != null && replacementEffect.getHostCard() != null
                ? replacementEffect.getHostCard().getName() : "?";
        onCallback("confirm_replacement_effect", Boolean.toString(accept), question != null ? question : "?", desc, cardName);
        return accept;
    }

    @Override
    public boolean confirmStaticApplication(Card hostCard, PlayerActionConfirmMode mode, String message, String logic) {
        final boolean result = ChoiceSpace.pickBool(rng);
        onCallback("confirm_static_application", Boolean.toString(result),
                hostCard != null ? hostCard.getName() : "?", message != null ? message : "?");
        return result;
    }

    @Override
    public List<Card> exertAttackers(List<Card> attackers) {
        if (attackers == null) {
            onCallback("exert_attackers", "[]", "0");
            return new ArrayList<>();
        }
        final List<Card> out = new ArrayList<>();
        for (final Card attacker : attackers) {
            if (ChoiceSpace.pickBool(rng)) {
                out.add(attacker);
            }
        }
        onCallback("exert_attackers", formatCards(out), String.valueOf(attackers.size()));
        return out;
    }

    @Override
    public List<Card> enlistAttackers(List<Card> attackers) {
        if (attackers == null || attackers.isEmpty()) {
            onCallback("enlist_attackers", "[]", "0");
            return new ArrayList<>();
        }
        // Use engine legality only: if Enlist cannot currently be paid at all,
        // do not choose any attacker to pay that optional cost.
        if (CostEnlist.getCardsForEnlisting(player).isEmpty()) {
            onCallback("enlist_attackers", "[]", String.valueOf(attackers.size()));
            return new ArrayList<>();
        }
        final List<Card> result = Lists.newArrayList(attackers.get(ChoiceSpace.pickIndex(attackers.size(), rng)));
        onCallback("enlist_attackers", formatCards(result), String.valueOf(attackers.size()));
        return result;
    }

    @Override
    public boolean willPutCardOnTop(Card c) {
        final boolean result = ChoiceSpace.pickBool(rng);
        onCallback("will_put_card_on_top", Boolean.toString(result), formatCard(c));
        return result;
    }

    @Override
    public CardCollectionView chooseCardsToDiscardUnlessType(int min, CardCollectionView hand, String[] unlessTypes, SpellAbility sa) {
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(hand));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, min, rng);
        onCallback("choose_discard_unless_type", formatCards(result), String.valueOf(hand.size()), String.valueOf(min));
        return result;
    }

    @Override
    public CardCollectionView chooseCardsToDelve(int genericAmount, CardCollection grave) {
        captureDeepCheckpoint("choose_delve");
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(grave));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), 0, Math.min(genericAmount, grave.size()), rng);
        onCallback("choose_delve", formatCards(result), String.valueOf(grave.size()), String.valueOf(genericAmount));
        return result;
    }

    @Override
    public Map<Card, ManaCostShard> chooseCardsForConvokeOrImprovise(
            SpellAbility sa,
            ManaCost manaCost,
            CardCollectionView untappedCards,
            boolean artifacts,
            boolean creatures,
            Integer maxReduction
    ) {
        final Map<Card, ManaCostShard> result = new LinkedHashMap<>();
        if (!probingPayability || untappedCards == null || untappedCards.isEmpty()) {
            return result;
        }
        final int cap = maxReduction == null ? untappedCards.size() : Math.max(0, Math.min(maxReduction, untappedCards.size()));
        final ManaCostBeingPaid remaining = new ManaCostBeingPaid(manaCost);
        for (final Card card : ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(untappedCards))) {
            if (result.size() >= cap) {
                break;
            }
            final ManaCostShard shard = remaining.payManaViaConvoke(convokeColor(card, remaining, artifacts));
            if (shard != null) {
                result.put(card, shard);
            }
        }
        return result;
    }

    private byte convokeColor(final Card card, final ManaCostBeingPaid remainingCost, final boolean artifacts) {
        if (artifacts) {
            return ManaCostShard.COLORLESS.getColorMask();
        }
        ColorSet colors = card.getColor();
        if (colors.isMulticolor()) {
            colors = ColorSet.fromMask(colors.getColor() & remainingCost.getUnpaidColors());
        }
        if (colors.isMulticolor()) {
            return (byte) Integer.lowestOneBit(colors.getColor());
        }
        return colors.getColor();
    }

    @Override
    public List<Card> chooseCardsForSplice(SpellAbility sa, List<Card> cards) {
        if (cards == null || cards.isEmpty()) {
            onCallback("choose_cards_for_splice", "[]", "0");
            return new ArrayList<>();
        }
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(cards);
        final List<Card> out = new ArrayList<>();
        for (final Card card : sorted) {
            if (ChoiceSpace.pickBool(rng)) {
                out.add(card);
            }
        }
        onCallback("choose_cards_for_splice", formatCards(out), String.valueOf(cards.size()));
        return out;
    }

    @Override
    public CardCollectionView chooseCardsToRevealFromHand(int min, int max, CardCollectionView valid) {
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(valid));
        final CardCollectionView result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, max, rng);
        onCallback("choose_cards_to_reveal", formatCards(result), String.valueOf(valid.size()), String.valueOf(min), String.valueOf(max));
        return result;
    }

    @Override
    public List<SpellAbility> chooseSaToActivateFromOpeningHand(List<SpellAbility> usableFromOpeningHand) {
        if (usableFromOpeningHand == null || usableFromOpeningHand.isEmpty()) {
            onCallback("choose_sa_from_opening_hand", "[]", "0");
            return new ArrayList<>();
        }
        final List<SpellAbility> out = new ArrayList<>();
        for (final SpellAbility sa : usableFromOpeningHand) {
            if (ChoiceSpace.pickBool(rng)) {
                out.add(sa);
            }
        }
        onCallback("choose_sa_from_opening_hand", String.valueOf(out.size()), String.valueOf(usableFromOpeningHand.size()));
        return out;
    }

    @Override
    public PlayerZone chooseStartingHand(List<PlayerZone> zones) {
        final PlayerZone result = ChoiceSpace.pickOne(zones, rng);
        onCallback("choose_starting_hand", result == null ? "null" : result.toString(), String.valueOf(zones.size()));
        return result;
    }

    @Override
    public Mana chooseManaFromPool(List<Mana> manaChoices) {
        final Mana result = ChoiceSpace.pickOne(manaChoices, rng);
        onCallback("choose_mana_from_pool", result == null ? "null" : result.toString(), String.valueOf(manaChoices.size()));
        return result;
    }

    @Override
    public String chooseSector(Card assignee, String ai, List<String> sectors) {
        final String result = ChoiceSpace.pickOne(sectors, rng);
        onCallback("choose_sector", result == null ? "null" : result, String.valueOf(sectors.size()));
        return result;
    }

    @Override
    public List<Card> chooseContraptionsToCrank(List<Card> contraptions) {
        if (contraptions == null || contraptions.isEmpty()) {
            onCallback("choose_contraptions_to_crank", "[]", "0");
            return new ArrayList<>();
        }
        final List<Card> out = new ArrayList<>();
        for (final Card contraption : contraptions) {
            if (ChoiceSpace.pickBool(rng)) {
                out.add(contraption);
            }
        }
        onCallback("choose_contraptions_to_crank", formatCards(out), String.valueOf(contraptions.size()));
        return out;
    }

    @Override
    public int chooseSprocket(Card assignee, List<Integer> sprockets) {
        final Integer picked = ChoiceSpace.pickOne(sprockets, rng);
        final int result = picked == null ? 1 : picked;
        onCallback("choose_sprocket", String.valueOf(result));
        return result;
    }

    @Override
    public PlanarDice choosePDRollToIgnore(List<PlanarDice> rolls) {
        final PlanarDice result = ChoiceSpace.pickOne(rolls, rng);
        onCallback("choose_pd_roll_to_ignore", result == null ? "null" : result.toString(), String.valueOf(rolls.size()));
        return result;
    }

    @Override
    public Integer chooseRollToIgnore(List<Integer> rolls) {
        final Integer result = ChoiceSpace.pickOne(rolls, rng);
        onCallback("choose_roll_to_ignore", String.valueOf(result), String.valueOf(rolls.size()));
        return result;
    }

    @Override
    public List<Integer> chooseDiceToReroll(List<Integer> rolls) {
        if (rolls == null || rolls.isEmpty()) {
            onCallback("choose_dice_to_reroll", "[]", "0");
            return new ArrayList<>();
        }
        final List<Integer> out = new ArrayList<>();
        for (final Integer roll : rolls) {
            if (ChoiceSpace.pickBool(rng)) {
                out.add(roll);
            }
        }
        onCallback("choose_dice_to_reroll", out.toString(), String.valueOf(rolls.size()));
        return out;
    }

    @Override
    public Integer chooseRollToModify(List<Integer> rolls) {
        final Integer result = ChoiceSpace.pickOne(rolls, rng);
        onCallback("choose_roll_to_modify", String.valueOf(result), String.valueOf(rolls.size()));
        return result;
    }

    @Override
    public RollDiceEffect.DieRollResult chooseRollToSwap(List<RollDiceEffect.DieRollResult> rolls) {
        final RollDiceEffect.DieRollResult result = ChoiceSpace.pickOne(rolls, rng);
        onCallback("choose_roll_to_swap", result == null ? "null" : result.toString(), String.valueOf(rolls.size()));
        return result;
    }

    @Override
    public String chooseRollSwapValue(List<String> swapChoices, Integer currentResult, int power, int toughness) {
        final String result = ChoiceSpace.pickOne(swapChoices, rng);
        onCallback("choose_roll_swap_value", result == null ? "null" : result,
                String.valueOf(currentResult), String.valueOf(power), String.valueOf(toughness));
        return result;
    }

    @Override
    public Object vote(
            SpellAbility sa,
            String prompt,
            List<Object> options,
            ListMultimap<Object, Player> votes,
            Player forPlayer,
            boolean optional
    ) {
        if (optional && ChoiceSpace.pickBool(rng)) {
            onCallback("vote", "null", String.valueOf(options.size()));
            return null;
        }
        final Object result = ChoiceSpace.pickOne(options, rng);
        onCallback("vote", result == null ? "null" : result.toString(), String.valueOf(options.size()));
        return result;
    }

    @Override
    public ColorSet chooseColors(String message, SpellAbility sa, int min, int max, ColorSet options) {
        if (options == null || options.isColorless()) {
            onCallback("choose_colors", "0", String.valueOf(min), String.valueOf(max));
            return ColorSet.fromMask(0);
        }
        final List<Byte> colors = ParityOrder.sortColors(options);
        final int count = ChoiceSpace.pickCount(min, max, colors.size(), rng);
        int mask = 0;
        for (int i = 0; i < count && !colors.isEmpty(); i++) {
            final byte chosen = colors.remove(ChoiceSpace.pickIndex(colors.size(), rng));
            mask |= chosen;
        }
        final ColorSet result = ColorSet.fromMask(mask);
        onCallback("choose_colors", String.valueOf(mask), String.valueOf(min), String.valueOf(max));
        return result;
    }

    @Override
    public ICardFace chooseSingleCardFace(SpellAbility sa, String message, Predicate<ICardFace> cpp, String name) {
        final Predicate<ICardFace> filter = cpp == null ? x -> true : cpp;
        final List<ICardFace> faces = StaticData.instance().getCommonCards().streamAllFaces()
                .filter(filter)
                .collect(Collectors.toList());
        return chooseSingleCardFace(sa, faces, message);
    }

    @Override
    public ICardFace chooseSingleCardFace(SpellAbility sa, List<ICardFace> faces, String message) {
        final ICardFace result = ChoiceSpace.pickOne(faces, rng);
        onCallback("choose_single_card_face", result == null ? "null" : result.getName(), String.valueOf(faces.size()));
        return result;
    }

    @Override
    public CardState chooseSingleCardState(SpellAbility sa, List<CardState> states, String message, Map<String, Object> params) {
        final CardState result = ChoiceSpace.pickOne(states, rng);
        onCallback("choose_single_card_state", result == null ? "null" : result.toString(), String.valueOf(states.size()));
        return result;
    }

    @Override
    public boolean chooseCardsPile(SpellAbility sa, CardCollectionView pile1, CardCollectionView pile2, String faceUp) {
        final boolean result = ChoiceSpace.pickBool(rng);
        onCallback("choose_cards_pile", Boolean.toString(result),
                String.valueOf(pile1.size()), String.valueOf(pile2.size()));
        return result;
    }

    @Override
    public CounterType chooseCounterType(List<CounterType> options, SpellAbility sa, String prompt, Map<String, Object> params) {
        final CounterType result = ChoiceSpace.pickOne(options, rng);
        onCallback("choose_counter_type", result == null ? "null" : result.toString(), String.valueOf(options.size()));
        return result;
    }

    @Override
    public String chooseKeywordForPump(List<String> options, SpellAbility sa, String prompt, Card tgtCard) {
        final String result = ChoiceSpace.pickOne(options, rng);
        onCallback("choose_keyword_for_pump", result == null ? "null" : result, String.valueOf(options.size()));
        return result;
    }

    @Override
    public ReplacementEffect chooseSingleReplacementEffect(List<ReplacementEffect> possibleReplacers) {
        captureDeepCheckpoint("choose_single_replacement_effect");
        final ReplacementEffect result = ChoiceSpace.pickOne(ParityOrder.sortReplacementEffects(possibleReplacers), rng);
        onCallback("choose_single_replacement_effect",
                result == null ? "null" : result.getDescription(),
                String.valueOf(possibleReplacers == null ? 0 : possibleReplacers.size()));
        return result;
    }

    @Override
    public StaticAbility chooseSingleStaticAbility(List<StaticAbility> possibleReplacers) {
        // Do NOT consume RNG here. This method is called during action-space evaluation
        // (canPlay() checks), not just at resolution time. Consuming RNG here causes
        // desync with Rust, which selects static abilities algorithmically without
        // calling any agent callback.
        if (possibleReplacers == null || possibleReplacers.isEmpty()) {
            return null;
        }
        final StaticAbility result = possibleReplacers.get(0);
        return result;
    }

    @Override
    public String chooseProtectionType(SpellAbility sa, List<String> choices) {
        final String result = ChoiceSpace.pickOne(choices, rng);
        onCallback("choose_protection_type", result == null ? "null" : result, String.valueOf(choices.size()));
        return result;
    }

    @Override
    public void revealAnte(String message, Multimap<Player, PaperCard> removedAnteCards) {
        // headless — no-op
    }

    @Override
    public void revealAISkipCards(String message, Map<Player, Map<DeckSection, List<? extends PaperCard>>> deckCards) {
        // headless — no-op
    }

    @Override
    public void revealUnsupported(Map<Player, List<PaperCard>> unsupported) {
        // headless — no-op
    }

    @Override
    public void resetAtEndOfTurn() {
        // headless — no-op
    }

    @Override
    public List<CostPart> orderCosts(List<CostPart> costs) {
        if (costs == null || costs.size() < 2) {
            onCallback("order_costs", String.valueOf(costs == null ? 0 : costs.size()));
            return costs;
        }
        final List<CostPart> out = new ArrayList<>(costs);
        Collections.shuffle(out, rng);
        onCallback("order_costs", String.valueOf(out.size()));
        return out;
    }

    @Override
    public boolean payCostDuringRoll(Cost cost, SpellAbility sa) {
        if (!ComputerUtilCost.canPayCost(cost, sa, player, true)) {
            onCallback("pay_cost_during_roll", "false", "cannot_pay");
            return false;
        }
        final boolean result = costPlumbing.payWithControllerDecision(cost, sa, true);
        onCallback("pay_cost_during_roll", Boolean.toString(result));
        return result;
    }

    @Override
    public boolean applyManaToCost(
            ManaCostBeingPaid toPay,
            SpellAbility ability,
            String prompt,
            ManaConversionMatrix matrix,
            boolean effect
    ) {
        return autoPay.payManaCost(toPay.toManaCost(), ability, effect);
    }

    @Override
    public boolean payManaCost(
            ManaCost toPay,
            CostPartMana costPartMana,
            SpellAbility sa,
            String prompt,
            ManaConversionMatrix matrix,
            boolean effect
    ) {
        ManaCost payableCost = toPay;
        if (sa != null && sa.getXManaCostPaid() != null && toPay != null && toPay.countX() > 0) {
            final ManaCostBeingPaid expanded = new ManaCostBeingPaid(toPay);
            expanded.setXManaCostPaid(sa.getXManaCostPaid(), sa.getXColor());
            payableCost = expanded.toManaCost();
        }
        if (sa != null && sa.getManaCostBeingPaid() != null) {
            payableCost = new ManaCostBeingPaid(sa.getManaCostBeingPaid()).toManaCost();
        } else if (sa != null
                && sa.isSpell()
                && sa.getHostCard() != null
                && payableCost != null
                && !payableCost.isNoCost()) {
            // Mirror the GUI flow: InputPayMana calls setManaCostBeingPaid with the
            // reduced cost before handing payment to the controller. The deterministic
            // harness skips that setup, so we must run CostAdjustment.adjust here for
            // every spell — not just Affinity — otherwise self-reducing statics
            // (Sunderflock's GreatestCardManaCost, Animar counters, ...) are ignored
            // at payment time and the AI cancels casts that canPayManaCost said it
            // could afford.
            final ManaCostBeingPaid adjusted = new ManaCostBeingPaid(payableCost);
            final Player payer = sa.getActivatingPlayer() != null ? sa.getActivatingPlayer() : player;
            if (CostAdjustment.adjust(adjusted, sa, payer, null, true, effect)) {
                payableCost = adjusted.toManaCost();
            }
        }
        if (sa != null
                && !sa.isManaAbility()
                && payableCost != null
                && !payableCost.isNoCost()
                && !payableCost.isZero()) {
            final Card source = sa.getHostCard();
            final String sourceLabel = source == null
                    ? "UNKNOWN"
                    : source.getName() + "@" + ParityCardMap.parityId(source);
            final AutoPay.PayManaCostResult result = autoPay.payManaCostWithTrace(payableCost, sa, effect);
            onCallback(
                    "pay_mana_cost",
                    "[" + String.join(", ", result.steps()) + "]",
                    sourceLabel,
                    payableCost.toString());
            return result.paid();
        }
        return autoPay.payManaCost(payableCost, sa, effect);
    }

    @Override
    public List<Card> chooseCardsForZoneChange(
            ZoneType destination,
            List<ZoneType> origin,
            SpellAbility sa,
            CardCollection fetchList,
            int min,
            int max,
            DelayedReveal delayedReveal,
            String selectPrompt,
            Player decider
    ) {
        captureDeepCheckpoint("choose_zone_change");
        if (delayedReveal != null) {
            reveal(delayedReveal);
        }
        final List<Card> sorted = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(fetchList));
        final CardCollection result = ChoiceSpace.pickManyCards(new CardCollection(sorted), min, max, rng);
        onCallback("choose_cards_for_zone_change",
                result.isEmpty() ? "[]" : formatCards(result),
                String.valueOf(fetchList.size()), String.valueOf(min),
                String.valueOf(max), selectPrompt == null ? "?" : selectPrompt);
        return new ArrayList<>(result);
    }

    @Override
    public void autoPassCancel() {
        // headless — no-op
    }

    @Override
    public void awaitNextInput() {
        // headless — no-op
    }

    @Override
    public void cancelAwaitNextInput() {
        // headless — no-op
    }

}
