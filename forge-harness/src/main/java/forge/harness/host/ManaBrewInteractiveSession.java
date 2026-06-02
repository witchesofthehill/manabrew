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
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Random;
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

        private PriorityChoice(final PriorityActionKind kind, final SpellAbility action, final String untilPhase) {
            this.kind = kind;
            this.action = action;
            this.untilPhase = untilPhase;
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
                return new PriorityChoice(PriorityActionKind.UNDO, null, null);
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
                return new PriorityChoice(PriorityActionKind.ACTION, actionsForPrompt.get(index), null);
            }
            throw new UnsupportedOperationException("unsupported action kind: " + kind);
        }
        return new PriorityChoice(PriorityActionKind.PASS, null, null);
    }

    enum ManaPaymentKind { TAP, UNTAP, PAY, CANCEL }

    static final class ManaPaymentChoice {
        private final ManaPaymentKind kind;
        private final SpellAbility tapAbility;
        private final String color;
        private final Card untapCard;
        private final boolean auto;

        private ManaPaymentChoice(
                final ManaPaymentKind kind,
                final SpellAbility tapAbility,
                final String color,
                final Card untapCard,
                final boolean auto
        ) {
            this.kind = kind;
            this.tapAbility = tapAbility;
            this.color = color;
            this.untapCard = untapCard;
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
            final int poolTotal,
            final boolean canConfirm
    ) {
        requireAttached();
        publishManaPaymentPrompt(playerId, payingFor, remainingCost, tappableSources, untappableCards, poolTotal, canConfirm);
        while (!closed && !game.isGameOver()) {
            final JsonObject action;
            try {
                action = actions.take();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, false);
            }
            final String kind = action.has("kind") ? action.get("kind").getAsString() : "";
            switch (kind) {
                case "tap_land": {
                    final SpellAbility chosen = resolveTapSource(action, tappableSources);
                    if (chosen == null) {
                        throw new IllegalArgumentException("tap_land did not match a tappable source");
                    }
                    final String color = action.has("color") && !action.get("color").isJsonNull()
                            ? action.get("color").getAsString()
                            : null;
                    return new ManaPaymentChoice(ManaPaymentKind.TAP, chosen, color, null, false);
                }
                case "untap_land": {
                    final Card card = resolveUntapCard(action, untappableCards);
                    return new ManaPaymentChoice(ManaPaymentKind.UNTAP, null, null, card, false);
                }
                case "pay_mana": {
                    final boolean auto = action.has("auto") && action.get("auto").getAsBoolean();
                    return new ManaPaymentChoice(ManaPaymentKind.PAY, null, null, null, auto);
                }
                case "cancel_mana":
                case "pass":
                case "pass_priority":
                    return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, false);
                default:
                    throw new UnsupportedOperationException("unsupported mana-payment action kind: " + kind);
            }
        }
        return new ManaPaymentChoice(ManaPaymentKind.CANCEL, null, null, null, false);
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
            final int poolTotal,
            final boolean canConfirm
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
            if (sa.getManaPart() != null) {
                option.addProperty("cost", sa.getManaPart().mana(sa));
            }
            options.add(option);
        }
        prompt.add("manaAbilityOptions", options);

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

        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        latestPromptJson = prompt.toString();
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
        publishCardChoicePrompt("mulligan_put_back", playerId, cards, count, count, count);
        return awaitCardsFromPublishedPrompt(cards, count, count);
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
            final Map<Card, List<Card>> validBlockersByAttacker
    ) {
        requireAttached();
        publishBlockersPrompt(playerId, attackers, availableBlockers, validBlockersByAttacker);
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
        publishCardChoicePrompt(kind, playerId, cards, min, max);
        return awaitCardsFromPublishedPrompt(cards, min, max);
    }

    CardCollection awaitCardChoice(
            final String kind,
            final int playerId,
            final CardCollectionView validCards,
            final int min,
            final int max,
            final String sourceName,
            final String description
    ) {
        requireAttached();
        final List<Card> cards = ParityOrder.sortCardsByNameThenId(new ArrayList<Card>(validCards));
        publishCardChoicePrompt(kind, playerId, cards, min, max, sourceName, description);
        return awaitCardsFromPublishedPrompt(cards, min, max);
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
        requireAttached();
        publishOptionPrompt("choose_mode", playerId, options, min, max, sourceName, null);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new ArrayList<>();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new ArrayList<>();
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
            return selected;
        }
        return new ArrayList<>();
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
        requireAttached();
        publishBooleanPrompt(kind, playerId, description, sourceName, promptKind, mode, api);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return false;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return false;
            }
            if (!"boolean_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            return action.has("accept") && action.get("accept").getAsBoolean();
        }
        return false;
    }

    int awaitNumberChoice(
            final int playerId,
            final int min,
            final int max,
            final String sourceName,
            final String description
    ) {
        requireAttached();
        if (min >= max) {
            return min;
        }
        publishNumberPrompt(playerId, min, max, sourceName, description);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return min;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return min;
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
            return action.has("value") ? action.get("value").getAsString() : "";
        }
        return options.isEmpty() ? "" : options.get(0);
    }

    CardCollection awaitCardIdListChoice(
            final String promptKind,
            final String responseKind,
            final String responseField,
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
                return new CardCollection();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new CardCollection();
            }
            if (!responseKind.equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection selected = new CardCollection();
            if (action.has(responseField) && action.get(responseField).isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray(responseField)) {
                    final Card card = findCardByPublishedId(cards, element.getAsString());
                    if (card != null && !selected.contains(card)) {
                        selected.add(card);
                    }
                }
            }
            return selected;
        }
        return new CardCollection();
    }

    CardCollection awaitDigChoice(
            final int playerId,
            final CardCollectionView cardsForPrompt,
            final int max,
            final boolean optional,
            final String sourceName
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(cardsForPrompt);
        publishDigPrompt(playerId, cards, max, optional, sourceName);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return new CardCollection();
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
                return new CardCollection();
            }
            if (!"dig_decision".equals(actionKind)) {
                throw new UnsupportedOperationException("unsupported action kind: " + actionKind);
            }
            final CardCollection selected = new CardCollection();
            if (action.has("chosen_card_ids") && action.get("chosen_card_ids").isJsonArray()) {
                for (JsonElement element : action.getAsJsonArray("chosen_card_ids")) {
                    final Card card = findCardByPublishedId(cards, element.getAsString());
                    if (card != null && !selected.contains(card)) {
                        selected.add(card);
                    }
                }
            }
            return selected;
        }
        return new CardCollection();
    }

    CardCollection awaitReorderLibrary(
            final int playerId,
            final CardCollectionView cardsForPrompt,
            final String sourceName
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(cardsForPrompt);
        publishLibraryPrompt("reorder_library", playerId, cards, sourceName);
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
            final GameEntity defender
    ) {
        requireAttached();
        final List<Card> cards = new ArrayList<Card>(blockers);
        publishCombatDamageAssignmentPrompt(playerId, attacker, cards, damageDealt, defender);
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
                        selected.put(null, damage);
                        continue;
                    }
                    final Card card = findCardByPublishedId(cards, assigneeId);
                    if (card != null) {
                        selected.put(card, selected.getOrDefault(card, 0) + damage);
                    }
                }
            }
            return selected;
        }
        return new LinkedHashMap<Card, Integer>();
    }

    Pair<GameEntity, forge.game.GameObject> awaitTargetChoice(
            final int playerId,
            final SpellAbility ability,
            final List<Pair<GameEntity, forge.game.GameObject>> candidates
    ) {
        requireAttached();
        publishTargetPrompt(playerId, ability, candidates);
        while (!closed && !game.isGameOver()) {
            final JsonObject action = takeActionOrNull();
            if (action == null) {
                return null;
            }
            final String actionKind = action.has("kind") ? action.get("kind").getAsString() : "";
            if ("pass".equals(actionKind) || "pass_priority".equals(actionKind)) {
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

    Map<GameEntity, Integer> awaitDividedAllocation(
            final int playerId,
            final SpellAbility ability,
            final List<GameEntity> targets,
            final int amount
    ) {
        requireAttached();
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
            final String api
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", kind);
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("description", description);
        prompt.addProperty("promptKind", promptKind);
        if (sourceName != null) {
            prompt.addProperty("sourceCardName", sourceName);
        }
        if (mode != null) {
            prompt.addProperty("mode", mode);
        }
        if (api != null) {
            prompt.addProperty("api", api);
        }
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
        com.google.gson.JsonArray labels = new com.google.gson.JsonArray();
        labels.add("Decline");
        labels.add("Accept");
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
            final String sourceName,
            final String description
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_number");
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

    private void publishDigPrompt(
            final int playerId,
            final List<Card> cards,
            final int max,
            final boolean optional,
            final String sourceName
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_dig");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.addProperty("max", max);
        prompt.addProperty("optional", optional);
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
            com.google.gson.JsonArray validDefenderIds = new com.google.gson.JsonArray();
            for (final GameEntity d : CombatChoiceSpace.legalDefendersForAttacker(a, combat)) {
                validDefenderIds.add(defenderId(d));
            }
            option.add("validDefenderIds", validDefenderIds);
            attackers.add(option);
        }
        prompt.add("attackers", attackers);

        com.google.gson.JsonArray defenders = new com.google.gson.JsonArray();
        for (final GameEntity defender : combat.getDefenders()) {
            JsonObject option = new JsonObject();
            option.addProperty("id", defenderId(defender));
            option.addProperty("label", defender.getName());
            defenders.add(option);
        }
        prompt.add("defenders", defenders);
        latestPromptJson = prompt.toString();
    }

    private void publishBlockersPrompt(
            final int playerId,
            final List<Card> attackers,
            final List<Card> availableBlockers,
            final Map<Card, List<Card>> validBlockersByAttacker
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_blockers");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        prompt.add("snapshot", JsonParser.parseString(snapshotJson()));
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
            final GameEntity defender
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", "choose_combat_damage_assignment");
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
        if (attacker != null) {
            prompt.addProperty("attackerId", SnapshotExtractor.javaCardId(attacker));
            prompt.addProperty("attackerHasDeathtouch", attacker.hasKeyword("Deathtouch"));
        } else {
            prompt.addProperty("attackerHasDeathtouch", false);
        }
        if (defender != null && attacker != null && attacker.hasKeyword("Trample")) {
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
            final List<Pair<GameEntity, forge.game.GameObject>> candidates
    ) {
        JsonObject prompt = new JsonObject();
        prompt.addProperty("kind", targetPromptKind(candidates));
        prompt.addProperty("sessionId", sessionId);
        prompt.addProperty("player", playerId);
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
