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
        FModel.initialize(null, null);
        initialized = true;
    }

    public SessionHandle startGame(final StartGameRequest request) {
        Objects.requireNonNull(request, "request");
        requireInitialized();

        final CountingRandom rng = new CountingRandom(request.getSeed(), "hosted");

        final int playerCount = request.getPlayers().size();
        final boolean commanderGame = playerCount > 2
                || request.getStartingLife() == 40
                || request.getPlayers().stream().anyMatch(player ->
                        !player.getCommanderNames().isEmpty());
        final GameType gameType = commanderGame ? GameType.Commander : GameType.Constructed;
        final Set<GameType> variants = EnumSet.of(gameType);
        final GameRules rules = new GameRules(gameType);
        rules.setAppliedVariants(variants);
        rules.setSimTimeout(120);

        ForgeEngineReset.resetAllIdCounters();
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

    public String getSnapshot(final String sessionId) {
        return getSession(sessionId).getSnapshotJson();
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
        ManaBrewInteractiveSession session = sessions.remove(sessionId);
        if (session != null) {
            session.close();
        }
        JsonObject response = new JsonObject();
        response.addProperty("sessionId", sessionId);
        response.addProperty("ended", true);
        return response.toString();
    }

    public void endGame(final String sessionId) {
        ManaBrewInteractiveSession session = getSession(sessionId);
        session.close();
        sessions.remove(sessionId);
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
            if (card.getSetCode() == null || card.getSetCode().isBlank()) {
                main.add(card.getName(), 1);
            } else {
                main.add(card.getName(), card.getSetCode());
            }
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

    private static void requireSessionId(final String sessionId) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new IllegalArgumentException("sessionId is required");
        }
    }

    private static StartGameRequest parseStartGameRequest(final String requestJson) {
        JsonObject root = JsonParser.parseString(requestJson).getAsJsonObject();
        String gameId = requiredString(root, "gameId");
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
                        optionalString(cardObject, "setCode")));
            }
            boolean ai = playerObject.has("ai")
                    && !playerObject.get("ai").isJsonNull()
                    && playerObject.get("ai").getAsBoolean();
            players.add(new PlayerConfig(name, deck, commanderNames, ai));
        }
        return new StartGameRequest(gameId, startingLife, seed, players);
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
        private final int startingLife;
        private final long seed;
        private final List<PlayerConfig> players;

        public StartGameRequest(
                final String gameId,
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
            this.startingLife = startingLife;
            this.seed = seed;
            this.players = List.copyOf(players);
        }

        public String getGameId() {
            return gameId;
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

        public CardIdentity(final String name, final String setCode) {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("card name is required");
            }
            this.name = name;
            this.setCode = setCode;
        }

        public String getName() {
            return name;
        }

        public String getSetCode() {
            return setCode;
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
