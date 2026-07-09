package forge.harness.host;

import forge.harness.common.ActionSpace;
import forge.harness.common.CombatChoiceSpace;
import forge.harness.common.ParityCardMap;
import forge.harness.common.ParityOrder;
import forge.harness.common.SnapshotExtractor;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.harness.protocol.*;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.card.CardView;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.cost.Cost;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.staticability.StaticAbilityCantAttackBlock;
import forge.game.staticability.StaticAbilityMustAttack;
import forge.game.zone.ZoneType;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

public final class ManaBrewInteractiveSession {
    private final String sessionId;
    private Match match;
    private Game game;
    private final BlockingQueue<JsonObject> actions = new LinkedBlockingQueue<>();
    private volatile String latestPromptJson;
    private volatile int promptedPlayerIndex = -1;
    private long promptSeq;
    private volatile boolean closed;
    private volatile Thread gameThread;
    private volatile SpellAbility castingAbility;

    ManaBrewInteractiveSession(final String sessionId) {
        this.sessionId = Objects.requireNonNull(sessionId, "sessionId");
    }

    void attach(final Match match, final Game game) {
        this.match = Objects.requireNonNull(match, "match");
        this.game = Objects.requireNonNull(game, "game");
    }

    public String getSessionId() {
        return sessionId;
    }

    public Game getGame() {
        requireAttached();
        return game;
    }

    public void start(final Random rng) {
        requireAttached();
        Objects.requireNonNull(rng, "rng");
        gameThread = new Thread(() -> {
            forge.util.MyRandom.setRandom(rng);
            try {
                match.startGame(game);
            } catch (RuntimeException error) {
                System.err.println("[mana-brew] interactive game error: " + error.getMessage());
                error.printStackTrace(System.err);
            }
        }, "mana-brew-forge-" + sessionId);
        gameThread.setDaemon(true);
        gameThread.start();
    }

    public void close() {
        closed = true;
        JsonObject action = new JsonObject();
        action.addProperty("kind", "pass");
        actions.offer(action);
        if (game != null && !game.isGameOver()) {
            game.setGameOver(forge.game.GameEndReason.Draw);
        }
        final Thread thread = gameThread;
        if (thread != null) {
            try {
                thread.join(5000);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public String getLatestPromptJson() {
        return latestPromptJson;
    }

    public String getSnapshotJson() {
        requireAttached();
        return snapshotJson();
    }

    void beginCast(final SpellAbility sa) {
        this.castingAbility = sa;
    }

    void endCast() {
        this.castingAbility = null;
    }

    private String snapshotJson() {
        final int viewer = SnapshotExtractor.playerIndex(game, game.getPhaseHandler().getPriorityPlayer());
        return InteractiveSnapshotExtractor.snapshotJson(game, castingAbility, sessionId, viewer);
    }

    public boolean isGameOver() {
        return game != null && game.isGameOver();
    }

    boolean isClosed() {
        return closed;
    }

    public String submitAction(final String actionJson) {
        if (closed) {
            throw new IllegalStateException("session is closed");
        }
        final JsonObject canonical = JsonParser.parseString(actionJson).getAsJsonObject();
        final JsonObject decoded = ManabrewProtocolAdapter.decodeAction(canonical);
        trace("[harness-action] recv=" + actionJson + " decoded=" + decoded);
        actions.offer(decoded);
        // No snapshot here — it would race the game thread this unblocks.
        return "";
    }

    private static final String TRACE_PATH =
            System.getenv().getOrDefault("MANABREW_HARNESS_TRACE", "/tmp/harness-trace.log");

    private static synchronized void trace(final String line) {
        try (java.io.FileWriter writer = new java.io.FileWriter(TRACE_PATH, true)) {
            writer.write(line);
            writer.write(System.lineSeparator());
        } catch (final java.io.IOException ignored) {
        }
    }

    enum PriorityActionKind { ACTION, PASS, UNDO }

    static final class PriorityChoice {
        private final PriorityActionKind kind;
        private final SpellAbility action;
        private final String untilPlayer;
        private final String untilPhase;
        private final Card untapCard;
        private final String color;

        private PriorityChoice(
                final PriorityActionKind kind,
                final SpellAbility action,
                final String untilPlayer,
                final String untilPhase) {
            this(kind, action, untilPlayer, untilPhase, null, null);
        }

        private PriorityChoice(
                final PriorityActionKind kind,
                final SpellAbility action,
                final String untilPlayer,
                final String untilPhase,
                final Card untapCard,
                final String color) {
            this.kind = kind;
            this.action = action;
            this.untilPlayer = untilPlayer;
            this.untilPhase = untilPhase;
            this.untapCard = untapCard;
            this.color = color;
        }

        PriorityActionKind kind() {
            return kind;
        }

        SpellAbility action() {
            return action;
        }

        String untilPlayer() {
            return untilPlayer;
        }

        String untilPhase() {
            return untilPhase;
        }

        Card untapCard() {
            return untapCard;
        }

        String color() {
            return color;
        }
    }

    PriorityChoice awaitPriorityAction(
            final int playerId,
            final List<SpellAbility> actionsForPrompt,
            final List<Card> untappableCards
    ) {
        requireAttached();
        publishPriorityPrompt(playerId, actionsForPrompt, untappableCards);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = takeAction();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new PriorityChoice(PriorityActionKind.PASS, null, null, null);
            }
            try {
                return interpretPriorityAction(action, actionsForPrompt, untappableCards);
            } catch (IllegalArgumentException | UnsupportedOperationException | NullPointerException invalid) {
                System.err.println("[mana-brew] ignoring invalid priority answer: " + invalid
                        + " | playerId=" + playerId
                        + " options=" + actionsForPrompt.size()
                        + " untappable=" + untappableCards.size()
                        + " phase=" + game.getPhaseHandler().getPhase()
                        + " turn=" + game.getPhaseHandler().getTurn()
                        + " action=" + action);
                invalid.printStackTrace(System.err);
                publishPriorityPrompt(playerId, actionsForPrompt, untappableCards);
            }
        }
        return new PriorityChoice(PriorityActionKind.PASS, null, null, null);
    }

    private PriorityChoice interpretPriorityAction(
            final JsonObject action,
            final List<SpellAbility> actionsForPrompt,
            final List<Card> untappableCards
    ) {
        {
            final String kind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(kind) || "pass_priority".equals(kind)) {
                final JsonObject until = action.has("until") && action.get("until").isJsonObject()
                        ? action.getAsJsonObject("until")
                        : null;
                final String untilPlayer = until != null && until.has("playerId")
                        && !until.get("playerId").isJsonNull() ? until.get("playerId").getAsString() : null;
                final String untilPhase = until != null && until.has("phase")
                        && !until.get("phase").isJsonNull() ? until.get("phase").getAsString() : null;
                return new PriorityChoice(PriorityActionKind.PASS, null, untilPlayer, untilPhase);
            }
            if ("untap_land".equals(kind)) {
                final Card untapCard = resolveUntapCard(action, untappableCards);
                return new PriorityChoice(PriorityActionKind.UNDO, null, null, null, untapCard, null);
            }
            if ("choose_action".equals(kind)) {
                final int index = action.get("index").getAsInt();
                if (index < 0 || index >= actionsForPrompt.size()) {
                    throw new IllegalArgumentException("action index out of range: " + index);
                }
                return new PriorityChoice(PriorityActionKind.ACTION, actionsForPrompt.get(index), null, null);
            }
            if ("tap_land".equals(kind)) {
                if (!action.has("manaAbilityIndex") || action.get("manaAbilityIndex").isJsonNull()) {
                    throw new IllegalArgumentException("tap_land during priority needs manaAbilityIndex");
                }
                final int index = action.get("manaAbilityIndex").getAsInt();
                if (index < 0 || index >= actionsForPrompt.size()) {
                    throw new IllegalArgumentException("tap_land index out of range: " + index);
                }
                final String color = action.has("color") && !action.get("color").isJsonNull()
                        ? action.get("color").getAsString()
                        : null;
                return new PriorityChoice(PriorityActionKind.ACTION, actionsForPrompt.get(index), null, null, null, color);
            }
            throw new UnsupportedOperationException("unsupported action kind: " + kind);
        }
    }

    enum ManaPaymentKind { TAP, UNTAP, PAY, PAY_LIFE, CANCEL, DELVE, UNDELVE }

    static final class ManaPaymentChoice {
        private final ManaPaymentKind kind;
        private final SpellAbility tapAbility;
        private final String color;
        private final Card untapCard;
        private final Card convokeCard;
        private final Card delveCard;
        private final boolean auto;

        private ManaPaymentChoice(
                final ManaPaymentKind kind,
                final SpellAbility tapAbility,
                final String color,
                final Card untapCard,
                final Card convokeCard,
                final Card delveCard,
                final boolean auto
        ) {
            this.kind = kind;
            this.tapAbility = tapAbility;
            this.color = color;
            this.untapCard = untapCard;
            this.convokeCard = convokeCard;
            this.delveCard = delveCard;
            this.auto = auto;
        }

        ManaPaymentKind kind() {
            return kind;
        }

        SpellAbility tapAbility() {
            return tapAbility;
        }

        String color() {
            return color;
        }

        Card untapCard() {
            return untapCard;
        }

        Card convokeCard() {
            return convokeCard;
        }

        Card delveCard() {
            return delveCard;
        }

        boolean auto() {
            return auto;
        }
    }

    ManaBrewInteractiveSession.ManaPaymentChoice awaitManaPaymentChoice(
            final int playerId,
            final Card payingFor,
            final String remainingCost,
            final List<SpellAbility> tappableSources,
            final List<Card> untappableCards,
            final List<Card> convokeSources,
            final List<Card> delveSources,
            final java.util.Collection<Card> delvedCards,
            final boolean canConfirm,
            final boolean canCancel,
            final boolean canPayLife,
            final int lifeToPay
    ) {
        requireAttached();
        publishManaPaymentPrompt(
                playerId, payingFor, remainingCost, tappableSources, untappableCards, convokeSources,
                delveSources, delvedCards, canConfirm, canCancel, canPayLife, lifeToPay);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = takeAction();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, null, null, false);
            }
            try {
                return interpretManaPaymentChoice(
                        action, tappableSources, untappableCards, convokeSources, delveSources);
            } catch (IllegalArgumentException | UnsupportedOperationException | NullPointerException invalid) {
                System.err.println("[mana-brew] ignoring invalid mana-payment answer: " + invalid
                        + " | playerId=" + playerId
                        + " payingFor=" + (payingFor != null ? payingFor.getName() : "null")
                        + " remainingCost=" + remainingCost
                        + " tappable=" + tappableSources.size()
                        + " canConfirm=" + canConfirm + " canCancel=" + canCancel
                        + " action=" + action);
                invalid.printStackTrace(System.err);
                publishManaPaymentPrompt(
                        playerId, payingFor, remainingCost, tappableSources, untappableCards, convokeSources,
                        delveSources, delvedCards, canConfirm, canCancel, canPayLife, lifeToPay);
            }
        }
        return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, null, null, false);
    }

    private ManaPaymentChoice interpretManaPaymentChoice(
            final JsonObject action,
            final List<SpellAbility> tappableSources,
            final List<Card> untappableCards,
            final List<Card> convokeSources,
            final List<Card> delveSources
    ) {
        {
            final String kind = action.has("kind") ? action.get("kind").getAsString() : "";
            switch (kind) {
                case "tap_land": {
                    final SpellAbility chosen = resolveTapSource(action, tappableSources);
                    if (chosen != null) {
                        final String color = action.has("color") && !action.get("color").isJsonNull()
                                ? action.get("color").getAsString()
                                : null;
                        return new ManaPaymentChoice(ManaPaymentKind.TAP, chosen, color, null, null, null, false);
                    }
                    final Card convokeCard = resolveConvokeSource(action, convokeSources);
                    if (convokeCard == null) {
                        throw new IllegalArgumentException("tap_land did not match a tappable source");
                    }
                    return new ManaPaymentChoice(ManaPaymentKind.TAP, null, null, null, convokeCard, null, false);
                }
                case "untap_land": {
                    final Card card = resolveUntapCard(action, untappableCards);
                    return new ManaPaymentChoice(ManaPaymentKind.UNTAP, null, null, card, null, null, false);
                }
                case "delve": {
                    final Card card = resolveDelveSource(action, delveSources);
                    if (card == null) {
                        throw new IllegalArgumentException("delve did not match a graveyard source");
                    }
                    return new ManaPaymentChoice(ManaPaymentKind.DELVE, null, null, null, null, card, false);
                }
                case "undelve": {
                    final Card card = resolveDelveSource(action, delveSources);
                    if (card == null) {
                        throw new IllegalArgumentException("undelve did not match a graveyard source");
                    }
                    return new ManaPaymentChoice(ManaPaymentKind.UNDELVE, null, null, null, null, card, false);
                }
                case "pay_mana": {
                    final boolean auto = action.has("auto") && action.get("auto").getAsBoolean();
                    return new ManaPaymentChoice(ManaPaymentKind.PAY, null, null, null, null, null, auto);
                }
                case "pay_life":
                    return new ManaPaymentChoice(ManaPaymentKind.PAY_LIFE, null, null, null, null, null, false);
                case "cancel_mana":
                case "pass":
                case "pass_priority":
                    return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, null, null, false);
                default:
                    throw new UnsupportedOperationException("unsupported mana-payment action kind: " + kind);
            }
        }
    }

    private SpellAbility resolveTapSource(final JsonObject action, final List<SpellAbility> tappableSources) {
        final String cardId = action.has("cardId") && !action.get("cardId").isJsonNull()
                ? action.get("cardId").getAsString()
                : null;
        final Integer abilityIndex = action.has("manaAbilityIndex") && !action.get("manaAbilityIndex").isJsonNull()
                ? action.get("manaAbilityIndex").getAsInt()
                : null;
        SpellAbility firstForCard = null;
        for (final SpellAbility sa : tappableSources) {
            final Card host = sa.getHostCard();
            if (host == null) {
                continue;
            }
            if (cardId != null && !SnapshotExtractor.javaCardId(host).equals(cardId)) {
                continue;
            }
            if (firstForCard == null) {
                firstForCard = sa;
            }
            if (abilityIndex == null || host.getManaAbilities().indexOf(sa) == abilityIndex) {
                return sa;
            }
        }
        return firstForCard;
    }

    private Card resolveConvokeSource(final JsonObject action, final List<Card> convokeSources) {
        final String cardId = action.has("cardId") && !action.get("cardId").isJsonNull()
                ? action.get("cardId").getAsString()
                : null;
        if (cardId == null) {
            return null;
        }
        for (final Card card : convokeSources) {
            if (SnapshotExtractor.javaCardId(card).equals(cardId)) {
                return card;
            }
        }
        return null;
    }

    private Card resolveDelveSource(final JsonObject action, final List<Card> delveSources) {
        final String cardId = action.has("cardId") && !action.get("cardId").isJsonNull()
                ? action.get("cardId").getAsString()
                : null;
        if (cardId == null) {
            return null;
        }
        for (final Card card : delveSources) {
            if (SnapshotExtractor.javaCardId(card).equals(cardId)) {
                return card;
            }
        }
        return null;
    }

    private Card resolveUntapCard(final JsonObject action, final List<Card> untappableCards) {
        final String cardId = action.has("cardId") && !action.get("cardId").isJsonNull()
                ? action.get("cardId").getAsString()
                : null;
        if (cardId == null) {
            return null;
        }
        for (final Card card : untappableCards) {
            if (SnapshotExtractor.javaCardId(card).equals(cardId)) {
                return card;
            }
        }
        return null;
    }

    private void publishFirstPlayerRollPrompt(
            final int playerId,
            final List<Player> players,
            final Map<Player, Integer> rolls,
            final Player winner,
            final int sides
    ) {
        final List<DiceRollEntry> rollEntries = new java.util.ArrayList<>();
        for (final Player p : players) {
            if (!rolls.containsKey(p)) {
                continue;
            }
            final int roll = rolls.get(p);
            rollEntries.add(new DiceRollEntry(
                    p.getName(), "player-" + SnapshotExtractor.playerIndex(game, p),
                    java.util.List.of(roll), java.util.List.of(roll), java.util.List.of(), p == winner));
        }
        publishAgentPrompt("player-" + playerId, null,
                new DiceRolledInput(sides, rollEntries, "Roll for first player", null));
    }

    private void publishManaPaymentPrompt(
            final int playerId,
            final Card payingFor,
            final String remainingCost,
            final List<SpellAbility> tappableSources,
            final List<Card> untappableCards,
            final List<Card> convokeSources,
            final List<Card> delveSources,
            final java.util.Collection<Card> delvedCards,
            final boolean canConfirm,
            final boolean canCancel,
            final boolean canPayLife,
            final int lifeToPay
    ) {
        final List<AvailableAction> actionList = new java.util.ArrayList<>();
        for (final SpellAbility sa : tappableSources) {
            final Card host = sa.getHostCard();
            if (host == null) {
                continue;
            }
            final String cardId = SnapshotExtractor.javaCardId(host);
            final int abilityIndex = host.getManaAbilities().indexOf(sa);
            final String description = host.getName();
            final String cost = simpleCostText(sa);
            final String produced = resolveProducedMana(sa);
            final Integer amount = sa.getManaPart() == null ? null : sa.amountOfManaGenerated(false);
            for (final ManaChoice choice : splitManaChoices(produced, amount)) {
                final String actionId = choice.color != null
                        ? "tap:" + cardId + ":" + abilityIndex + ":" + choice.color
                        : "tap:" + cardId + ":" + abilityIndex;
                actionList.add(new AvailableAction_activateAbility(
                        actionId, cardId, abilityIndex, description, true, cost, choice.producedMana));
            }
        }

        for (final Card card : convokeSources) {
            final String cardId = SnapshotExtractor.javaCardId(card);
            actionList.add(new AvailableAction_activateAbility(
                    "tap:" + cardId, cardId, 0, card.getName(), true, null, null));
        }
        for (final Card card : untappableCards) {
            final String cardId = SnapshotExtractor.javaCardId(card);
            actionList.add(new AvailableAction_undoMana("untap:" + cardId, cardId));
        }
        for (final Card card : delveSources) {
            final String cardId = SnapshotExtractor.javaCardId(card);
            if (delvedCards != null && delvedCards.contains(card)) {
                actionList.add(new AvailableAction_undelve("undelve:" + cardId, cardId));
            } else {
                actionList.add(new AvailableAction_delve("delve:" + cardId, cardId));
            }
        }
        publishAgentPrompt("player-" + playerId, null, new PayManaCostInput(
                payingFor != null ? SnapshotExtractor.javaCardId(payingFor) : "",
                payingFor != null ? InteractiveSnapshotExtractor.normalizeCardName(payingFor.getName()) : "",
                remainingCost != null ? remainingCost : "",
                canConfirm, actionList, null));
    }

    List<String> awaitManaCombo(
            final int playerId,
            final List<String> availableColors,
            final int amount,
            final String sourceName
    ) {
        publishAgentPrompt("player-" + playerId, null,
                new ChooseColorInput(new java.util.ArrayList<>(availableColors), amount, true));

        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new ArrayList<>();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("mana_combo_decision".equals(actionKind)) {
                final List<String> chosen = new ArrayList<>();
                if (action.has("chosenColors") && action.get("chosenColors").isJsonArray()) {
                    for (final JsonElement element : action.getAsJsonArray("chosenColors")) {
                        chosen.add(element.getAsString());
                    }
                }
                return chosen;
            }
            throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
        }
        return new ArrayList<>();
    }

    Player awaitFirstPlayerRoll(final int playerId, final List<Player> players) {
        requireAttached();
        final Random rng = forge.util.MyRandom.getRandom();
        final int sides = 20;
        final Map<Player, Integer> openingRolls = new LinkedHashMap<Player, Integer>();
        List<Player> contenders = new ArrayList<Player>(players);
        Player winner;
        boolean firstRound = true;
        while (true) {
            final Map<Player, Integer> roundRolls = new LinkedHashMap<Player, Integer>();
            int highest = 0;
            for (final Player contender : contenders) {
                final int value = rng.nextInt(sides) + 1;
                roundRolls.put(contender, value);
                highest = Math.max(highest, value);
            }
            if (firstRound) {
                openingRolls.putAll(roundRolls);
                firstRound = false;
            }
            final List<Player> top = new ArrayList<Player>();
            for (final Player contender : contenders) {
                if (roundRolls.get(contender) == highest) {
                    top.add(contender);
                }
            }
            if (top.size() == 1) {
                winner = top.get(0);
                break;
            }
            contenders = top;
        }
        publishFirstPlayerRollPrompt(playerId, players, openingRolls, winner, sides);
        awaitFirstPlayerRollAcknowledgement();
        return winner;
    }

    private void awaitFirstPlayerRollAcknowledgement() {
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("first_player_roll_acknowledged".equals(actionKind)
                    || "pass".equals(actionKind)
                    || "pass_priority".equals(actionKind)) {
                return;
            }
            throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
        }
    }

    boolean awaitMulliganDecision(final int playerId, final int cardsToReturn) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(
                game.getRegisteredPlayers().get(playerId).getCardsIn(forge.game.zone.ZoneType.Hand));
        publishCardChoicePrompt("mulligan", playerId, cards, 0, 0, cardsToReturn);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = takeAction();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return true;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("mulligan_decision".equals(actionKind)) {
                return action.has("keep") && action.get("keep").getAsBoolean();
            }
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return true;
            }
            throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
        }
        return true;
    }

    CardCollection awaitMulliganPutBack(final int playerId, final CardCollectionView hand, final int count) {
        requireAttached();
        if (count <= 0) {
            return new CardCollection();
        }
        final List<Card> cards = new ArrayList<Card>(hand);
        final int clampedCount = Math.min(count, cards.size());
        publishCardChoicePrompt("mulligan_put_back", playerId, cards, clampedCount, clampedCount, clampedCount);
        return awaitCardsFromPublishedPrompt(cards, clampedCount, clampedCount);
    }

    CardCollection awaitAttackers(
            final int playerId,
            final Combat combat,
            final List<Card> availableAttackers
    ) {
        requireAttached();
        publishAttackersPrompt(playerId, combat, availableAttackers);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = takeAction();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new CardCollection();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new CardCollection();
            }
            if (!"declare_attackers".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection selected = new CardCollection();
            if (action.has("assignments") && action.get("assignments").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("assignments")) {
                    if (!element.isJsonObject()) {
                        continue;
                    }
                    final JsonObject assignment = element.getAsJsonObject();
                    final String attackerId = assignment.has("attackerId")
                            ? assignment.get("attackerId").getAsString()
                            : "";
                    final Card selectedCard = findCardByPublishedId(availableAttackers, attackerId);
                    if (selectedCard != null && !selected.contains(selectedCard)) {
                        selected.add(selectedCard);
                    }
                }
            }
            return selected;
        }
        return new CardCollection();
    }

    List<Pair<Card, GameEntity>> awaitAttackAssignments(
            final int playerId,
            final Combat combat,
            final List<Card> availableAttackers
    ) {
        requireAttached();
        publishAttackersPrompt(playerId, combat, availableAttackers);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new ArrayList<>();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new ArrayList<>();
            }
            if (!"declare_attackers".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final List<Pair<Card, GameEntity>> selected = new ArrayList<>();
            if (action.has("assignments") && action.get("assignments").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("assignments")) {
                    if (!element.isJsonObject()) {
                        continue;
                    }
                    final JsonObject assignment = element.getAsJsonObject();
                    final String attackerId = assignment.has("attackerId")
                            ? assignment.get("attackerId").getAsString()
                            : "";
                    final String selectedDefenderId = assignment.has("defenderId")
                            ? assignment.get("defenderId").getAsString()
                            : "";
                    final Card selectedCard = findCardByPublishedId(availableAttackers, attackerId);
                    final GameEntity selectedDefender = findDefenderByPublishedId(combat, selectedDefenderId);
                    if (selectedCard != null && selectedDefender != null) {
                        selected.add(ImmutablePair.of(selectedCard, selectedDefender));
                    }
                }
            }
            return selected;
        }
        return new ArrayList<>();
    }

    List<Pair<Card, Card>> awaitBlockers(
            final int playerId,
            final List<Card> attackers,
            final List<Card> availableBlockers,
            final Map<Card, List<Card>> validBlockersByAttacker,
            final String error
    ) {
        requireAttached();
        publishBlockersPrompt(playerId, attackers, availableBlockers, validBlockersByAttacker, error);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new ArrayList<>();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new ArrayList<>();
            }
            if (!"declare_blockers".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final List<Pair<Card, Card>> selected = new ArrayList<>();
            if (action.has("assignments") && action.get("assignments").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("assignments")) {
                    if (!element.isJsonObject()) {
                        continue;
                    }
                    final JsonObject assignment = element.getAsJsonObject();
                    final String blockerId = assignment.has("blockerId")
                            ? assignment.get("blockerId").getAsString()
                            : "";
                    final String attackerId = assignment.has("attackerId")
                            ? assignment.get("attackerId").getAsString()
                            : "";
                    final Card blocker = findCardByPublishedId(availableBlockers, blockerId);
                    final Card attacker = findCardByPublishedId(attackers, attackerId);
                    if (blocker != null && attacker != null) {
                        selected.add(ImmutablePair.of(blocker, attacker));
                    }
                }
            }
            return selected;
        }
        return new ArrayList<>();
    }

    CardCollection awaitCardChoice(
            final String kind,
            final int playerId,
            final CardCollectionView validCards,
            final int min,
            final int max
    ) {
        requireAttached();
        final List<Card> cards = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(validCards));
        final int clampedMin = Math.min(min, cards.size());
        final int clampedMax = Math.min(max, cards.size());
        publishCardChoicePrompt(kind, playerId, cards, clampedMin, clampedMax);
        return awaitCardsFromPublishedPrompt(cards, clampedMin, clampedMax);
    }

    CardCollection awaitCardChoice(
            final String kind,
            final int playerId,
            final CardCollectionView validCards,
            final int min,
            final int max,
            final String sourceName,
            final String sourceCardId,
            final String description
    ) {
        return awaitCardChoice(kind, playerId, validCards, min, max, sourceName, sourceCardId, description, false);
    }

    CardCollection awaitCardChoice(
            final String kind,
            final int playerId,
            final CardCollectionView validCards,
            final int min,
            final int max,
            final String sourceName,
            final String sourceCardId,
            final String description,
            final boolean optionalDecline
    ) {
        return awaitCardChoice(
                kind, playerId, validCards, min, max, sourceName, sourceCardId, description, optionalDecline, null);
    }

    CardCollection awaitCardChoice(
            final String kind,
            final int playerId,
            final CardCollectionView validCards,
            final int min,
            final int max,
            final String sourceName,
            final String sourceCardId,
            final String description,
            final boolean optionalDecline,
            final String error
    ) {
        requireAttached();
        final List<Card> cards = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(validCards));
        final int clampedMin = Math.min(min, cards.size());
        final int clampedMax = Math.min(max, cards.size());
        publishCardChoicePrompt(
                kind, playerId, cards, clampedMin, clampedMax, sourceName, sourceCardId, description, optionalDecline, error);
        return awaitCardsFromPublishedPrompt(cards, clampedMin, clampedMax, optionalDecline);
    }

    void awaitRevealCards(
            final int playerId,
            final CardCollectionView cardsForPrompt,
            final ZoneType zone,
            final Player owner,
            final String messagePrefix
    ) {
        requireAttached();
        final List<Card> cards = cardsForPrompt == null
                ? new ArrayList<Card>()
                : new ArrayList<Card>(cardsForPrompt);
        publishRevealCardsPrompt(playerId, cards, zone, owner, messagePrefix);
        awaitRevealAcknowledgement();
    }

    void awaitNotifyAcknowledgement(final int playerId, final String message) {
        requireAttached();
        publishRevealCardsPrompt(playerId, new ArrayList<Card>(), null, null, message);
        awaitRevealAcknowledgement();
    }

    void awaitRevealCardViews(
            final int playerId,
            final List<CardView> cardsForPrompt,
            final ZoneType zone,
            final PlayerView owner,
            final String messagePrefix
    ) {
        requireAttached();
        final List<CardView> cards = cardsForPrompt == null
                ? new ArrayList<CardView>()
                : new ArrayList<CardView>(cardsForPrompt);
        publishRevealCardViewsPrompt(playerId, cards, zone, owner, messagePrefix);
        awaitRevealAcknowledgement();
    }

    List<Integer> awaitModeChoice(
            final int playerId,
            final List<String> options,
            final int min,
            final int max,
            final String sourceName
    ) {
        return awaitModeChoice(playerId, options, min, max, sourceName, false);
    }

    List<Integer> awaitModeChoice(
            final int playerId,
            final List<String> options,
            final int min,
            final int max,
            final String sourceName,
            final boolean allowRepeat
    ) {
        requireAttached();
        if (options.isEmpty() && min > 0) {
            throw new IllegalArgumentException("unsatisfiable mode prompt: min " + min + " with no options");
        }
        final int clampedMin = allowRepeat ? min : Math.min(min, options.size());
        final int clampedMax = allowRepeat ? max : Math.min(max, options.size());
        publishOptionPrompt("choose_mode", playerId, options, clampedMin, clampedMax, sourceName, null);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return defaultModeIndices(options, clampedMin);
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return defaultModeIndices(options, clampedMin);
            }
            if (!"mode_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final List<Integer> selected = new ArrayList<>();
            if (action.has("indices") && action.get("indices").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("indices")) {
                    selected.add(element.getAsInt());
                }
            }
            validateModeIndices(selected, options.size(), clampedMin, clampedMax, allowRepeat);
            return selected;
        }
        return defaultModeIndices(options, clampedMin);
    }

    private static List<Integer> defaultModeIndices(final List<String> options, final int min) {
        final List<Integer> indices = new ArrayList<>();
        for (int i = 0; i < min && !options.isEmpty(); i++) {
            indices.add(Math.min(i, options.size() - 1));
        }
        return indices;
    }

    private static void validateModeIndices(
            final List<Integer> selected, final int optionCount, final int min, final int max, final boolean allowRepeat) {
        if (selected.size() < min || selected.size() > max) {
            throw new IllegalArgumentException("selected option count out of range: " + selected.size());
        }
        final Set<Integer> seen = new HashSet<>();
        for (final Integer index : selected) {
            if (index == null || index < 0 || index >= optionCount) {
                throw new IllegalArgumentException("option index out of range: " + index);
            }
            if (!allowRepeat && !seen.add(index)) {
                throw new IllegalArgumentException("duplicate option index: " + index);
            }
        }
    }

    boolean awaitBooleanChoice(
            final String kind,
            final int playerId,
            final String description,
            final String sourceName,
            final String promptKind,
            final String mode,
            final String api
    ) {
        return awaitBooleanChoice(kind, playerId, description, sourceName, promptKind, mode, api, null, null);
    }

    boolean awaitBooleanChoice(
            final String kind,
            final int playerId,
            final String description,
            final String sourceName,
            final String promptKind,
            final String mode,
            final String api,
            final List<String> optionLabels,
            final Boolean passDefault
    ) {
        return awaitBooleanChoice(
                kind, playerId, description, sourceName, promptKind, mode, api, optionLabels, passDefault, null,
                null, null);
    }

    boolean awaitBooleanChoice(
            final String kind,
            final int playerId,
            final String description,
            final String sourceName,
            final String promptKind,
            final String mode,
            final String api,
            final List<String> optionLabels,
            final Boolean passDefault,
            final List<Card> targetCards,
            final List<Player> targetPlayers,
            final String effectText
    ) {
        requireAttached();
        publishBooleanPrompt(
                kind, playerId, description, sourceName, promptKind, mode, api, optionLabels, targetCards,
                targetPlayers, effectText);
        final boolean onPass = passDefault != null && passDefault;
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return onPass;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return onPass;
            }
            if (!"boolean_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            return action.has("accept") && action.get("accept").getAsBoolean();
        }
        return onPass;
    }

    int awaitNumberChoice(
            final int playerId,
            final int min,
            final int max,
            final String sourceCardId,
            final String description
    ) {
        return awaitNumberChoice(playerId, min, max, sourceCardId, description, false);
    }

    Integer awaitCancellableNumberChoice(
            final int playerId,
            final int min,
            final int max,
            final String sourceCardId,
            final String description
    ) {
        return awaitNumberChoice(playerId, min, max, sourceCardId, description, true);
    }

    private Integer awaitNumberChoice(
            final int playerId,
            final int min,
            final int max,
            final String sourceCardId,
            final String description,
            final boolean canCancel
    ) {
        requireAttached();
        if (min > max) {
            throw new IllegalArgumentException("unsatisfiable number prompt: min " + min + " > max " + max);
        }
        if (min == max) {
            return min;
        }
        publishNumberPrompt(playerId, min, max, sourceCardId, description, canCancel);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return min;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return min;
            }
            if (canCancel && "cancel_number".equals(actionKind)) {
                return null;
            }
            if (!"number_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final int number = action.has("number") ? action.get("number").getAsInt() : min;
            return Math.max(min, Math.min(max, number));
        }
        return min;
    }

    String awaitStringChoice(
            final String kind,
            final int playerId,
            final List<String> options,
            final String sourceName,
            final String description
    ) {
        requireAttached();
        publishOptionPrompt(kind, playerId, options, 1, 1, sourceName, description);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return options.isEmpty() ? "" : options.get(0);
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return options.isEmpty() ? "" : options.get(0);
            }
            if ("mode_decision".equals(actionKind)) {
                final com.google.gson.JsonArray indices =
                        action.has("indices") ? action.getAsJsonArray("indices") : null;
                if (indices == null || indices.size() == 0) {
                    return options.isEmpty() ? "" : options.get(0);
                }
                final int index = indices.get(0).getAsInt();
                return index >= 0 && index < options.size()
                        ? options.get(index)
                        : (options.isEmpty() ? "" : options.get(0));
            }
            if (!"string_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final String value = action.has("value") ? action.get("value").getAsString() : "";
            if (!options.contains(value)) {
                throw new IllegalArgumentException("string choice not among offered options: " + value);
            }
            return value;
        }
        return options.isEmpty() ? "" : options.get(0);
    }

    /**
     * Publishes a scry/surveil prompt and awaits the `scry_decision` response.
     * Returns `(top, other)` where `other` is the bottom-of-library (scry) or
     * graveyard (surveil) pile, both in the order the player stacked them.
     */
    Pair<CardCollection, CardCollection> awaitScryDecision(
            final String promptKind,
            final int playerId,
            final CardCollectionView cardsForPrompt,
            final String sourceName
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(cardsForPrompt);
        publishLibraryPrompt(promptKind, playerId, cards, sourceName);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return ImmutablePair.of(new CardCollection(cards), new CardCollection());
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return ImmutablePair.of(new CardCollection(cards), new CardCollection());
            }
            if (!"scry_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection top = parseScryZone(action, cards, 0);
            final CardCollection other = parseScryZone(action, cards, 1);
            // Any card not assigned anywhere stays on top.
            for (final Card card : cards) {
                if (!top.contains(card) && !other.contains(card)) {
                    top.add(card);
                }
            }
            return ImmutablePair.of(top, other);
        }
        return ImmutablePair.of(new CardCollection(cards), new CardCollection());
    }

    private CardCollection parseScryZone(final JsonObject action, final List<Card> cards, final int idx) {
        final CardCollection result = new CardCollection();
        if (action.has("zone_card_ids") && action.get("zone_card_ids").isJsonArray()) {
            final com.google.gson.JsonArray zones = action.getAsJsonArray("zone_card_ids");
            if (idx < zones.size() && zones.get(idx).isJsonArray()) {
                for (JsonElement element : zones.get(idx).getAsJsonArray()) {
                    final Card card = findCardByPublishedId(cards, element.getAsString());
                    if (card != null && !result.contains(card)) {
                        result.add(card);
                    }
                }
            }
        }
        return result;
    }

    CardCollection awaitReorderZone(
            final int playerId,
            final CardCollectionView cardsForPrompt,
            final ZoneType destination,
            final boolean topOfDeck,
            final String sourceName,
            final String sourceCardId
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(cardsForPrompt);
        publishReorderZonePrompt(playerId, cards, destination, topOfDeck, sourceName, sourceCardId);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new CardCollection(cards);
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new CardCollection(cards);
            }
            if (!"reorder_library_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection ordered = new CardCollection();
            if (action.has("ordered_card_ids") && action.get("ordered_card_ids").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("ordered_card_ids")) {
                    final Card card = findCardByPublishedId(cards, element.getAsString());
                    if (card != null && !ordered.contains(card)) {
                        ordered.add(card);
                    }
                }
            }
            if (ordered.size() != cards.size()) {
                return new CardCollection(cards);
            }
            return ordered;
        }
        return new CardCollection(cards);
    }

    CardCollection awaitDamageAssignmentOrder(
            final int playerId,
            final Card attacker,
            final CardCollectionView blockers
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(blockers);
        publishDamageAssignmentOrderPrompt(playerId, attacker, cards);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new CardCollection(cards);
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new CardCollection(cards);
            }
            if (!"damage_assignment_order_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection ordered = new CardCollection();
            if (action.has("ordered_card_ids") && action.get("ordered_card_ids").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("ordered_card_ids")) {
                    final Card card = findCardByPublishedId(cards, element.getAsString());
                    if (card != null && !ordered.contains(card)) {
                        ordered.add(card);
                    }
                }
            }
            if (ordered.size() != cards.size()) {
                return new CardCollection(cards);
            }
            return ordered;
        }
        return new CardCollection(cards);
    }

    Map<Card, Integer> awaitCombatDamageAssignment(
            final int playerId,
            final Card attacker,
            final CardCollectionView blockers,
            final int damageDealt,
            final GameEntity defender,
            final boolean defenderAssignable,
            final boolean maySkip
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(blockers);
        publishCombatDamageAssignmentPrompt(playerId, attacker, cards, damageDealt, defender, defenderAssignable, maySkip);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new LinkedHashMap<Card, Integer>();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new LinkedHashMap<Card, Integer>();
            }
            if (!"combat_damage_assignment_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            if (action.has("skip") && !action.get("skip").isJsonNull() && action.get("skip").getAsBoolean()) {
                if (!maySkip) {
                    throw new IllegalArgumentException("combat damage assignment cannot be skipped here");
                }
                return null;
            }
            final Map<Card, Integer> selected = new LinkedHashMap<Card, Integer>();
            if (action.has("assignments") && action.get("assignments").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("assignments")) {
                    if (!element.isJsonObject()) {
                        continue;
                    }
                    final JsonObject assignment = element.getAsJsonObject();
                    final String assigneeId = assignment.has("assigneeId")
                            ? assignment.get("assigneeId").getAsString()
                            : "";
                    final int damage = assignment.has("damage") ? assignment.get("damage").getAsInt() : 0;
                    if (damage <= 0) {
                        continue;
                    }
                    if (defender != null && defenderId(defender).equals(assigneeId)) {
                        if (!defenderAssignable) {
                            throw new IllegalArgumentException("combat damage assigned to defender is not allowed here");
                        }
                        selected.put(null, damage);
                        continue;
                    }
                    final Card card = findCardByPublishedId(cards, assigneeId);
                    if (card == null) {
                        throw new IllegalArgumentException("combat damage assigned to unknown blocker: " + assigneeId);
                    }
                    selected.put(card, selected.getOrDefault(card, 0) + damage);
                }
            }
            return selected;
        }
        return new LinkedHashMap<Card, Integer>();
    }

    Pair<GameEntity, forge.game.GameObject> awaitTargetChoice(
            final int playerId,
            final SpellAbility ability,
            final List<Pair<GameEntity, forge.game.GameObject>> candidates,
            final boolean mandatory
    ) {
        requireAttached();
        publishTargetPrompt(playerId, ability, candidates, mandatory);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return null;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                if (mandatory) {
                    continue;
                }
                return null;
            }
            if (!"target_choice".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final JsonObject target = action.has("target") && action.get("target").isJsonObject()
                    ? action.getAsJsonObject("target")
                    : action;
            final String kind = target.has("kind") ? target.get("kind").getAsString() : "";
            final String id = target.has("id") ? target.get("id").getAsString() : "";
            if (id.isEmpty()) {
                return null;
            }
            for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
                if (targetKind(candidate).equals(kind) && targetId(candidate).equals(id)) {
                    return candidate;
                }
            }
            throw new IllegalArgumentException("unknown target choice: " + kind + " " + id);
        }
        return null;
    }

    /**
     * Collect a sacrifice selection via the board-target flow (Sacrifice intent),
     * mirroring the Rust engine's {@code choose_sacrifice}: the UI taps one
     * permanent per response and ends with an empty choice once the minimum is
     * met. Loops until {@code max} reached or the player stops.
     */
    CardCollection awaitSacrificeChoice(
            final int playerId,
            final SpellAbility sa,
            final CardCollectionView valid,
            final int min,
            final int max,
            final String message
    ) {
        requireAttached();
        final CardCollection chosen = new CardCollection();
        final CardCollection remaining = new CardCollection(valid);
        final int cappedMax = Math.min(max, valid.size());
        final int cappedMin = Math.min(min, cappedMax);
        while (chosen.size() < cappedMax && !remaining.isEmpty() && !closed && !game.isGameOver()) {
            final List<Pair<GameEntity, forge.game.GameObject>> candidates = new ArrayList<>();
            for (final Card c : remaining) {
                candidates.add(Pair.of((GameEntity) c, (forge.game.GameObject) c));
            }
            publishSacrificePrompt(playerId, sa, candidates, cappedMin, cappedMax, chosen.size());
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                break;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                if (chosen.size() >= cappedMin) {
                    break;
                }
                continue;
            }
            if (!"target_choice".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final JsonObject target = action.has("target") && action.get("target").isJsonObject()
                    ? action.getAsJsonObject("target")
                    : action;
            final String id = target.has("id") ? target.get("id").getAsString() : "";
            if (id.isEmpty()) {
                if (chosen.size() >= cappedMin) {
                    break;
                }
                continue;
            }
            Card picked = null;
            for (final Card c : remaining) {
                if (SnapshotExtractor.javaCardId(c).equals(id)) {
                    picked = c;
                    break;
                }
            }
            if (picked == null) {
                throw new IllegalArgumentException("unknown sacrifice choice: " + id);
            }
            chosen.add(picked);
            remaining.remove(picked);
        }
        return chosen;
    }

    private void publishSacrificePrompt(
            final int playerId,
            final SpellAbility sa,
            final List<Pair<GameEntity, forge.game.GameObject>> candidates,
            final int min,
            final int max,
            final int chosen
    ) {
        final Card source = sa == null ? null : sa.getHostCard();
        final List<TargetRef> candidateRefs = new java.util.ArrayList<>();
        for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
            candidateRefs.add(new TargetRef(TargetKind.CARD, targetId(candidate), null, null));
        }
        publishAgentPrompt(
                "player-" + playerId,
                source == null ? null : SnapshotExtractor.javaCardId(source),
                new ChooseBoardTargetsInput(
                        candidateRefs, true, enumFromWire("sacrifice", TargetingIntent.class),
                        min, max, chosen, "Sacrifice"));
    }

    Map<GameEntity, Integer> awaitDividedAllocation(
            final int playerId,
            final SpellAbility ability,
            final List<GameEntity> targets,
            final int amount
    ) {
        requireAttached();
        if (targets.isEmpty() || amount < targets.size()) {
            throw new IllegalArgumentException(
                    "unsatisfiable divided allocation: " + amount + " among " + targets.size() + " targets");
        }
        // Dividing an amount among targets is a sequence of plain number choices
        // (chooseNumber), one per target, each leaving at least 1 for the rest.
        final Card source = ability == null ? null : ability.getHostCard();
        final String sourceCardId = source == null ? null : SnapshotExtractor.javaCardId(source);
        final Map<GameEntity, Integer> result = new LinkedHashMap<>();
        int remaining = amount;
        for (int i = 0; i < targets.size(); i++) {
            final GameEntity target = targets.get(i);
            final int targetsLeft = targets.size() - i - 1;
            if (targetsLeft == 0) {
                result.put(target, remaining);
                break;
            }
            final int give = awaitNumberChoice(
                    playerId, 1, remaining - targetsLeft, sourceCardId, "Assign to " + target.getName());
            result.put(target, give);
            remaining -= give;
        }
        return result;
    }

    private CardCollection awaitCardsFromPublishedPrompt(
            final List<Card> cards,
            final int min,
            final int max
    ) {
        return awaitCardsFromPublishedPrompt(cards, min, max, false);
    }

    private CardCollection awaitCardsFromPublishedPrompt(
            final List<Card> cards,
            final int min,
            final int max,
            final boolean allowEmpty
    ) {
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = takeAction();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new CardCollection();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                if (allowEmpty) {
                    return new CardCollection();
                }
                return new CardCollection(cards.subList(0, Math.min(min, cards.size())));
            }
            if (!"choose_cards".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection selected = new CardCollection();
            if (action.has("card_ids") && action.get("card_ids").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("card_ids")) {
                    final String cardId = element.getAsString();
                    final Card selectedCard = findCardByPublishedId(cards, cardId);
                    if (selectedCard != null) {
                        selected.add(selectedCard);
                    }
                }
            }
            if (allowEmpty && selected.isEmpty()) {
                return selected;
            }
            if (selected.size() < min || selected.size() > max) {
                throw new IllegalArgumentException("selected card count out of range: " + selected.size());
            }
            return selected;
        }
        return new CardCollection();
    }

    private void awaitRevealAcknowledgement() {
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("reveal_cards_acknowledged".equals(actionKind)
                    || "pass".equals(actionKind)
                    || "pass_priority".equals(actionKind)) {
                return;
            }
            throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
        }
    }

    private JsonObject takeAction() throws InterruptedException {
        while (true) {
            final JsonObject action = actions.take();
            final String kind = action.has("kind") ? action.get("kind").getAsString() : "";
            if (!"concede".equals(kind)) {
                return action;
            }
            final int target = action.has("player")
                    ? action.get("player").getAsInt()
                    : promptedPlayerIndex;
            concedePlayer(target);
            if (target != promptedPlayerIndex && !gameDecided()) {
                continue;
            }
            final JsonObject pass = new JsonObject();
            pass.addProperty("kind", "pass");
            return pass;
        }
    }

    private void concedePlayer(final int index) {
        final List<Player> players = game.getRegisteredPlayers();
        if (index < 0 || index >= players.size()) {
            return;
        }
        final Player player = players.get(index);
        if (player.hasLost()) {
            return;
        }
        player.concede();
    }

    private boolean gameDecided() {
        int remaining = 0;
        for (final Player player : game.getRegisteredPlayers()) {
            if (!player.hasLost()) {
                remaining++;
            }
        }
        return remaining <= 1;
    }

    private JsonObject takeActionOrNull() {
        try {
            return takeAction();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    private void publishPriorityPrompt(
            final int playerId,
            final List<SpellAbility> actionsForPrompt,
            final List<Card> untappableCards
    ) {
        final List<String> labels = ActionSpace.buildMainActionLabels(actionsForPrompt);
        final List<AvailableAction> actionsArray = new java.util.ArrayList<>();
        for (int i = 0; i < actionsForPrompt.size(); i++) {
            final SpellAbility sa = actionsForPrompt.get(i);
            final Card host = sa.getHostCard();
            if (host == null) {
                continue;
            }
            final String label = formatActionLabel(labels.get(i));
            if (label.isEmpty()) {
                continue;
            }
            final String cardId = SnapshotExtractor.javaCardId(host);
            final String id = "prompt-action-" + i;
            if (sa.isLandAbility() || sa.isSpell()) {
                actionsArray.add(new AvailableAction_cast(id, cardId, id, label));
            } else if (sa.isManaAbility()) {
                final String description = abilityDescription(sa, label);
                final String produced = resolveProducedMana(sa);
                final String cost = simpleCostText(sa);
                for (final ManaChoice choice : splitManaChoices(produced, sa.amountOfManaGenerated(false))) {
                    final String actionId = choice.color != null
                            ? "tap:" + cardId + ":" + i + ":" + choice.color
                            : "tap:" + cardId + ":" + i;
                    actionsArray.add(new AvailableAction_activateAbility(
                            actionId, cardId, i, description, true, cost, choice.producedMana));
                }
            } else {
                actionsArray.add(new AvailableAction_activateAbility(
                        id, cardId, i, abilityDescription(sa, label), false, null, null));
            }
        }
        for (final Card card : untappableCards) {
            final String cardId = SnapshotExtractor.javaCardId(card);
            actionsArray.add(new AvailableAction_undoMana("untap:" + cardId, cardId));
        }
        publishAgentPrompt("player-" + playerId, null, new ChooseActionInput(actionsArray));
    }

    private static String abilityDescription(final SpellAbility sa, final String fallback) {
        final String text = sa.toString().trim();
        return text.isEmpty() ? fallback : text;
    }

    private ChooseCardsInput chooseCardsInput(
            final String title,
            final String description,
            final String sourceCardId,
            final List<Card> cards,
            final boolean castable,
            final int min,
            final int max
    ) {
        return new ChooseCardsInput(
                presentation(title, description, sourceCardId), richCards(cards, castable), min, max);
    }

    private void publishCardChoicePrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final int min,
            final int max
    ) {
        final ChooseCardsInput input;
        if ("choose_discard".equals(kind)) {
            final int maxOut = max > 0 ? max : Math.max(min, 1);
            input = chooseCardsInput("Discard", null, null, cards, true, Math.min(min, maxOut), maxOut);
        } else {
            input = chooseCardsInput("Choose cards", null, null, cards, true, min, max);
        }
        publishAgentPrompt("player-" + playerId, null, input);
    }

    private void publishCardChoicePrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final int min,
            final int max,
            final String sourceName,
            final String sourceCardId,
            final String description,
            final boolean optionalDecline,
            final String error
    ) {
        final ChooseCardsInput input;
        if ("choose_discard".equals(kind)) {
            final int maxOut = max > 0 ? max : Math.max(min, 1);
            input = chooseCardsInput("Discard", description, sourceCardId, cards, true, Math.min(min, maxOut), maxOut);
        } else {
            final String title = sourceName != null ? sourceName : "Choose cards";
            input = chooseCardsInput(
                    title, description, sourceCardId, cards, false, optionalDecline ? 0 : min, max);
        }
        publishAgentPrompt("player-" + playerId, sourceCardId, input);
    }

    private void publishOptionPrompt(
            final String kind,
            final int playerId,
            final List<String> options,
            final int min,
            final int max,
            final String sourceName,
            final String description
    ) {
        if ("choose_color".equals(kind)) {
            publishAgentPrompt("player-" + playerId, null,
                    new ChooseColorInput(new java.util.ArrayList<>(options), 1, false));
            return;
        }
        final String title;
        switch (kind) {
            case "choose_mode":
                title = sourceName != null ? sourceName : "Choose";
                break;
            case "choose_type":
                title = "Choose a " + (description != null ? description : "type");
                break;
            case "choose_card_name":
                title = "Name a card";
                break;
            default:
                throw new UnsupportedOperationException("unsupported option prompt kind: " + kind);
        }
        final PromptPresentation presentation =
                new PromptPresentation(title, null, null, null, java.util.List.of());
        publishAgentPrompt(
                "player-" + playerId, null, new ChooseFromSelectionInput(presentation, options, min, max));
    }

    private void publishBooleanPrompt(
            final String kind,
            final int playerId,
            final String description,
            final String sourceName,
            final String promptKind,
            final String mode,
            final String api,
            final List<String> optionLabels,
            final List<Card> targetCards,
            final List<Player> targetPlayers,
            final String effectText
    ) {
        final List<TargetRef> targets = new java.util.ArrayList<>();
        final String title;
        String text = null;
        final String confirmLabel;
        final String denyLabel;
        String envelopeSourceCardId = null;
        if ("pay_cost_to_prevent_effect".equals(kind)) {
            String base = description == null || description.isEmpty() ? "Pay cost" : description;
            base = base.replace(" Life", " {LIFE}").replace(" life", " {LIFE}");
            title = base.endsWith("?") ? base : base + "?";
            if (effectText != null) {
                final String trimmed = effectText.trim();
                if (!trimmed.isEmpty()) {
                    text = "otherwise: \"" + trimmed + "\"";
                }
            }
            if (targetCards != null) {
                for (final Card card : targetCards) {
                    targets.add(new TargetRef(TargetKind.CARD, SnapshotExtractor.javaCardId(card), null, null));
                }
            }
            if (targetPlayers != null) {
                for (final Player target : targetPlayers) {
                    targets.add(new TargetRef(TargetKind.PLAYER, "player-" + SnapshotExtractor.playerIndex(game, target), null, null));
                }
            }
            confirmLabel = "Pay";
            denyLabel = "Decline";
            envelopeSourceCardId = sourceName;
        } else {
            title = description != null ? description : "Confirm?";
            final boolean labeled = optionLabels != null && optionLabels.size() == 2;
            confirmLabel = labeled ? optionLabels.get(0) : "Accept";
            denyLabel = labeled ? optionLabels.get(1) : "Decline";
        }
        final PromptPresentation presentation = new PromptPresentation(title, null, text, sourceName, targets);
        publishAgentPrompt("player-" + playerId, envelopeSourceCardId,
                new ChooseBooleanInput(presentation, confirmLabel, denyLabel));
    }

    private void publishRevealCardsPrompt(
            final int playerId,
            final List<Card> cards,
            final ZoneType zone,
            final Player owner,
            final String messagePrefix
    ) {
        final String ownerPlayerId = owner != null
                ? "player-" + SnapshotExtractor.playerIndex(game, owner)
                : "player-" + playerId;
        publishAgentPrompt("player-" + playerId, null, revealInput(
                zone == null ? null : zone.toString(), messagePrefix, ownerPlayerId, richCards(cards, false)));
    }

    private void publishRevealCardViewsPrompt(
            final int playerId,
            final List<CardView> cards,
            final ZoneType zone,
            final PlayerView owner,
            final String messagePrefix
    ) {
        final String ownerPlayerId = owner != null
                ? "player-view-" + owner.getId()
                : "player-" + playerId;
        final List<CardDto> cardArray = new java.util.ArrayList<>();
        for (final CardView card : cards) {
            final Card real = game.findById(card.getId());
            if (real != null) {
                cardArray.add(InteractiveSnapshotExtractor.cardDto(game, real, false));
            } else {
                final CardDto minimal = new CardDto();
                minimal.id = "java-card-view-" + card.getId();
                minimal.identity = new CardIdentity(card.getName(), "", "", false);
                cardArray.add(minimal);
            }
        }
        publishAgentPrompt("player-" + playerId, null, revealInput(
                zone == null ? null : zone.toString(), messagePrefix, ownerPlayerId, cardArray));
    }

    private RevealCardsInput revealInput(
            final String zone,
            final String message,
            final String ownerPlayerId,
            final List<CardDto> cards
    ) {
        return new RevealCardsInput(
                cards, zone == null ? "unknown" : zone, ownerPlayerId,
                message == null ? "Look at these cards" : message);
    }

    private void publishNumberPrompt(
            final int playerId,
            final int min,
            final int max,
            final String sourceCardId,
            final String description,
            final boolean canCancel
    ) {
        final String title = description != null && !description.trim().isEmpty()
                ? description : "Choose a number";
        publishAgentPrompt("player-" + playerId, null,
                new ChooseNumberInput(presentation(title, null, sourceCardId), min, max));
    }

    private void publishReorderZonePrompt(
            final int playerId,
            final List<Card> cards,
            final ZoneType destination,
            final boolean topOfDeck,
            final String sourceName,
            final String sourceCardId
    ) {
        final String title = sourceName != null ? sourceName : "Reorder";
        final String targetLabel = destination != null
                ? destination.name()
                : (topOfDeck ? "Top of Library" : "Bottom of Library");
        publishAgentPrompt("player-" + playerId, sourceCardId, new ReorderCardsInput(
                presentation(title, "Arrange these cards in order.", sourceCardId),
                richCards(cards, false), targetLabel, topOfDeck));
    }

    private void publishLibraryPrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final String sourceName
    ) {
        final boolean surveil = "choose_surveil".equals(kind);
        final String title = surveil ? "Surveil" : "Scry";
        final String description = surveil
                ? "Put any number into your graveyard; the rest on top in any order."
                : "Put any number on the bottom; the rest on top in any order.";
        final List<ScryDestination> zones = java.util.List.of(
                ScryDestination.LIBRARY_TOP, surveil ? ScryDestination.GRAVEYARD : ScryDestination.LIBRARY_BOTTOM);
        publishAgentPrompt("player-" + playerId, null, new ScryInput(
                presentation(title, description, null), richCards(cards, false), zones));
    }

    private void publishCardChoicePrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final int min,
            final int max,
            final int count
    ) {
        final List<String> handCardIds = new java.util.ArrayList<>();
        for (final Card card : cards) {
            handCardIds.add(SnapshotExtractor.javaCardId(card));
        }
        if ("mulligan".equals(kind)) {
            publishAgentPrompt("player-" + playerId, null, new MulliganInput(handCardIds, count));
        } else {
            publishAgentPrompt("player-" + playerId, null,
                    new MulliganPutBackInput(handCardIds, richCards(cards, false), count));
        }
    }

    private void publishAttackersPrompt(
            final int playerId,
            final Combat combat,
            final List<Card> availableAttackers
    ) {
        final List<AttackerOptionDto> attackers = new java.util.ArrayList<>();
        for (final Card a : availableAttackers) {
            final List<String> validTargetIds = new java.util.ArrayList<>();
            for (final GameEntity d : CombatChoiceSpace.legalDefendersForAttacker(a, combat)) {
                validTargetIds.add(defenderId(d));
            }
            final boolean mustAttack =
                    a.isGoaded() || !StaticAbilityMustAttack.entitiesMustAttack(a).isEmpty();
            attackers.add(new AttackerOptionDto(
                    SnapshotExtractor.javaCardId(a), validTargetIds, mustAttack));
        }
        final List<AttackTargetDto> attackTargets = new java.util.ArrayList<>();
        for (final GameEntity defender : combat.getDefenders()) {
            attackTargets.add(new AttackTargetDto(
                    defenderId(defender), defender.getName(),
                    enumFromWire(defenderKind(defender), AttackTargetKind.class)));
        }
        publishAgentPrompt("player-" + playerId, null, new ChooseAttackersInput(attackers, attackTargets));
    }

    private void publishBlockersPrompt(
            final int playerId,
            final List<Card> attackers,
            final List<Card> availableBlockers,
            final Map<Card, List<Card>> validBlockersByAttacker,
            final String error
    ) {
        final Player defendingPlayer = game.getRegisteredPlayers().get(playerId);
        final List<BlockableAttackerDto> attackerOptions = new java.util.ArrayList<>();
        for (final Card attacker : attackers) {
            final List<String> validBlockerIds = new java.util.ArrayList<>();
            for (final Card blocker : validBlockersByAttacker.getOrDefault(attacker, java.util.Collections.emptyList())) {
                validBlockerIds.add(SnapshotExtractor.javaCardId(blocker));
            }
            final int rawMax = StaticAbilityCantAttackBlock.getMinMaxBlocker(attacker, defendingPlayer).getRight();
            final boolean mustBeBlocked =
                    attacker.hasStartOfKeyword("All creatures able to block CARDNAME do so.")
                            || attacker.hasStartOfKeyword("CARDNAME must be blocked");
            attackerOptions.add(new BlockableAttackerDto(
                    SnapshotExtractor.javaCardId(attacker), validBlockerIds,
                    CombatUtil.getMinNumBlockersForAttacker(attacker, defendingPlayer),
                    rawMax < Integer.MAX_VALUE ? rawMax : null, mustBeBlocked));
        }
        final List<String> availableBlockerIds = new java.util.ArrayList<>();
        for (final Card blocker : availableBlockers) {
            availableBlockerIds.add(SnapshotExtractor.javaCardId(blocker));
        }
        publishAgentPrompt("player-" + playerId, null,
                new ChooseBlockersInput(attackerOptions, availableBlockerIds, error));
    }

    private void publishDamageAssignmentOrderPrompt(
            final int playerId,
            final Card attacker,
            final List<Card> blockers
    ) {
        final List<String> blockerIds = new java.util.ArrayList<>();
        for (final Card blocker : blockers) {
            blockerIds.add(SnapshotExtractor.javaCardId(blocker));
        }
        publishAgentPrompt(
                "player-" + playerId,
                attacker != null ? SnapshotExtractor.javaCardId(attacker) : null,
                new ChooseDamageAssignmentOrderInput(
                        attacker != null ? SnapshotExtractor.javaCardId(attacker) : "",
                        blockerIds, richCards(blockers, false)));
    }

    private void publishCombatDamageAssignmentPrompt(
            final int playerId,
            final Card attacker,
            final List<Card> blockers,
            final int damageDealt,
            final GameEntity defender,
            final boolean defenderAssignable,
            final boolean maySkip
    ) {
        final List<String> blockerIds = new java.util.ArrayList<>();
        for (final Card blocker : blockers) {
            blockerIds.add(SnapshotExtractor.javaCardId(blocker));
        }
        publishAgentPrompt("player-" + playerId, null, new ChooseCombatDamageAssignmentInput(
                attacker != null ? SnapshotExtractor.javaCardId(attacker) : "",
                blockerIds,
                defender != null && defenderAssignable ? defenderId(defender) : null,
                damageDealt,
                attacker != null && attacker.hasKeyword("Deathtouch")));
    }

    private void publishTargetPrompt(
            final int playerId,
            final SpellAbility ability,
            final List<Pair<GameEntity, forge.game.GameObject>> candidates,
            final boolean mandatory
    ) {
        final String promptKind = targetPromptKind(candidates);
        final Card source = ability == null ? null : ability.getHostCard();
        final String api = ability != null && ability.getApi() != null ? ability.getApi().name() : null;
        final String destination = ability != null && ability.hasParam("Destination")
                ? ability.getParam("Destination") : null;
        final String counterType = ability != null && ability.hasParam("CounterType")
                ? ability.getParam("CounterType") : null;
        final String origin = "choose_target_card".equals(promptKind) ? targetPromptZone(candidates) : null;
        final String intent = intentFromApi(api, destination, counterType, origin);

        final List<TargetRef> candidateRefs = new java.util.ArrayList<>();
        if ("choose_target_any".equals(promptKind)) {
            for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
                if ("player".equals(targetKind(candidate))) {
                    candidateRefs.add(targetRef("player", targetId(candidate)));
                }
            }
            for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
                if ("card".equals(targetKind(candidate))) {
                    candidateRefs.add(targetRef("card", targetId(candidate)));
                }
            }
        } else {
            for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
                candidateRefs.add(targetRef(targetKind(candidate), targetId(candidate)));
            }
        }

        publishAgentPrompt(
                "player-" + playerId,
                source == null ? null : SnapshotExtractor.javaCardId(source),
                new ChooseBoardTargetsInput(
                        candidateRefs, isHostileIntent(intent),
                        enumFromWire(intent, TargetingIntent.class),
                        ability != null ? ability.getMinTargets() : 0,
                        ability != null ? ability.getMaxTargets() : 0,
                        ability != null ? ability.getTargets().size() : 0,
                        intentLabel(intent)));
    }

    private static TargetRef targetRef(final String kind, final String id) {
        switch (kind) {
            case "player": return new TargetRef(TargetKind.PLAYER, id, null, null);
            case "card": return new TargetRef(TargetKind.CARD, id, null, null);
            case "spell": return new TargetRef(TargetKind.SPELL, id, null, null);
            default: throw new IllegalArgumentException("unknown target kind: " + kind);
        }
    }

    private String targetPromptKind(final List<Pair<GameEntity, forge.game.GameObject>> candidates) {
        boolean hasPlayers = false;
        boolean hasCards = false;
        boolean hasSpells = false;
        for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
            final String kind = targetKind(candidate);
            hasPlayers = hasPlayers || "player".equals(kind);
            hasCards = hasCards || "card".equals(kind);
            hasSpells = hasSpells || "spell".equals(kind);
        }
        if (hasSpells && !hasPlayers && !hasCards) {
            return "choose_target_spell";
        }
        if (hasPlayers && !hasCards && !hasSpells) {
            return "choose_target_player";
        }
        if (hasCards && !hasPlayers && !hasSpells) {
            return "choose_target_card";
        }
        return "choose_target_any";
    }

    private String targetPromptZone(final List<Pair<GameEntity, forge.game.GameObject>> candidates) {
        ZoneType shared = null;
        boolean hasCard = false;
        for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
            if (!"card".equals(targetKind(candidate))) {
                continue;
            }
            final Card card = targetCard(candidate);
            if (card == null || card.getZone() == null) {
                return null;
            }
            final ZoneType zone = card.getZone().getZoneType();
            if (zone == ZoneType.Battlefield) {
                return null;
            }
            if (shared != null && shared != zone) {
                return null;
            }
            shared = zone;
            hasCard = true;
        }
        return hasCard && shared != null ? shared.name() : null;
    }

    private Card targetCard(final Pair<GameEntity, forge.game.GameObject> candidate) {
        if (candidate.getRight() instanceof Card) {
            return (Card) candidate.getRight();
        }
        if (candidate.getLeft() instanceof Card) {
            return (Card) candidate.getLeft();
        }
        return null;
    }

    private String targetKind(final Pair<GameEntity, forge.game.GameObject> candidate) {
        if (candidate.getRight() instanceof SpellAbility) {
            return "spell";
        }
        if (candidate.getRight() instanceof Player) {
            return "player";
        }
        if (candidate.getRight() instanceof Card) {
            return "card";
        }
        if (candidate.getLeft() instanceof Player) {
            return "player";
        }
        return "card";
    }

    private String targetId(final Pair<GameEntity, forge.game.GameObject> candidate) {
        if (candidate.getRight() instanceof SpellAbility) {
            final String stackId = stackItemId((SpellAbility) candidate.getRight());
            if (stackId != null) {
                return stackId;
            }
            return "engine-stack-ability-" + ((SpellAbility) candidate.getRight()).getId();
        }
        if (candidate.getRight() instanceof Player) {
            return "player-" + SnapshotExtractor.playerIndex(game, (Player) candidate.getRight());
        }
        if (candidate.getRight() instanceof Card) {
            return SnapshotExtractor.javaCardId((Card) candidate.getRight());
        }
        if (candidate.getLeft() instanceof Player) {
            return "player-" + SnapshotExtractor.playerIndex(game, (Player) candidate.getLeft());
        }
        if (candidate.getLeft() instanceof Card) {
            return SnapshotExtractor.javaCardId((Card) candidate.getLeft());
        }
        return "";
    }

    private String stackItemId(final SpellAbility ability) {
        for (final forge.game.spellability.SpellAbilityStackInstance item : game.getStack()) {
            if (item.getSpellAbility() == ability || item.getSpellAbility().getId() == ability.getId()) {
                return InteractiveSnapshotExtractor.stackItemId(item);
            }
        }
        return null;
    }

    private String defenderId(final GameEntity defender) {
        if (defender instanceof Player) {
            return "player-" + SnapshotExtractor.playerIndex(game, (Player) defender);
        }
        // A planeswalker / battle defender publishes its card id so it matches the
        // sprite the UI targets (mirrors the Rust host, which keys permanent
        // defenders by card id). Both the prompt emit and findDefenderByPublishedId
        // route through here, so the response round-trip stays consistent.
        if (defender instanceof Card) {
            return SnapshotExtractor.javaCardId((Card) defender);
        }
        return "defender-" + defender.getId();
    }

    private String defenderKind(final GameEntity defender) {
        if (defender instanceof Player) {
            return "player";
        }
        if (defender instanceof Card) {
            final Card c = (Card) defender;
            if (c.isBattle()) {
                return "battle";
            }
            if (c.isPlaneswalker()) {
                return "planeswalker";
            }
        }
        return "planeswalker";
    }

    private GameEntity findDefenderByPublishedId(final Combat combat, final String id) {
        for (final GameEntity defender : combat.getDefenders()) {
            if (defenderId(defender).equals(id)) {
                return defender;
            }
        }
        return null;
    }

    private static Card findCardByPublishedId(final List<Card> cards, final String cardId) {
        final int parityId = parseJavaCardParityId(cardId);
        if (parityId >= 0) {
            for (final Card card : cards) {
                if (ParityCardMap.parityId(card) == parityId) {
                    return card;
                }
            }
        }
        final int index = parseJavaCardIndex(cardId);
        if (index >= 0 && index < cards.size()) {
            return cards.get(index);
        }
        return null;
    }

    private static int parseJavaCardParityId(final String cardId) {
        final String prefix = cardId.startsWith("engine-card-") ? "engine-card-" : "java-card-";
        if (!cardId.startsWith(prefix)) {
            return -1;
        }
        final String suffix = cardId.substring(prefix.length());
        if (suffix.contains("-")) {
            return -1;
        }
        try {
            return Integer.parseInt(suffix);
        } catch (NumberFormatException error) {
            return -1;
        }
    }

    private static int parseJavaCardIndex(final String cardId) {
        final int marker = cardId.lastIndexOf("-hand-");
        if (marker < 0) {
            return -1;
        }
        try {
            return Integer.parseInt(cardId.substring(marker + "-hand-".length()));
        } catch (NumberFormatException error) {
            return -1;
        }
    }

    private void publishAgentPrompt(final String decidingPlayerId, final String sourceCardId, final JsonObject input) {
        promptedPlayerIndex = parsePlayerSlot(decidingPlayerId);
        latestPromptJson = ManabrewProtocolAdapter.agentPrompt(++promptSeq, decidingPlayerId, sourceCardId, input);
    }

    private static int parsePlayerSlot(final String decidingPlayerId) {
        if (decidingPlayerId == null || !decidingPlayerId.startsWith("player-")) {
            return -1;
        }
        try {
            return Integer.parseInt(decidingPlayerId.substring("player-".length()));
        } catch (NumberFormatException invalid) {
            return -1;
        }
    }

    private static final com.google.gson.Gson GSON = new com.google.gson.Gson();

    private void publishAgentPrompt(final String decidingPlayerId, final String sourceCardId, final Object typedInput) {
        publishAgentPrompt(decidingPlayerId, sourceCardId, GSON.toJsonTree(typedInput).getAsJsonObject());
    }

    private static <T> T enumFromWire(final String wire, final Class<T> type) {
        return wire == null ? null : GSON.fromJson("\"" + wire + "\"", type);
    }

    private List<CardDto> richCards(final List<Card> cards, final boolean castable) {
        final List<CardDto> out = new java.util.ArrayList<>();
        for (final Card card : cards) {
            out.add(InteractiveSnapshotExtractor.cardDto(game, card, castable));
        }
        return out;
    }

    private static PromptPresentation presentation(
            final String title, final String description, final String sourceCardId) {
        return new PromptPresentation(title, description, null, sourceCardId, java.util.List.of());
    }

    private static String formatActionLabel(final String label) {
        final String normalized = stripActionSuffix(label);
        final int colon = normalized.indexOf(':');
        if (colon < 0) {
            return normalized;
        }
        final String kind = normalized.substring(0, colon);
        final String rest = normalized.substring(colon + 1);
        final int hash = rest.indexOf('#');
        final String cardName = hash < 0 ? rest : rest.substring(0, hash);
        final String altCost = hash < 0 ? null : rest.substring(hash + 1);
        final int bar = cardName.indexOf('|');
        final String displayName = bar < 0 ? cardName : cardName.substring(bar + 1);
        final String altSuffix = altCost == null ? "" : " (" + altCost + ")";
        switch (kind) {
            case "LAND": return "Play " + displayName + altSuffix;
            case "SPELL": return "Cast " + displayName + altSuffix;
            case "CYCLE": return "Cycle " + displayName + altSuffix;
            case "MANA": return "Activate mana: " + displayName + altSuffix;
            case "AB": return "Activate " + displayName + altSuffix;
            default: return normalized;
        }
    }

    private static String stripActionSuffix(final String label) {
        final int at = label.indexOf('@');
        final String noAt = at < 0 ? label : label.substring(0, at);
        final int dollar = noAt.indexOf('$');
        return dollar < 0 ? noAt : noAt.substring(0, dollar);
    }

    private static final class ManaChoice {
        private final String color;
        private final java.util.List<Mana> producedMana;

        private ManaChoice(final String color, final java.util.List<Mana> producedMana) {
            this.color = color;
            this.producedMana = producedMana;
        }
    }

    private static final String[] ANY_COLOR_LETTERS = {"W", "U", "B", "R", "G"};

    private static List<ManaChoice> splitManaChoices(final String rawProducedMana, final Integer producedManaAmount) {
        final List<ManaChoice> out = new ArrayList<>();
        if (rawProducedMana == null) {
            out.add(new ManaChoice(null, null));
            return out;
        }
        final List<String> tokens = producedManaTokens(rawProducedMana);
        if (tokens.isEmpty()) {
            out.add(new ManaChoice(null, null));
            return out;
        }
        final boolean isCombo = tokens.contains("COMBO");
        final List<String> manaTokens = new ArrayList<>();
        for (final String token : tokens) {
            if (!"COMBO".equals(token)) {
                manaTokens.add(token);
            }
        }
        final boolean isAny = manaTokens.contains("ANY");
        final int amount = Math.max(producedManaAmount == null ? 1 : producedManaAmount, 1);
        if (isAny && !isCombo) {
            return choicesForLetters(java.util.Arrays.asList(ANY_COLOR_LETTERS), amount);
        }
        if (isCombo) {
            if (amount > 1) {
                out.add(new ManaChoice(null, null));
                return out;
            }
            if (isAny) {
                return choicesForLetters(java.util.Arrays.asList(ANY_COLOR_LETTERS), amount);
            }
            final List<String> letters = uniqueManaLetters(manaTokens);
            if (!letters.isEmpty()) {
                return choicesForLetters(letters, amount);
            }
        }
        final List<String> letters = manaTokensToLetters(manaTokens);
        if (letters != null) {
            out.add(new ManaChoice(null, lettersToMana(letters, amount)));
            return out;
        }
        out.add(new ManaChoice(null, null));
        return out;
    }

    private static List<ManaChoice> choicesForLetters(final List<String> letters, final int amount) {
        final List<ManaChoice> out = new ArrayList<>();
        for (final String letter : letters) {
            out.add(new ManaChoice(letter, lettersToMana(java.util.Collections.singletonList(letter), amount)));
        }
        return out;
    }

    private static java.util.List<Mana> lettersToMana(final List<String> letters, final int amount) {
        final int amt = Math.max(amount, 1);
        final java.util.List<Mana> out = new ArrayList<>();
        for (final String letter : letters) {
            final ManaColor color = letterToColor(letter);
            if (color == null) {
                continue;
            }
            Mana existing = null;
            for (final Mana mana : out) {
                if (mana.color == color) {
                    existing = mana;
                    break;
                }
            }
            if (existing != null) {
                existing.amount += amt;
            } else {
                out.add(new Mana(color, amt));
            }
        }
        return out;
    }

    private static ManaColor letterToColor(final String letter) {
        switch (letter) {
            case "W": return ManaColor.W;
            case "U": return ManaColor.U;
            case "B": return ManaColor.B;
            case "R": return ManaColor.R;
            case "G": return ManaColor.G;
            case "C": return ManaColor.C;
            default: return null;
        }
    }

    private static List<String> producedManaTokens(final String produced) {
        final List<String> out = new ArrayList<>();
        for (final String token : produced.split("[\\s{},/]+")) {
            final String trimmed = token.trim();
            if (!trimmed.isEmpty()) {
                out.add(trimmed.toUpperCase(java.util.Locale.ROOT));
            }
        }
        return out;
    }

    private static List<String> uniqueManaLetters(final List<String> tokens) {
        final List<String> letters = new ArrayList<>();
        for (final String token : tokens) {
            final String letter = manaTokenToLetter(token);
            if (letter != null && !letters.contains(letter)) {
                letters.add(letter);
            }
        }
        return letters;
    }

    private static List<String> manaTokensToLetters(final List<String> tokens) {
        final List<String> letters = new ArrayList<>();
        for (final String token : tokens) {
            final String letter = manaTokenToLetter(token);
            if (letter == null) {
                return null;
            }
            letters.add(letter);
        }
        return letters;
    }

    private static String manaTokenToLetter(final String token) {
        switch (token) {
            case "WHITE": case "W": return "W";
            case "BLUE": case "U": return "U";
            case "BLACK": case "B": return "B";
            case "RED": case "R": return "R";
            case "GREEN": case "G": return "G";
            case "COLORLESS": case "C": return "C";
            default: return null;
        }
    }

    private static String resolveProducedMana(final SpellAbility sa) {
        final AbilityManaPart manaPart = sa.getManaPart();
        if (manaPart == null) {
            return null;
        }
        String produced = manaPart.getOrigProduced();
        if (produced != null && produced.contains("Chosen")) {
            final String resolved = manaPart.mana(sa);
            if (resolved != null && !resolved.isEmpty() && !resolved.contains("Chosen")) {
                produced = produced.replace("Chosen", resolved);
            }
        }
        return produced != null && !produced.isEmpty() ? produced : null;
    }

    private static String simpleCostText(final SpellAbility sa) {
        final Cost cost = sa.getPayCosts();
        if (cost == null) {
            return null;
        }
        final String costText = cost.toSimpleString();
        return costText != null && !costText.isEmpty() ? costText : null;
    }

    private static String intentFromApi(
            final String api, final String destination, final String counterType, final String origin) {
        if (api == null) {
            return "hostile";
        }
        switch (api) {
            case "DealDamage": case "DamageAll": case "EachDamage": return "damage";
            case "Destroy": case "DestroyAll": return "destroy";
            case "Sacrifice": case "SacrificeAll": return "sacrifice";
            case "ChangeZone": case "ChangeZoneAll": {
                final boolean fromDead = "Graveyard".equals(origin) || "Exile".equals(origin);
                if (fromDead && ("Hand".equals(destination)
                        || "Library".equals(destination) || "Battlefield".equals(destination))) {
                    return "friendly";
                }
                if ("Exile".equals(destination)) {
                    return "exile";
                }
                if ("Hand".equals(destination) || "Library".equals(destination)) {
                    return "bounce";
                }
                if ("Graveyard".equals(destination)) {
                    return "destroy";
                }
                if ("Battlefield".equals(destination)) {
                    return "friendly";
                }
                return "hostile";
            }
            case "Mill": return "mill";
            case "Discard": return "discard";
            case "Counter": return "counter";
            case "ControlSpell": return "gainControl";
            case "Tap": case "TapAll": case "TapOrUntap": case "TapOrUntapAll": return "tap";
            case "Untap": case "UntapAll": return "untap";
            case "CopyPermanent": case "CopySpellAbility": case "Clone": return "copy";
            case "Pump": case "PumpAll": case "Animate": case "AnimateAll":
            case "Protection": case "ProtectionAll": return "buff";
            case "PutCounter": case "PutCounterAll":
                return counterType != null && (counterType.startsWith("M1M1") || counterType.contains("-1/-1"))
                        ? "debuff" : "buff";
            case "RemoveCounter": case "RemoveCounterAll": case "Debuff": return "debuff";
            case "GainLife": return "heal";
            case "LoseLife": return "loseLife";
            case "Draw": return "draw";
            case "Reveal": case "RevealHand": case "LookAt": case "PeekAndReveal": return "reveal";
            case "GainControl": case "GainControlVariant":
            case "ExchangeControl": case "ExchangeControlVariant": return "gainControl";
            case "Fight": return "fight";
            case "Attach": case "Unattach": return "attach";
            default: return "hostile";
        }
    }

    private static String intentLabel(final String intent) {
        switch (intent) {
            case "loseLife": return "LoseLife";
            case "gainControl": return "GainControl";
            default: return Character.toUpperCase(intent.charAt(0)) + intent.substring(1);
        }
    }

    private static boolean isHostileIntent(final String intent) {
        switch (intent) {
            case "damage": case "destroy": case "sacrifice": case "exile": case "bounce":
            case "mill": case "discard": case "counter": case "tap": case "debuff":
            case "loseLife": case "gainControl": case "fight": case "hostile":
                return true;
            default:
                return false;
        }
    }

    private void requireAttached() {
        if (match == null || game == null) {
            throw new IllegalStateException("session is not attached to a Forge game");
        }
    }
}
