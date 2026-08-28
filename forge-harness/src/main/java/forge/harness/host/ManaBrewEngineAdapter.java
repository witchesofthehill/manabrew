package forge.harness.host;

import forge.harness.common.CountingRandom;
import forge.harness.common.HeadlessGuiBase;
import forge.harness.common.ForgeEngineReset;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.ai.LobbyPlayerAi;
import forge.StaticData;
import forge.card.CardDb;
import forge.card.CardEdition;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.player.RegisteredPlayer;
import forge.gui.GuiBase;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgePreferences;
import forge.model.FModel;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Product-facing entry point intended for the Rust j4rs backend.
 *
 * <p>The parity harness drives deterministic full-game runs. This adapter is the
 * separate interactive surface: Rust should keep Forge's JVM alive, start a
 * session here, then exchange prompts and player actions with an interactive
 * PlayerController implementation.
 */
public final class ManaBrewEngineAdapter {
    private static final Gson GSON = new Gson();
    private final Map<String, ManaBrewInteractiveSession> sessions = new ConcurrentHashMap<>();
    private volatile boolean initialized;

    public ManaBrewEngineAdapter() {
    }

    public synchronized void initialize(final String assetsDir) {
        if (initialized) {
            return;
        }
        if (assetsDir == null || assetsDir.isBlank()) {
            throw new IllegalArgumentException("assetsDir is required");
        }
        GuiBase.setInterface(new HeadlessGuiBase(assetsDir));
        FModel.initialize(null, prefs -> {
            prefs.setPref(ForgePreferences.FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(ForgePreferences.FPref.DECKGEN_CARDBASED, false);
            return null;
        });
        initialized = true;
    }

    public SessionHandle startGame(final StartGameRequest request) {
        Objects.requireNonNull(request, "request");
        requireInitialized();

        final CountingRandom rng = new CountingRandom(request.getSeed(), "hosted");

        final int playerCount = request.getPlayers().size();
        final GameType gameType = resolveGameType(request);
        final Set<GameType> variants = EnumSet.of(gameType);
        final GameRules rules = new GameRules(gameType);
        rules.setAppliedVariants(variants);
        rules.setSimTimeout(120);

        // Resetting global counters under a live session would collide its ids;
        // multiplexed processes only reset between idle periods.
        if (sessions.isEmpty()) {
            ForgeEngineReset.resetAllIdCounters();
            forge.StaticData.instance().resetLazyLoadedCards();
            forge.ImageKeys.clearCaches();
        }
        final ManaBrewInteractiveSession session =
                new ManaBrewInteractiveSession(request.getGameId());
        final List<RegisteredPlayer> registeredPlayers = new ArrayList<>();
        for (PlayerConfig playerConfig : request.getPlayers()) {
            Deck deck = buildDeck(playerConfig);
            RegisteredPlayer registeredPlayer = RegisteredPlayer.forVariants(
                    playerCount, variants, deck, null, false, null, null);
            if (playerConfig.isAi()) {
                registeredPlayer.setPlayer(new LobbyPlayerAi(playerConfig.getName(), null));
            } else {
                registeredPlayer.setPlayer(new ManaBrewInteractiveLobbyPlayer(
                        playerConfig.getName(), session));
            }
            registeredPlayers.add(registeredPlayer);
        }

        final Match match = new Match(rules, registeredPlayers, "ManaBrew");
        final Game game = match.createGame();
        session.attach(match, game);
        sessions.put(session.getSessionId(), session);
        session.start(rng);

        List<Integer> playerIndexes = new ArrayList<>();
        for (int i = 0; i < playerCount; i++) {
            playerIndexes.add(i);
        }
        return new SessionHandle(session.getSessionId(), playerIndexes);
    }

    public String startGameJson(final String requestJson) {
        Objects.requireNonNull(requestJson, "requestJson");
        return GSON.toJson(startGame(parseStartGameRequest(requestJson)).toJsonObject());
    }

    public String submitAction(final String sessionId, final String actionJson) {
        ManaBrewInteractiveSession session = getSession(sessionId);
        Objects.requireNonNull(actionJson, "actionJson");
        return session.submitAction(actionJson);
    }

    public String getPrompt(final String sessionId, final int playerIndex) {
        ManaBrewInteractiveSession session = getSession(sessionId);
        String prompt = session.getLatestPromptJson();
        return prompt == null ? "" : prompt;
    }

    public String getSnapshot(final String sessionId, final int viewer) {
        return getSession(sessionId).getSnapshotJson(viewer);
    }

    public String getGameOver(final String sessionId) {
        return String.valueOf(getSession(sessionId).isGameOver());
    }

    public String endGameJson(final String sessionId) {
        endGame(sessionId);
        JsonObject response = new JsonObject();
        response.addProperty("sessionId", sessionId);
        response.addProperty("ended", true);
        return response.toString();
    }

    public String abortGameJson(final String sessionId) {
        return endGameJson(sessionId);
    }

    public void endGame(final String sessionId) {
        requireSessionId(sessionId);
        ManaBrewInteractiveSession session = sessions.remove(sessionId);
        if (session != null) {
            session.close();
        }
    }

    private void requireInitialized() {
        if (!initialized) {
            throw new IllegalStateException("adapter must be initialized before starting games");
        }
    }

    private ManaBrewInteractiveSession getSession(final String sessionId) {
        requireSessionId(sessionId);
        ManaBrewInteractiveSession session = sessions.get(sessionId);
        if (session == null) {
            throw new IllegalArgumentException("unknown sessionId: " + sessionId);
        }
        return session;
    }

    private static Deck buildDeck(final PlayerConfig playerConfig) {
        Deck deck = new Deck(playerConfig.getName());
        CardPool main = deck.getOrCreate(DeckSection.Main);
        Map<String, PaperCard> mainByName = new HashMap<>();
        for (CardIdentity card : playerConfig.getDeck()) {
            main.add(cardRequest(card), 1);
        }
        for (PaperCard card : main.toFlatList()) {
            mainByName.putIfAbsent(card.getName().toLowerCase(Locale.ROOT), card);
        }
        List<String> uniqueCommanders = new ArrayList<>();
        Set<String> seenCommanders = new HashSet<>();
        for (String commanderName : playerConfig.getCommanderNames()) {
            if (commanderName == null || commanderName.isBlank()) {
                continue;
            }
            if (seenCommanders.add(commanderName.toLowerCase(Locale.ROOT))) {
                uniqueCommanders.add(commanderName);
            }
        }
        for (String commanderName : uniqueCommanders) {
            PaperCard commander = mainByName.get(commanderName.toLowerCase(Locale.ROOT));
            if (commander == null && commanderName.contains(" // ")) {
                // Forge keys DFCs by front face; mirrors CardDatabase::get_by_card_name.
                String frontFace = commanderName.substring(0, commanderName.indexOf(" // "));
                commander = mainByName.get(frontFace.toLowerCase(Locale.ROOT));
            }
            if (commander == null) {
                throw new IllegalArgumentException("commander was not found in main deck: "
                        + commanderName);
            }
            main.remove(commander, 1);
            deck.getOrCreate(DeckSection.Commander).add(commander, 1);
        }
        return deck;
    }

    static String cardRequest(final CardIdentity card) {
        return cardRequest(card, staticDataNames());
    }

    static String cardRequest(final CardIdentity card, final CardNameIndex names) {
        final String name = CardDb.CardRequest.compose(resolveCardName(card, names), card.isFoil());
        if (card.getSetCode() == null || card.getSetCode().isBlank()) {
            return name;
        }
        if (card.getCollectorNumber() == null || card.getCollectorNumber().isBlank()) {
            return CardDb.CardRequest.compose(name, card.getSetCode());
        }
        return CardDb.CardRequest.compose(name, card.getSetCode(), card.getCollectorNumber());
    }

    /**
     * The name Forge files a card under, given the name a deck asked for.
     */
    static String resolveCardName(final CardIdentity card, final CardNameIndex names) {
        final String requested = card.getName();
        if (requested == null || requested.isBlank() || names == null) {
            return requested;
        }
        if (names.knowsCard(requested)) {
            return requested;
        }
        final String printed = names.cardNamePrintedAs(
                card.getSetCode(), card.getCollectorNumber(), requested);
        if (printed != null && !printed.isBlank()) {
            return printed;
        }
        final String byFlavorName = names.cardNameForFlavorName(requested);
        return byFlavorName == null || byFlavorName.isBlank() ? requested : byFlavorName;
    }

    /** The card-database questions {@link #resolveCardName} asks, so a test can answer them. */
    interface CardNameIndex {
        boolean knowsCard(String name);

        /** The card at this printing, when the edition files it under the given flavor name. */
        String cardNamePrintedAs(String setCode, String collectorNumber, String flavorName);

        String cardNameForFlavorName(String flavorName);
    }

    private static CardNameIndex staticDataNames() {
        final StaticData data = StaticData.instance();
        final CardDb cards = data == null ? null : data.getCommonCards();
        if (cards == null) {
            return null;
        }
        return new CardNameIndex() {
            @Override
            public boolean knowsCard(final String name) {
                return !cards.getAllCards(name).isEmpty();
            }

            @Override
            public String cardNamePrintedAs(
                    final String setCode, final String collectorNumber, final String flavorName) {
                if (setCode == null || setCode.isBlank()
                        || collectorNumber == null || collectorNumber.isBlank()) {
                    return null;
                }
                final CardEdition edition =
                        data.getEditions().get(setCode.toUpperCase(Locale.ROOT));
                if (edition == null) {
                    return null;
                }
                final CardEdition.EditionEntry entry =
                        edition.getCardFromCollectorNumber(collectorNumber);
                if (entry == null) {
                    return null;
                }
                return flavorName.equalsIgnoreCase(entry.getFlavorName()) ? entry.name() : null;
            }

            @Override
            public String cardNameForFlavorName(final String flavorName) {
                final PaperCard card = cards.getUniqueByName(flavorName);
                return card == null ? null : card.getName();
            }
        };
    }

    private static void requireSessionId(final String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId is required");
        }
    }

    private static GameType resolveGameType(final StartGameRequest request) {
        final String variant = request.getVariant();
        if (variant != null && !variant.isBlank()) {
            switch (variant) {
                case "Commander":
                    return GameType.Commander;
                case "Oathbreaker":
                    return GameType.Oathbreaker;
                case "Brawl":
                    return GameType.Brawl;
                case "Constructed":
                    return GameType.Constructed;
                default:
                    throw new IllegalArgumentException("unknown game variant: " + variant);
            }
        }
        final boolean commanderGame = request.getPlayers().size() > 2
                || request.getStartingLife() == 40
                || request.getPlayers().stream().anyMatch(player ->
                        !player.getCommanderNames().isEmpty());
        return commanderGame ? GameType.Commander : GameType.Constructed;
    }

    private static StartGameRequest parseStartGameRequest(final String requestJson) {
        JsonObject root = JsonParser.parseString(requestJson).getAsJsonObject();
        String gameId = requiredString(root, "gameId");
        String variant = optionalString(root, "variant");
        int startingLife = root.has("startingLife") ? root.get("startingLife").getAsInt() : 20;
        long seed = root.has("seed") ? root.get("seed").getAsLong() : 42L;
        JsonArray playerValues = root.getAsJsonArray("players");
        if (playerValues == null) {
            throw new IllegalArgumentException("players is required");
        }
        List<PlayerConfig> players = new ArrayList<>();
        for (JsonElement playerValue : playerValues) {
            JsonObject playerObject = playerValue.getAsJsonObject();
            String name = requiredString(playerObject, "name");
            List<String> commanderNames = new ArrayList<>();
            if (playerObject.has("commanderNames")
                    && playerObject.get("commanderNames").isJsonArray()) {
                for (JsonElement commanderValue : playerObject.getAsJsonArray("commanderNames")) {
                    if (!commanderValue.isJsonNull() && !commanderValue.getAsString().isBlank()) {
                        commanderNames.add(commanderValue.getAsString());
                    }
                }
            } else {
                String commanderName = optionalString(playerObject, "commanderName");
                if (commanderName != null && !commanderName.isBlank()) {
                    commanderNames.add(commanderName);
                }
            }
            JsonArray cardValues = playerObject.getAsJsonArray("deck");
            if (cardValues == null) {
                throw new IllegalArgumentException("player deck is required");
            }
            List<CardIdentity> deck = new ArrayList<>();
            for (JsonElement cardValue : cardValues) {
                JsonObject cardObject = cardValue.getAsJsonObject();
                deck.add(new CardIdentity(
                        requiredString(cardObject, "name"),
                        optionalString(cardObject, "setCode"),
                        optionalString(cardObject, "collectorNumber"),
                        cardObject.has("foil") && cardObject.get("foil").getAsBoolean()));
            }
            boolean ai = playerObject.has("ai")
                    && !playerObject.get("ai").isJsonNull()
                    && playerObject.get("ai").getAsBoolean();
            players.add(new PlayerConfig(name, deck, commanderNames, ai));
        }
        return new StartGameRequest(gameId, variant, startingLife, seed, players);
    }

    private static String requiredString(final JsonObject object, final String key) {
        String value = optionalString(object, key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(key + " is required");
        }
        return value;
    }

    private static String optionalString(final JsonObject object, final String key) {
        if (!object.has(key) || object.get(key).isJsonNull()) {
            return null;
        }
        return object.get(key).getAsString();
    }

    public static final class StartGameRequest {
        private final String gameId;
        private final String variant;
        private final int startingLife;
        private final long seed;
        private final List<PlayerConfig> players;

        public StartGameRequest(
                final String gameId,
                final String variant,
                final int startingLife,
                final long seed,
                final List<PlayerConfig> players
        ) {
            if (gameId == null || gameId.isBlank()) {
                throw new IllegalArgumentException("gameId is required");
            }
            if (players == null || players.size() < 2) {
                throw new IllegalArgumentException("at least two players are required");
            }
            this.gameId = gameId;
            this.variant = variant;
            this.startingLife = startingLife;
            this.seed = seed;
            this.players = List.copyOf(players);
        }

        public String getGameId() {
            return gameId;
        }

        public String getVariant() {
            return variant;
        }

        public int getStartingLife() {
            return startingLife;
        }

        public long getSeed() {
            return seed;
        }

        public List<PlayerConfig> getPlayers() {
            return players;
        }
    }

    public static final class PlayerConfig {
        private final String name;
        private final List<CardIdentity> deck;
        private final List<String> commanderNames;
        private final boolean ai;

        public PlayerConfig(
                final String name,
                final List<CardIdentity> deck,
                final List<String> commanderNames,
                final boolean ai
        ) {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("player name is required");
            }
            if (deck == null || deck.isEmpty()) {
                throw new IllegalArgumentException("player deck is required");
            }
            this.name = name;
            this.deck = List.copyOf(deck);
            this.commanderNames = commanderNames == null ? List.of() : List.copyOf(commanderNames);
            this.ai = ai;
        }

        public String getName() {
            return name;
        }

        public List<CardIdentity> getDeck() {
            return deck;
        }

        public List<String> getCommanderNames() {
            return commanderNames;
        }

        public boolean isAi() {
            return ai;
        }
    }

    public static final class CardIdentity {
        private final String name;
        private final String setCode;
        private final String collectorNumber;
        private final boolean foil;

        public CardIdentity(
                final String name,
                final String setCode,
                final String collectorNumber,
                final boolean foil
        ) {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("card name is required");
            }
            this.name = name;
            this.setCode = setCode;
            this.collectorNumber = collectorNumber;
            this.foil = foil;
        }

        public String getName() {
            return name;
        }

        public String getSetCode() {
            return setCode;
        }

        public String getCollectorNumber() {
            return collectorNumber;
        }

        public boolean isFoil() {
            return foil;
        }
    }

    public static final class SessionHandle {
        private final String sessionId;
        private final List<Integer> playerIndexes;

        public SessionHandle(final String sessionId, final List<Integer> playerIndexes) {
            requireSessionId(sessionId);
            this.sessionId = sessionId;
            this.playerIndexes = new ArrayList<>(Objects.requireNonNull(playerIndexes,
                    "playerIndexes"));
        }

        public String getSessionId() {
            return sessionId;
        }

        public List<Integer> getPlayerIndexes() {
            return List.copyOf(playerIndexes);
        }

        private JsonObject toJsonObject() {
            JsonObject object = new JsonObject();
            object.addProperty("sessionId", sessionId);
            JsonArray players = new JsonArray();
            for (Integer playerIndex : playerIndexes) {
                players.add(playerIndex);
            }
            object.add("playerIndexes", players);
            return object;
        }
    }
}
