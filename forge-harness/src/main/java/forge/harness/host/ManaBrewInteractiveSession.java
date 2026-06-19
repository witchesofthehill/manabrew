package forge.harness.host;

import forge.harness.common.ActionSpace;
import forge.harness.common.CombatChoiceSpace;
import forge.harness.common.ParityCardMap;
import forge.harness.common.ParityOrder;
import forge.harness.common.SnapshotExtractor;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
        return InteractiveSnapshotExtractor.snapshotJson(game, castingAbility);
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
        JsonObject action = JsonParser.parseString(actionJson).getAsJsonObject();
        actions.offer(action);
        // No snapshot here — it would race the game thread this unblocks.
        return "";
    }

    enum PriorityActionKind { ACTION, PASS, UNDO }

    static final class PriorityChoice {
        private final PriorityActionKind kind;
        private final SpellAbility action;
        private final String untilPhase;
        private final Card untapCard;
        private final String color;

        private PriorityChoice(final PriorityActionKind kind, final SpellAbility action, final String untilPhase) {
            this(kind, action, untilPhase, null, null);
        }

        private PriorityChoice(
                final PriorityActionKind kind,
                final SpellAbility action,
                final String untilPhase,
                final Card untapCard,
                final String color) {
            this.kind = kind;
            this.action = action;
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
                action = actions.take();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new PriorityChoice(PriorityActionKind.PASS, null, null);
            }
            final String kind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(kind) || "pass_priority".equals(kind)) {
                final String until = action.has("until") && !action.get("until").isJsonNull()
                        ? action.get("until").getAsString()
                        : null;
                return new PriorityChoice(PriorityActionKind.PASS, null, until);
            }
            if ("untap_land".equals(kind)) {
                final Card untapCard = resolveUntapCard(action, untappableCards);
                return new PriorityChoice(PriorityActionKind.UNDO, null, null, untapCard, null);
            }
            if ("choose_action".equals(kind)) {
                final int index = action.get("index").getAsInt();
                if (index < 0 || index >= actionsForPrompt.size()) {
                    throw new IllegalArgumentException("action index out of range: " + index);
                }
                return new PriorityChoice(PriorityActionKind.ACTION, actionsForPrompt.get(index), null);
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
                return new PriorityChoice(PriorityActionKind.ACTION, actionsForPrompt.get(index), null, null, color);
            }
            throw new UnsupportedOperationException("unsupported action kind: " + kind);
        }
        return new PriorityChoice(PriorityActionKind.PASS, null, null);
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
            final int poolTotal,
            final boolean canConfirm,
            final boolean canCancel,
            final boolean canPayLife,
            final int lifeToPay
    ) {
        requireAttached();
        publishManaPaymentPrompt(
                playerId, payingFor, remainingCost, tappableSources, untappableCards, convokeSources,
                delveSources, poolTotal, canConfirm, canCancel, canPayLife, lifeToPay);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = actions.take();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, null, null, false);
            }
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
        return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, null, null, false);
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
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "first_player_roll");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("sides", sides);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        final com.google.gson.JsonArray rollOptions = new com.google.gson.JsonArray();
        for (final Player p : players) {
            if (!rolls.containsKey(p)) {
                continue;
            }
            JsonObject entry = new JsonObject();
            entry.addProperty("playerId", "player-" + SnapshotExtractor.playerIndex(game, p));
            entry.addProperty("playerName", p.getName());
            entry.addProperty("value", rolls.get(p));
            rollOptions.add(entry);
        }
        prompt.add("rolls", rollOptions);
        prompt.addProperty("winnerPlayerId", "player-" + SnapshotExtractor.playerIndex(game, winner));
        latestPromptJson = prompt.toString();
    }

    private void publishManaPaymentPrompt(
            final int playerId,
            final Card payingFor,
            final String remainingCost,
            final List<SpellAbility> tappableSources,
            final List<Card> untappableCards,
            final List<Card> convokeSources,
            final List<Card> delveSources,
            final int poolTotal,
            final boolean canConfirm,
            final boolean canCancel,
            final boolean canPayLife,
            final int lifeToPay
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "pay_mana_cost");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        if (payingFor != null) {
            prompt.addProperty("cardId", SnapshotExtractor.javaCardId(payingFor));
            prompt.addProperty("cardName", InteractiveSnapshotExtractor.normalizeCardName(payingFor.getName()));
        }
        if (remainingCost != null) {
            prompt.addProperty("manaCost", remainingCost);
        }
        prompt.addProperty("manaPoolTotal", poolTotal);
        prompt.addProperty("canConfirmFromPool", canConfirm);
        prompt.addProperty("canCancel", canCancel);
        prompt.addProperty("canPayLife", canPayLife);
        prompt.addProperty("lifeToPay", lifeToPay);

        final com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        final java.util.LinkedHashSet<String> tappableIds = new java.util.LinkedHashSet<>();
        for (final SpellAbility sa : tappableSources) {
            final Card host = sa.getHostCard();
            if (host == null) {
                continue;
            }
            final String cardId = SnapshotExtractor.javaCardId(host);
            tappableIds.add(cardId);
            JsonObject option = new JsonObject();
            option.addProperty("cardId", cardId);
            option.addProperty("abilityIndex", host.getManaAbilities().indexOf(sa));
            option.addProperty("description", host.getName());
            addActivationCost(option, sa);
            addManaProductionMetadata(option, sa);
            options.add(option);
        }
        prompt.add("manaAbilityOptions", options);

        for (final Card card : convokeSources) {
            tappableIds.add(SnapshotExtractor.javaCardId(card));
        }

        final com.google.gson.JsonArray tappable = new com.google.gson.JsonArray();
        for (final String id : tappableIds) {
            tappable.add(id);
        }
        prompt.add("tappableLandIds", tappable);

        final com.google.gson.JsonArray untappable = new com.google.gson.JsonArray();
        for (final Card card : untappableCards) {
            untappable.add(SnapshotExtractor.javaCardId(card));
        }
        prompt.add("untappableLandIds", untappable);

        final com.google.gson.JsonArray delve = new com.google.gson.JsonArray();
        for (final Card card : delveSources) {
            delve.add(SnapshotExtractor.javaCardId(card));
        }
        prompt.add("delveSourceIds", delve);

        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        latestPromptJson = prompt.toString();
    }

    List<String> awaitManaCombo(
            final int playerId,
            final List<String> availableColors,
            final int amount,
            final String sourceName
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "specify_mana_combo");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("amount", amount);
        if (sourceName != null) {
            prompt.addProperty("sourceName", sourceName);
        }
        final com.google.gson.JsonArray colors = new com.google.gson.JsonArray();
        for (final String color : availableColors) {
            colors.add(color);
        }
        prompt.add("availableColors", colors);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        latestPromptJson = prompt.toString();

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
        List<Player> contenders = new ArrayList<Player>(players);
        Map<Player, Integer> rolls = new LinkedHashMap<Player, Integer>();
        Player winner;
        while (true) {
            rolls.clear();
            int highest = 0;
            for (final Player contender : contenders) {
                final int value = rng.nextInt(sides) + 1;
                rolls.put(contender, value);
                highest = Math.max(highest, value);
            }
            final List<Player> top = new ArrayList<Player>();
            for (final Player contender : contenders) {
                if (rolls.get(contender) == highest) {
                    top.add(contender);
                }
            }
            if (top.size() == 1) {
                winner = top.get(0);
                break;
            }
            contenders = top;
        }
        publishFirstPlayerRollPrompt(playerId, players, rolls, winner, sides);
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
                game.getPlayers().get(playerId).getCardsIn(forge.game.zone.ZoneType.Hand));
        publishCardChoicePrompt("mulligan", playerId, cards, 0, 0, cardsToReturn);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = actions.take();
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
                action = actions.take();
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
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_target_card");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("optional", chosen >= min);
        final Card source = sa == null ? null : sa.getHostCard();
        if (source != null) {
            prompt.addProperty("sourceCardId", SnapshotExtractor.javaCardId(source));
            prompt.addProperty("sourceCardName", source.getName());
        }
        prompt.addProperty("api", "Sacrifice");
        prompt.addProperty("minTargets", min);
        prompt.addProperty("maxTargets", max);
        prompt.addProperty("chosenTargets", chosen);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray cards = new com.google.gson.JsonArray();
        for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
            JsonObject option = new JsonObject();
            option.addProperty("id", targetId(candidate));
            option.addProperty("label", candidate.getLeft().getName());
            cards.add(option);
        }
        prompt.add("players", new com.google.gson.JsonArray());
        prompt.add("cards", cards);
        prompt.add("spells", new com.google.gson.JsonArray());
        latestPromptJson = prompt.toString();
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
        publishDividedAllocationPrompt(playerId, ability, targets, amount);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return defaultDivision(targets, amount);
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return defaultDivision(targets, amount);
            }
            if (!"divide_amount".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final JsonObject map = action.has("allocation") && action.get("allocation").isJsonObject()
                    ? action.getAsJsonObject("allocation")
                    : null;
            final Map<GameEntity, Integer> result = new LinkedHashMap<>();
            int total = 0;
            for (final GameEntity target : targets) {
                final String key = dividedTargetId(target);
                final int value = map != null && map.has(key) ? map.get(key).getAsInt() : 0;
                if (value < 1) {
                    throw new IllegalArgumentException(
                            "divided allocation must assign at least 1 to each target, got " + value + " for " + key);
                }
                result.put(target, value);
                total += value;
            }
            if (total != amount) {
                throw new IllegalArgumentException("divided allocation must total " + amount + ", got " + total);
            }
            return result;
        }
        return defaultDivision(targets, amount);
    }

    private Map<GameEntity, Integer> defaultDivision(final List<GameEntity> targets, final int amount) {
        final Map<GameEntity, Integer> result = new LinkedHashMap<>();
        int remaining = amount;
        for (final GameEntity target : targets) {
            final int give = remaining > 0 ? 1 : 0;
            result.put(target, give);
            remaining -= give;
        }
        if (!targets.isEmpty()) {
            result.merge(targets.get(0), remaining, Integer::sum);
        }
        return result;
    }

    private void publishDividedAllocationPrompt(
            final int playerId,
            final SpellAbility ability,
            final List<GameEntity> targets,
            final int amount
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "divide_amount");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("amount", amount);
        final Card source = ability == null ? null : ability.getHostCard();
        if (source != null) {
            prompt.addProperty("sourceCardId", SnapshotExtractor.javaCardId(source));
            prompt.addProperty("sourceCardName", source.getName());
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (final GameEntity target : targets) {
            JsonObject option = new JsonObject();
            option.addProperty("id", dividedTargetId(target));
            option.addProperty("label", target.getName());
            options.add(option);
        }
        prompt.add("targets", options);
        latestPromptJson = prompt.toString();
    }

    private String dividedTargetId(final GameEntity target) {
        if (target instanceof Player) {
            return "player-" + SnapshotExtractor.playerIndex(game, (Player) target);
        }
        if (target instanceof Card) {
            return SnapshotExtractor.javaCardId((Card) target);
        }
        return target.getName();
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
                action = actions.take();
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

    private JsonObject takeActionOrNull() {
        try {
            return actions.take();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    private static void addActivationCost(final JsonObject option, final SpellAbility sa) {
        final Cost cost = sa.getPayCosts();
        if (cost == null) {
            return;
        }
        final String costText = cost.toSimpleString();
        if (costText != null && !costText.isEmpty()) {
            option.addProperty("cost", costText);
        }
    }

    private static void addManaProductionMetadata(final JsonObject option, final SpellAbility sa) {
        final AbilityManaPart manaPart = sa.getManaPart();
        if (manaPart == null) {
            return;
        }
        String produced = manaPart.getOrigProduced();
        if (produced != null && produced.contains("Chosen")) {
            final String resolved = manaPart.mana(sa);
            if (resolved != null && !resolved.isEmpty() && !resolved.contains("Chosen")) {
                produced = produced.replace("Chosen", resolved);
            }
        }
        if (produced != null && !produced.isEmpty()) {
            option.addProperty("producedMana", produced);
        }
        option.addProperty("producedManaAmount", sa.amountOfManaGenerated(false));
    }

    private void publishPriorityPrompt(
            final int playerId,
            final List<SpellAbility> actionsForPrompt,
            final List<Card> untappableCards
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "priority");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        final List<String> labels = ActionSpace.buildMainActionLabels(actionsForPrompt);
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < actionsForPrompt.size(); i++) {
            final SpellAbility sa = actionsForPrompt.get(i);
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            option.addProperty("label", labels.get(i));
            // id encodes the action index so the client can echo back a
            // choose_action{index}. kind + cardId let the normalizer route the
            // option to the exact card and category without parsing the label —
            // essential for casts from graveyard/exile (flashback, escape, …).
            option.addProperty("id", "prompt-action-" + i);
            option.addProperty("kind", sa.isLandAbility() ? "land"
                    : sa.isSpell() ? "spell"
                    : sa.isManaAbility() ? "mana"
                    : "ability");
            final Card host = sa.getHostCard();
            if (host != null) {
                option.addProperty("cardId", SnapshotExtractor.javaCardId(host));
            }
            if (sa.isManaAbility() && sa.getManaPart() != null) {
                addActivationCost(option, sa);
                addManaProductionMetadata(option, sa);
            }
            options.add(option);
        }
        prompt.add("actions", options);

        final com.google.gson.JsonArray untappable = new com.google.gson.JsonArray();
        for (final Card card : untappableCards) {
            untappable.add(SnapshotExtractor.javaCardId(card));
        }
        prompt.add("untappableLandIds", untappable);

        latestPromptJson = prompt.toString();
    }

    private void addCardOption(final JsonObject option, final Card card) {
        option.addProperty("id", SnapshotExtractor.javaCardId(card));
        option.addProperty("label", card.getName());
        final forge.item.IPaperCard paper = card.getPaperCard();
        option.addProperty("setCode", paper != null ? paper.getEdition() : card.getSetCode());
        option.addProperty("cardNumber", paper != null ? paper.getCollectorNumber() : "");
        if (card.getOwner() != null) {
            option.addProperty("owner", SnapshotExtractor.playerIndex(game, card.getOwner()));
        }
    }

    private void publishCardChoicePrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final int min,
            final int max
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("min", min);
        prompt.addProperty("max", max);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            addCardOption(option, cards.get(i));
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
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
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("min", min);
        prompt.addProperty("max", max);
        prompt.addProperty("optional", optionalDecline);
        if (error != null) {
            prompt.addProperty("error", error);
        }
        if (sourceCardId != null) {
            prompt.addProperty("sourceCardId", sourceCardId);
        }
        if (sourceName != null) {
            prompt.addProperty("sourceCardName", sourceName);
        }
        if (description != null) {
            prompt.addProperty("description", description);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            addCardOption(option, cards.get(i));
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
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
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("min", min);
        prompt.addProperty("max", max);
        if (sourceName != null) {
            prompt.addProperty("sourceCardName", sourceName);
        }
        if (description != null) {
            prompt.addProperty("description", description);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray optionValues = new com.google.gson.JsonArray();
        for (final String option : options) {
            optionValues.add(option);
        }
        prompt.add("options", optionValues);
        latestPromptJson = prompt.toString();
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
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("description", description);
        prompt.addProperty("promptKind", promptKind);
        if (sourceName != null) {
            prompt.addProperty("sourceCardId", sourceName);
        }
        if (mode != null) {
            prompt.addProperty("mode", mode);
        }
        if (api != null) {
            prompt.addProperty("api", api);
        }
        if (effectText != null && !effectText.isEmpty()) {
            prompt.addProperty("effectText", effectText);
        }
        if ((targetCards != null && !targetCards.isEmpty())
                || (targetPlayers != null && !targetPlayers.isEmpty())) {
            com.google.gson.JsonArray targets = new com.google.gson.JsonArray();
            if (targetCards != null) {
                for (final Card card : targetCards) {
                    JsonObject target = new JsonObject();
                    target.addProperty("kind", "card");
                    target.addProperty("id", SnapshotExtractor.javaCardId(card));
                    targets.add(target);
                }
            }
            if (targetPlayers != null) {
                for (final Player target : targetPlayers) {
                    JsonObject entry = new JsonObject();
                    entry.addProperty("kind", "player");
                    entry.addProperty("id", "player-" + SnapshotExtractor.playerIndex(game, target));
                    targets.add(entry);
                }
            }
            prompt.add("targets", targets);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray labels = new com.google.gson.JsonArray();
        if (optionLabels != null && optionLabels.size() == 2) {
            labels.add(optionLabels.get(1));
            labels.add(optionLabels.get(0));
        } else {
            labels.add("Decline");
            labels.add("Accept");
        }
        prompt.add("optionLabels", labels);
        latestPromptJson = prompt.toString();
    }

    private void publishRevealCardsPrompt(
            final int playerId,
            final List<Card> cards,
            final ZoneType zone,
            final Player owner,
            final String messagePrefix
    ) {
        JsonObject prompt = baseRevealPrompt(playerId, zone == null ? null : zone.toString(), messagePrefix);
        if (owner != null) {
            prompt.addProperty("ownerPlayerId", "player-" + SnapshotExtractor.playerIndex(game, owner));
        }
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            addCardOption(option, cards.get(i));
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
    }

    private void publishRevealCardViewsPrompt(
            final int playerId,
            final List<CardView> cards,
            final ZoneType zone,
            final PlayerView owner,
            final String messagePrefix
    ) {
        JsonObject prompt = baseRevealPrompt(playerId, zone == null ? null : zone.toString(), messagePrefix);
        if (owner != null) {
            prompt.addProperty("ownerPlayerId", "player-view-" + owner.getId());
        }
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            final CardView card = cards.get(i);
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            final Card real = game.findById(card.getId());
            if (real != null) {
                addCardOption(option, real);
            } else {
                option.addProperty("id", "java-card-view-" + card.getId());
                option.addProperty("label", card.getName());
            }
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
    }

    private JsonObject baseRevealPrompt(final int playerId, final String zone, final String messagePrefix) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "reveal_cards");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("zone", zone == null ? "unknown" : zone);
        prompt.addProperty("message", messagePrefix == null ? "Look at these cards" : messagePrefix);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        return prompt;
    }

    private void publishNumberPrompt(
            final int playerId,
            final int min,
            final int max,
            final String sourceCardId,
            final String description,
            final boolean canCancel
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_number");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("min", min);
        prompt.addProperty("max", max);
        prompt.addProperty("canCancel", canCancel);
        if (sourceCardId != null) {
            prompt.addProperty("sourceCardId", sourceCardId);
        }
        if (description != null) {
            prompt.addProperty("description", description);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        latestPromptJson = prompt.toString();
    }

    private void publishReorderZonePrompt(
            final int playerId,
            final List<Card> cards,
            final ZoneType destination,
            final boolean topOfDeck,
            final String sourceName,
            final String sourceCardId
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "reorder_library");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("destination", destination.name());
        prompt.addProperty("topOfDeck", topOfDeck);
        if (sourceName != null) {
            prompt.addProperty("sourceCardName", sourceName);
        }
        if (sourceCardId != null) {
            prompt.addProperty("sourceCardId", sourceCardId);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            addCardOption(option, cards.get(i));
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
    }

    private void publishLibraryPrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final String sourceName
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        if (sourceName != null) {
            prompt.addProperty("sourceCardName", sourceName);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            addCardOption(option, cards.get(i));
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
    }

    private void publishCardChoicePrompt(
            final String kind,
            final int playerId,
            final List<Card> cards,
            final int min,
            final int max,
            final int count
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("min", min);
        prompt.addProperty("max", max);
        prompt.addProperty("count", count);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray options = new com.google.gson.JsonArray();
        for (int i = 0; i < cards.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            addCardOption(option, cards.get(i));
            options.add(option);
        }
        prompt.add("cards", options);
        latestPromptJson = prompt.toString();
    }

    private void publishAttackersPrompt(
            final int playerId,
            final Combat combat,
            final List<Card> availableAttackers
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_attackers");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray attackers = new com.google.gson.JsonArray();
        for (int i = 0; i < availableAttackers.size(); i++) {
            final Card a = availableAttackers.get(i);
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            option.addProperty("id", SnapshotExtractor.javaCardId(a));
            option.addProperty("label", a.getName());
            com.google.gson.JsonArray validTargetIds = new com.google.gson.JsonArray();
            for (final GameEntity d : CombatChoiceSpace.legalDefendersForAttacker(a, combat)) {
                validTargetIds.add(defenderId(d));
            }
            option.add("validTargetIds", validTargetIds);
            attackers.add(option);
        }
        prompt.add("attackers", attackers);

        com.google.gson.JsonArray defenders = new com.google.gson.JsonArray();
        for (final GameEntity defender : combat.getDefenders()) {
            JsonObject option = new JsonObject();
            option.addProperty("id", defenderId(defender));
            option.addProperty("label", defender.getName());
            option.addProperty("kind", defenderKind(defender));
            defenders.add(option);
        }
        prompt.add("defenders", defenders);
        latestPromptJson = prompt.toString();
    }

    private void publishBlockersPrompt(
            final int playerId,
            final List<Card> attackers,
            final List<Card> availableBlockers,
            final Map<Card, List<Card>> validBlockersByAttacker,
            final String error
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_blockers");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        if (error != null) {
            prompt.addProperty("error", error);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        final Player defendingPlayer = game.getPlayers().get(playerId);
        com.google.gson.JsonArray attackerOptions = new com.google.gson.JsonArray();
        for (int i = 0; i < attackers.size(); i++) {
            final Card attacker = attackers.get(i);
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            option.addProperty("id", SnapshotExtractor.javaCardId(attacker));
            option.addProperty("label", attacker.getName());
            com.google.gson.JsonArray validBlockerIds = new com.google.gson.JsonArray();
            for (final Card blocker : validBlockersByAttacker.getOrDefault(attacker, java.util.Collections.emptyList())) {
                validBlockerIds.add(SnapshotExtractor.javaCardId(blocker));
            }
            option.add("validBlockerIds", validBlockerIds);
            option.addProperty("minBlockers", CombatUtil.getMinNumBlockersForAttacker(attacker, defendingPlayer));
            final int maxBlockers =
                    StaticAbilityCantAttackBlock.getMinMaxBlocker(attacker, defendingPlayer).getRight();
            if (maxBlockers < Integer.MAX_VALUE) {
                option.addProperty("maxBlockers", maxBlockers);
            }
            attackerOptions.add(option);
        }
        prompt.add("attackers", attackerOptions);

        com.google.gson.JsonArray blockerOptions = new com.google.gson.JsonArray();
        for (int i = 0; i < availableBlockers.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            option.addProperty("id", SnapshotExtractor.javaCardId(availableBlockers.get(i)));
            option.addProperty("label", availableBlockers.get(i).getName());
            blockerOptions.add(option);
        }
        prompt.add("blockers", blockerOptions);
        latestPromptJson = prompt.toString();
    }

    private void publishDamageAssignmentOrderPrompt(
            final int playerId,
            final Card attacker,
            final List<Card> blockers
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_damage_assignment_order");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        if (attacker != null) {
            prompt.addProperty("attackerId", SnapshotExtractor.javaCardId(attacker));
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray blockerOptions = new com.google.gson.JsonArray();
        for (int i = 0; i < blockers.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            option.addProperty("id", SnapshotExtractor.javaCardId(blockers.get(i)));
            option.addProperty("label", blockers.get(i).getName());
            blockerOptions.add(option);
        }
        prompt.add("blockers", blockerOptions);
        latestPromptJson = prompt.toString();
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
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_combat_damage_assignment");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("maySkip", maySkip);
        if (attacker != null) {
            prompt.addProperty("attackerId", SnapshotExtractor.javaCardId(attacker));
            prompt.addProperty("attackerHasDeathtouch", attacker.hasKeyword("Deathtouch"));
        } else {
            prompt.addProperty("attackerHasDeathtouch", false);
        }
        if (defender != null && defenderAssignable) {
            prompt.addProperty("defenderId", defenderId(defender));
        }
        prompt.addProperty("totalDamage", damageDealt);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray blockerOptions = new com.google.gson.JsonArray();
        for (int i = 0; i < blockers.size(); i++) {
            JsonObject option = new JsonObject();
            option.addProperty("index", i);
            option.addProperty("id", SnapshotExtractor.javaCardId(blockers.get(i)));
            option.addProperty("label", blockers.get(i).getName());
            blockerOptions.add(option);
        }
        prompt.add("blockers", blockerOptions);
        latestPromptJson = prompt.toString();
    }

    private void publishTargetPrompt(
            final int playerId,
            final SpellAbility ability,
            final List<Pair<GameEntity, forge.game.GameObject>> candidates,
            final boolean mandatory
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", targetPromptKind(candidates));
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("optional", !mandatory);
        final Card source = ability == null ? null : ability.getHostCard();
        if (source != null) {
            prompt.addProperty("sourceCardId", SnapshotExtractor.javaCardId(source));
            prompt.addProperty("sourceCardName", source.getName());
        }
        if (ability != null && ability.getApi() != null) {
            prompt.addProperty("api", ability.getApi().name());
            if (ability.hasParam("Destination")) {
                prompt.addProperty("destination", ability.getParam("Destination"));
            }
            if (ability.hasParam("CounterType")) {
                prompt.addProperty("counterType", ability.getParam("CounterType"));
            }
        }
        final String zone = targetPromptZone(candidates);
        if (zone != null) {
            prompt.addProperty("zone", zone);
        }
        if (ability != null) {
            prompt.addProperty("minTargets", ability.getMinTargets());
            prompt.addProperty("maxTargets", ability.getMaxTargets());
            prompt.addProperty("chosenTargets", ability.getTargets().size());
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));

        com.google.gson.JsonArray players = new com.google.gson.JsonArray();
        com.google.gson.JsonArray cards = new com.google.gson.JsonArray();
        com.google.gson.JsonArray spells = new com.google.gson.JsonArray();
        for (final Pair<GameEntity, forge.game.GameObject> candidate : candidates) {
            final String kind = targetKind(candidate);
            JsonObject option = new JsonObject();
            option.addProperty("id", targetId(candidate));
            option.addProperty("label", candidate.getLeft().getName());
            if ("player".equals(kind)) {
                players.add(option);
            } else if ("card".equals(kind)) {
                cards.add(option);
            } else if ("spell".equals(kind)) {
                spells.add(option);
            }
        }
        prompt.add("players", players);
        prompt.add("cards", cards);
        prompt.add("spells", spells);
        latestPromptJson = prompt.toString();
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

    private void requireAttached() {
        if (match == null || game == null) {
            throw new IllegalStateException("session is not attached to a Forge game");
        }
    }
}
