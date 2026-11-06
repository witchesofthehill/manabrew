package forge.harness;

import forge.harness.host.ManaBrewEngineAdapter;

import forge.harness.parity.DeterministicController;
import forge.harness.parity.DeterministicLobbyPlayer;
import forge.harness.common.ParityLog;
import forge.harness.parity.PresetDecks;

import forge.harness.common.CountingRandom;
import forge.harness.common.DecisionLog;
import forge.harness.common.HeadlessGuiBase;
import forge.harness.common.ParityCardMap;
import forge.harness.common.ForgeEngineReset;
import forge.harness.common.SnapshotExtractor;

import com.google.common.eventbus.Subscribe;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.*;
import forge.game.event.GameEventPlayerPriority;
import forge.game.event.GameEventTurnPhase;
import forge.game.phase.PhaseType;
import forge.game.player.RegisteredPlayer;
import forge.gui.GuiBase;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgePreferences;
import forge.model.FModel;

import java.io.*;
import java.util.*;

/**
 * Headless CLI entry point for the forge-harness parity testing tool.
 *
 * <p><b>One-shot mode</b> (default):
 * <pre>
 * java -jar forge-harness-jar-with-dependencies.jar \
 *   --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 10
 * </pre>
 *
 * <p><b>Server mode</b> ({@code --server}):
 * Initializes FModel once, then reads JSONL requests from stdin and writes
 * snapshot responses to stdout. Avoids repeated JVM startup cost.
 * <pre>
 * java -jar forge-harness-jar-with-dependencies.jar --server
 * </pre>
 *
 * Outputs JSONL to stdout: one StateSnapshot per line.
 * All diagnostic messages go to stderr.
 */
public final class Main {
    private Main() {}

    /** Dedicated protocol output stream, safe from Forge's stray System.out calls. */
    private static PrintStream protocolOut;

    public static void main(String[] args) {
        // Parse CLI arguments
        String deck1Name = "red_burn";
        String deck2Name = "green_stompy";
        String deck3Name = null;
        String deck4Name = null;
        long seed = 42;
        int maxTurns = 10;
        boolean preferActions = false;
        boolean deep = false;
        String forgeHome = null;
        boolean serverMode = false;
        boolean interactiveServerMode = false;
        String variant = "Constructed";
        String commandersArg = null;
        String commanders1Arg = null;
        String commanders2Arg = null;
        String commanders3Arg = null;
        String commanders4Arg = null;
        String verboseTurnsArg = null;

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--deck1":
                    if (i + 1 < args.length) deck1Name = args[++i];
                    break;
                case "--deck2":
                    if (i + 1 < args.length) deck2Name = args[++i];
                    break;
                case "--deck3":
                    if (i + 1 < args.length) deck3Name = args[++i];
                    break;
                case "--deck4":
                    if (i + 1 < args.length) deck4Name = args[++i];
                    break;
                case "--seed":
                    if (i + 1 < args.length) seed = Long.parseLong(args[++i]);
                    break;
                case "--max-turns":
                    if (i + 1 < args.length) maxTurns = Integer.parseInt(args[++i]);
                    break;
                case "--prefer-actions":
                    preferActions = true;
                    break;
                case "--deep":
                    deep = true;
                    break;
                case "--forge-home":
                    if (i + 1 < args.length) forgeHome = args[++i];
                    break;
                case "--server":
                    serverMode = true;
                    break;
                case "--interactive-server":
                    interactiveServerMode = true;
                    break;
                case "--variant":
                    if (i + 1 < args.length) variant = args[++i];
                    break;
                case "--commanders":
                    if (i + 1 < args.length) commandersArg = args[++i];
                    break;
                case "--commanders1":
                    if (i + 1 < args.length) commanders1Arg = args[++i];
                    break;
                case "--commanders2":
                    if (i + 1 < args.length) commanders2Arg = args[++i];
                    break;
                case "--commanders3":
                    if (i + 1 < args.length) commanders3Arg = args[++i];
                    break;
                case "--commanders4":
                    if (i + 1 < args.length) commanders4Arg = args[++i];
                    break;
                case "--verbose-turns":
                    if (i + 1 < args.length) verboseTurnsArg = args[++i];
                    break;
                case "--help":
                    printUsage();
                    return;
                default:
                    System.err.println("[harness] Unknown argument: " + args[i]);
                    break;
            }
        }

        // The server protocol sends JSON arrays; comma splitting is CLI-only.
        List<String> commanders = parseCommanderList(commandersArg);
        List<String> deckNames = new ArrayList<>();
        deckNames.add(deck1Name);
        deckNames.add(deck2Name);
        if (deck3Name != null) deckNames.add(deck3Name);
        if (deck4Name != null) deckNames.add(deck4Name);

        List<List<String>> commandersByPlayer = new ArrayList<>();
        if (commanders1Arg != null || commanders2Arg != null
                || commanders3Arg != null || commanders4Arg != null) {
            commandersByPlayer.add(parseCommanderList(commanders1Arg));
            commandersByPlayer.add(parseCommanderList(commanders2Arg));
            commandersByPlayer.add(parseCommanderList(commanders3Arg));
            commandersByPlayer.add(parseCommanderList(commanders4Arg));
        }

        // Resolve forge-gui assets directory
        String assetsDir = resolveAssetsDir(forgeHome);
        System.err.println("[harness] Assets dir: " + assetsDir);

        // In any server mode, capture real stdout and redirect System.out BEFORE
        // FModel.initialize() to prevent Forge's stray println() calls from
        // leaking into the protocol stream during initialization.
        if (serverMode || interactiveServerMode) {
            protocolOut = System.out;
            System.setOut(new PrintStream(new OutputStream() {
                @Override public void write(int b) { /* discard */ }
                @Override public void write(byte[] b, int off, int len) { /* discard */ }
            }));
        }

        // Initialize Forge headless — must set GuiBase before FModel.initialize
        System.err.println("[harness] Initializing Forge...");
        GuiBase.setInterface(new HeadlessGuiBase(assetsDir));
        try {
            if (interactiveServerMode) {
                FModel.initialize(null, prefs -> {
                    prefs.setPref(ForgePreferences.FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
                    prefs.setPref(ForgePreferences.FPref.DECKGEN_CARDBASED, false);
                    // Skips the tap/untap/mana replacement scan of zones other
                    // than battlefield and command (Card-Forge/forge#11160).
                    prefs.setPref(ForgePreferences.FPref.PERFORMANCE_MODE, true);
                    return null;
                });
                // The patch 24 runaway caps default to 25k per turn, sized for the heap. A
                // turn that creates 800 tokens and fires 8k triggers already takes longer
                // than a session; these end it as a Draw while the tab is still alive.
                forge.game.Game.setRunawayCardsPerTurnCap(1000);
                forge.game.Game.setRunawayTriggersPerTurnCap(5000);
            } else {
                FModel.initialize(null, null);
            }
        } catch (Exception e) {
            System.err.println("[harness] Failed to initialize Forge: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(1);
        }

        int[] verboseTurns = parseVerboseTurns(verboseTurnsArg);

        if (interactiveServerMode) {
            runInteractiveServerMode(assetsDir);
        } else if (serverMode) {
            runServerMode();
        } else {
            runOneShot(deckNames, seed, maxTurns, preferActions, deep, variant, commanders, commandersByPlayer, verboseTurns);
        }
    }

    /**
     * Original one-shot mode: run a single game and exit.
     */
    private static void runOneShot(
        List<String> deckNames,
        long seed,
        int maxTurns,
        boolean preferActions,
        boolean deep,
        String variant,
        List<String> commanders,
        List<List<String>> commandersByPlayer,
        int[] verboseTurns
    ) {
        // In one-shot mode, protocol output goes to real System.out
        protocolOut = System.out;

        System.err.printf("[harness] Running: %s | seed=%d | max_turns=%d | variant=%s%n",
            String.join(" vs ", deckNames), seed, maxTurns, variant);

        runGame(deckNames, seed, maxTurns, preferActions, deep, variant, commanders, commandersByPlayer, verboseTurns);

        System.err.println("[harness] Done.");
        protocolOut.flush();
    }

    /**
     * Server mode: read JSONL requests from stdin, run games, write responses.
     * FModel is already initialized — we reuse it across all requests.
     */
    private static void runServerMode() {
        // protocolOut and System.out redirect already set up in main() before FModel.initialize()
        System.err.println("[harness] Server mode ready. Waiting for requests on stdin...");

        BufferedReader stdin = new BufferedReader(new InputStreamReader(System.in));
        String line;

        try {
            while ((line = stdin.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;

                JsonObject request;
                try {
                    request = JsonParser.parseString(line).getAsJsonObject();
                } catch (Exception e) {
                    System.err.println("[harness] Failed to parse request: " + e.getMessage());
                    protocolOut.println("{\"done\":true,\"error\":\"Invalid JSON: " +
                        escapeJson(e.getMessage()) + "\"}");
                    protocolOut.flush();
                    continue;
                }

                String command = request.has("command") ? request.get("command").getAsString() : "run";

                if ("quit".equals(command)) {
                    System.err.println("[harness] Received quit command. Shutting down.");
                    break;
                }

                if (!"run".equals(command)) {
                    System.err.println("[harness] Unknown command: " + command);
                    protocolOut.println("{\"done\":true,\"error\":\"Unknown command: " +
                        escapeJson(command) + "\"}");
                    protocolOut.flush();
                    continue;
                }

                // `decks` is the N-player form; deck1/deck2 stay for old clients.
                List<String> gameDecks = new ArrayList<>();
                if (request.has("decks") && request.get("decks").isJsonArray()) {
                    for (var elem : request.get("decks").getAsJsonArray()) {
                        gameDecks.add(elem.getAsString());
                    }
                } else {
                    gameDecks.add(request.has("deck1") ? request.get("deck1").getAsString() : "red_burn");
                    gameDecks.add(request.has("deck2") ? request.get("deck2").getAsString() : "green_stompy");
                    if (request.has("deck3")) gameDecks.add(request.get("deck3").getAsString());
                    if (request.has("deck4")) gameDecks.add(request.get("deck4").getAsString());
                }
                long gameSeed = request.has("seed") ? request.get("seed").getAsLong() : 42;
                int gameMaxTurns = request.has("max_turns") ? request.get("max_turns").getAsInt() : 10;
                boolean gamePreferActions = request.has("prefer_actions") && request.get("prefer_actions").getAsBoolean();
                boolean gameDeep = request.has("deep") && request.get("deep").getAsBoolean();
                String gameVariant = request.has("variant") ? request.get("variant").getAsString() : "Constructed";
                List<String> gameCommanders = new ArrayList<>();
                if (request.has("commanders") && request.get("commanders").isJsonArray()) {
                    for (var elem : request.get("commanders").getAsJsonArray()) {
                        gameCommanders.add(elem.getAsString());
                    }
                }
                List<List<String>> gameCommandersByPlayer = new ArrayList<>();
                if (request.has("commanders_by_player") && request.get("commanders_by_player").isJsonArray()) {
                    for (var seatElem : request.get("commanders_by_player").getAsJsonArray()) {
                        List<String> seatCommanders = new ArrayList<>();
                        if (seatElem.isJsonArray()) {
                            for (var elem : seatElem.getAsJsonArray()) {
                                seatCommanders.add(elem.getAsString());
                            }
                        }
                        gameCommandersByPlayer.add(seatCommanders);
                    }
                }
                int[] gameVerboseTurns = null;
                if (request.has("verbose_turns")) {
                    String vt = request.get("verbose_turns").getAsString();
                    gameVerboseTurns = parseVerboseTurns(vt);
                }

                System.err.printf("[harness] Request: %s | seed=%d | max_turns=%d | variant=%s%n",
                    String.join(" vs ", gameDecks), gameSeed, gameMaxTurns, gameVariant);

                try {
                    runGame(gameDecks, gameSeed, gameMaxTurns, gamePreferActions, gameDeep, gameVariant, gameCommanders, gameCommandersByPlayer, gameVerboseTurns);
                    protocolOut.println("{\"done\":true,\"error\":null}");
                } catch (Exception e) {
                    System.err.println("[harness] Game error: " + e.getMessage());
                    e.printStackTrace(System.err);
                    protocolOut.println("{\"done\":true,\"error\":\"" +
                        escapeJson(e.getMessage()) + "\"}");
                }
                protocolOut.flush();
                // Reclaim memory between games — clear image caches and hint GC.
                forge.ImageKeys.clearCaches();
                System.gc();
            }
        } catch (IOException e) {
            System.err.println("[harness] Stdin read error: " + e.getMessage());
        }

        System.err.println("[harness] Server exiting.");
    }

    /**
     * Interactive server mode: per-game JSON-RPC over stdin/stdout dispatching
     * to a long-lived {@link ManaBrewEngineAdapter}. Sessions are routed by
     * sessionId and each runs on its own game thread, so one process can host
     * several concurrent games; pool callers send `reset` only while the
     * process is idle and `quit` to exit.
     *
     * Request shape:  {"command":"startGame","payload":"<json>"}  (sessionId
     * goes in `sessionId`; payload is the inner JSON string).
     * Response shape: {"ok":true,"result":"<json|bool|empty>"} or {"ok":false,"error":"..."}.
     */
    private static void runInteractiveServerMode(String assetsDir) {
        System.err.println("[harness] Interactive server mode ready.");

        final ManaBrewEngineAdapter adapter = new ManaBrewEngineAdapter();
        try {
            adapter.initialize(assetsDir);
        } catch (Exception e) {
            System.err.println("[harness] adapter.initialize failed: " + e.getMessage());
            e.printStackTrace(System.err);
            sendError(e.getMessage());
            return;
        }

        BufferedReader stdin = new BufferedReader(new InputStreamReader(System.in));
        String line;

        try {
            while ((line = stdin.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;

                JsonObject request;
                try {
                    request = JsonParser.parseString(line).getAsJsonObject();
                } catch (Exception e) {
                    sendError("Invalid JSON: " + e.getMessage());
                    continue;
                }

                String command = request.has("command") ? request.get("command").getAsString() : "";

                try {
                    switch (command) {
                        case "getRewindRequest":
                        case "resumeAfterFailedRewind":
                        case "replayReady":
                            sendOk(forge.harness.host.EngineCommands.execute(adapter, request.toString()));
                            break;
                        case "quit":
                            System.err.println("[harness] interactive server received quit");
                            return;
                        case "reset":
                            ForgeEngineReset.resetAllIdCounters();
                            forge.ImageKeys.clearCaches();
                            System.gc();
                            sendOk("");
                            break;
                        case "startGame":
                            sendOk(adapter.startGameJson(requireString(request, "payload")));
                            break;
                        case "submitAction":
                            sendOk(adapter.submitAction(
                                requireString(request, "sessionId"),
                                requireString(request, "payload")));
                            break;
                        case "getPrompt":
                            sendOk(adapter.getPrompt(
                                requireString(request, "sessionId"),
                                request.get("playerIndex").getAsInt()));
                            break;
                        case "getSnapshot":
                            sendOk(adapter.getSnapshot(
                                requireString(request, "sessionId"),
                                request.has("viewer") ? request.get("viewer").getAsInt() : -1));
                            break;
                        case "exportReplaySnapshot":
                            sendOk(adapter.exportReplaySnapshot(requireString(request, "sessionId"),
                                requireString(request, "payload")));
                            break;
                        case "restoreReplaySnapshot":
                            sendOk(adapter.restoreReplaySnapshot(requireString(request, "payload")));
                            break;
                        case "getGameOver":
                            sendOk(adapter.getGameOver(requireString(request, "sessionId")));
                            break;
                        case "readDecisionJournal":
                            sendOk(adapter.readDecisionJournal(requireString(request, "sessionId")));
                            break;
                        case "acknowledgeDecisionJournal":
                            sendOk(adapter.acknowledgeDecisionJournal(requireString(request, "sessionId"),
                                new java.math.BigDecimal(requireString(request, "sequence")).longValueExact()));
                            break;
                        case "drainDecisionJournal":
                            sendOk(adapter.drainDecisionJournal(requireString(request, "sessionId")));
                            break;
                        case "drainCheckpointMetrics":
                            sendOk(adapter.drainCheckpointMetrics(requireString(request, "sessionId")));
                            break;
                        case "drainDirectives":
                            sendOk(adapter.drainDirectives(requireString(request, "sessionId")));
                            break;
                        case "getStateRevision":
                            sendOk(adapter.getStateRevision(requireString(request, "sessionId")));
                            break;
                        case "endGame":
                            sendOk(adapter.endGameJson(requireString(request, "sessionId")));
                            break;
                        case "abortGame":
                            sendOk(adapter.abortGameJson(requireString(request, "sessionId")));
                            break;
                        default:
                            sendError("Unknown command: " + command);
                    }
                } catch (Exception e) {
                    System.err.println("[harness] dispatch error for command=" + command
                        + ": " + e.getMessage());
                    e.printStackTrace(System.err);
                    sendError(e.getMessage());
                }
            }
        } catch (IOException e) {
            System.err.println("[harness] interactive server stdin read error: " + e.getMessage());
        }

        System.err.println("[harness] interactive server exiting.");
    }

    private static String requireString(JsonObject request, String key) {
        if (!request.has(key) || request.get(key).isJsonNull()) {
            throw new IllegalArgumentException("missing required field: " + key);
        }
        return request.get(key).getAsString();
    }

    private static void sendOk(String result) {
        protocolOut.println("{\"ok\":true,\"result\":\"" + escapeJson(result) + "\"}");
        protocolOut.flush();
    }

    private static void sendError(String message) {
        protocolOut.println("{\"ok\":false,\"error\":\"" + escapeJson(message) + "\"}");
        protocolOut.flush();
    }

    /**
     * Run a single game with the given parameters.
     * Snapshots are written to {@link #protocolOut} (not System.out).
     */
    private static void runGame(
        List<String> deckNames,
        long seed,
        int maxTurns,
        boolean preferActions,
        boolean deep,
        String variant,
        List<String> commanders,
        List<List<String>> commandersByPlayer,
        int[] verboseTurns
    ) {
        if (deckNames == null || deckNames.size() < 2) {
            throw new IllegalArgumentException("At least two decks are required");
        }

        // Build decks
        List<Deck> decks = new ArrayList<>();
        for (String deckName : deckNames) {
            Deck deck = PresetDecks.buildDeck(deckName);
            if (deck == null) {
                throw new IllegalArgumentException("Unknown deck: " + deckName +
                    ". Available: " + Arrays.toString(PresetDecks.availablePresets()));
            }
            decks.add(deck);
        }

        // Assign commanders from existing main-deck cards if provided.
        // Contract: commander names must already be present in each seat's main deck.
        // Move one matching card per commander from Main -> Commander section.
        for (int seat = 0; seat < decks.size(); seat++) {
            List<String> seatCommanders = commandersByPlayer != null && !commandersByPlayer.isEmpty()
                ? (seat < commandersByPlayer.size() ? commandersByPlayer.get(seat) : List.of())
                : commanders;
            if (seatCommanders == null || seatCommanders.isEmpty()) {
                continue;
            }

            Deck deck = decks.get(seat);
            List<String> uniqueCommanders = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (String cmdName : seatCommanders) {
                String key = cmdName.toLowerCase(Locale.ROOT);
                if (seen.add(key)) {
                    uniqueCommanders.add(cmdName);
                }
            }

            CardPool main = deck.getMain();
            CardPool commanderSection = deck.getOrCreate(DeckSection.Commander);
            for (String cmdName : uniqueCommanders) {
                PaperCard mainCommander = null;
                for (PaperCard c : main.toFlatList()) {
                    if (c.getName().equalsIgnoreCase(cmdName)) {
                        mainCommander = c;
                        break;
                    }
                }
                if (mainCommander == null) {
                    throw new IllegalArgumentException(
                        "Commander \"" + cmdName + "\" was not found in main deck for " + deck.getName()
                    );
                }
                main.remove(mainCommander, 1);
                commanderSection.add(mainCommander, 1);
            }
        }

        for (int seat = 0; seat < decks.size(); seat++) {
            System.err.printf("[harness] Deck %d: %s (%d cards)%n", seat + 1,
                deckNames.get(seat), decks.get(seat).getMain().countAll());
        }

        // Parse variant to GameType
        GameType gameType = parseGameType(variant);
        Set<GameType> appliedVariants = EnumSet.of(gameType);

        // Set up game
        GameRules rules = new GameRules(gameType);
        rules.setAppliedVariants(appliedVariants);
        rules.setSimTimeout(120);

        // Reset global state for cross-game isolation in multi-game batches
        CountingRandom gameRng = new CountingRandom(seed, "game");
        forge.util.MyRandom.setRandom(gameRng);
        ForgeEngineReset.resetAllIdCounters();

        // Create a shared Random for agent decisions, seeded identically to
        // the Rust side's JavaRandom(seed). Both players share this instance
        // so RNG consumption order matches the Rust agents exactly.
        CountingRandom agentRng = new CountingRandom(seed, "agent");

        List<RegisteredPlayer> players = new ArrayList<>();

        // `forVariants` takes the table size so Brawl can adjust starting life.
        for (int seat = 0; seat < decks.size(); seat++) {
            RegisteredPlayer registered = RegisteredPlayer.forVariants(
                decks.size(), appliedVariants, decks.get(seat), null, false, null, null);
            registered.setPlayer(new DeterministicLobbyPlayer(
                "Player" + (seat + 1), agentRng, preferActions, false, verboseTurns));
            players.add(registered);
        }

        Match match = new Match(rules, players, "ParityTest");
        Game game = match.createGame();
        ParityCardMap.reset();

        // Register snapshot subscriber(s).
        // Normal mode emits turn-boundary snapshots at UNTAP.
        // Deep mode emits snapshots at every phase change and every priority assignment.
        final int turnLimit = maxTurns;
        game.subscribeToEvents(new Object() {
            private void emitSnapshot() {
                final int currentTurn = game.getPhaseHandler().getTurn();
                if (currentTurn == 1) {
                    ParityCardMap.initializeFromOpeningState(game);
                }
                ParityCardMap.syncWithGame(game);
                String snap = SnapshotExtractor.snapshotJson(game);
                protocolOut.println(snap);
                protocolOut.flush();
            }

            @Subscribe
            public void onTurnPhase(GameEventTurnPhase event) {
                int currentTurn = game.getPhaseHandler().getTurn();

                // Update controllers' turn number and log phase/turn changes
                int activePlayer = game.getPhaseHandler().getPlayerTurn().getId();
                for (forge.game.player.Player p : game.getPlayers()) {
                    if (p.getController() instanceof DeterministicController dc) {
                        if (dc.getCurrentTurn() != currentTurn) {
                            dc.setCurrentTurn(currentTurn);
                            dc.logTurnChanged(currentTurn, activePlayer);
                        }
                        dc.logPhaseChanged(event.phase().name());
                    }
                }

                // Stop before emitting if we've exceeded the turn limit
                if (currentTurn > turnLimit) {
                    System.err.printf("[harness] Turn limit reached (%d > %d), ending game%n",
                        currentTurn, turnLimit);
                    game.setGameOver(GameEndReason.Draw);
                    return;
                }
                if (deep) {
                    emitSnapshot();
                    return;
                }
                if (event.phase() != PhaseType.UNTAP) return;
                emitSnapshot();
                System.err.printf("[harness] Snapshot: turn=%d%n", currentTurn);
            }

            @Subscribe
            public void onPriority(GameEventPlayerPriority event) {
                if (!deep) return;
                if (game.isGameOver()) return;
                if (game.getPhaseHandler().getTurn() > turnLimit) return;
                emitSnapshot();
            }
        });

        System.err.println("[harness] Starting game...");
        ParityLog.enable(agentRng);
        DecisionLog.setSink(line -> {
            protocolOut.println(line);
            protocolOut.flush();
        }, false);

        // Run the game synchronously
        try {
            match.startGame(game);
        } catch (Exception e) {
            System.err.println("[harness] Game error: " + e.getMessage());
            e.printStackTrace(System.err);
        } finally {
            if (!game.isGameOver()) {
                game.setGameOver(GameEndReason.Draw);
            }
        }

        // Summary to stderr
        if (game.getOutcome() != null && !game.getOutcome().isDraw()) {
            System.err.printf("[harness] Game over. Winner: %s%n",
                game.getOutcome().getWinningLobbyPlayer().getName());
        } else {
            System.err.println("[harness] Game ended in a draw.");
        }
        DecisionLog.setSink(null, false);
        ParityLog.disable();
    }

    /** Escape a string for embedding in a JSON string value. */
    private static String escapeJson(String s) {
        if (s == null) return "null";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    /**
     * Resolve the assets directory (forge-gui/) from --forge-home or by auto-detecting.
     * The assets dir must contain res/cardsfolder/.
     */
    private static String resolveAssetsDir(String forgeHome) {
        // If --forge-home is provided, use it
        if (forgeHome != null) {
            String dir = forgeHome.endsWith(File.separator) ? forgeHome : forgeHome + File.separator;
            return dir;
        }

        // Try to auto-detect: look for forge-gui/ relative to the JAR or CWD.
        // The engine assets live in the forge/ submodule, so from the repo root
        // (typical CWD) that is forge/forge-gui/. Older flat layouts kept as
        // fallbacks.
        String[] candidates = {
            "forge" + File.separator + "forge-gui" + File.separator,
            ".." + File.separator + "forge" + File.separator + "forge-gui" + File.separator,
            ".." + File.separator + ".." + File.separator + "forge" + File.separator + "forge-gui" + File.separator,
            "forge-gui" + File.separator,
            "../forge-gui" + File.separator,
            "../../forge-gui" + File.separator,
            "../../../forge-gui" + File.separator,
        };

        for (String candidate : candidates) {
            File resDir = new File(candidate + "res" + File.separator + "cardsfolder");
            if (resDir.isDirectory()) {
                return candidate;
            }
        }

        // Fallback: use CWD (same as GuiDesktop default for non-git builds)
        System.err.println("[harness] WARNING: Could not auto-detect assets dir. Use --forge-home <path-to-forge-gui/>");
        return "";
    }

    private static List<String> parseCommanderList(String arg) {
        List<String> commanders = new ArrayList<>();
        if (arg == null || arg.isEmpty()) {
            return commanders;
        }
        for (String cmd : arg.split(",")) {
            String trimmed = cmd.trim();
            if (!trimmed.isEmpty()) {
                commanders.add(trimmed);
            }
        }
        return commanders;
    }

    /**
     * Parse verbose turns from a comma-separated string.
     * Returns null if input is null (verbose off), empty array if input is empty (all turns),
     * or an array of specific turn numbers.
     */
    private static int[] parseVerboseTurns(String arg) {
        if (arg == null) return null;
        if (arg.isEmpty()) return new int[0];
        String[] parts = arg.split(",");
        List<Integer> turns = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                try {
                    turns.add(Integer.parseInt(trimmed));
                } catch (NumberFormatException e) {
                    // skip invalid
                }
            }
        }
        if (turns.isEmpty()) return new int[0];
        return turns.stream().mapToInt(Integer::intValue).toArray();
    }

    private static void printUsage() {
        System.err.println("Usage: forge-harness [OPTIONS]");
        System.err.println();
        System.err.println("Options:");
        System.err.println("  --deck1 <name>       Preset deck for player 1 (default: red_burn)");
        System.err.println("  --deck2 <name>       Preset deck for player 2 (default: green_stompy)");
        System.err.println("  --deck3 <name>       Optional preset deck for player 3");
        System.err.println("  --deck4 <name>       Optional preset deck for player 4 (requires --deck3)");
        System.err.println("  --seed <number>      RNG seed (default: 42)");
        System.err.println("  --max-turns <n>      Maximum turns (default: 10)");
        System.err.println("  --prefer-actions     Bias random choices toward acting instead of passing");
        System.err.println("  --forge-home <path>  Path to forge-gui/ assets directory");
        System.err.println("  --server             Run in server mode (stdin/stdout JSONL protocol)");
        System.err.println("  --variant <type>     Game variant: Constructed, Commander, Oathbreaker, TinyLeaders, Brawl");
        System.err.println("  --commanders <names> Comma-separated commander card names (shared by all seats)");
        System.err.println("  --commanders1 <names> Comma-separated commander names for seat 1");
        System.err.println("  --commanders2 <names> Comma-separated commander names for seat 2");
        System.err.println("  --commanders3 <names> Comma-separated commander names for seat 3");
        System.err.println("  --commanders4 <names> Comma-separated commander names for seat 4");
        System.err.println("  --verbose-turns <t>  Verbose callback logging for specific turns (e.g. 21 or 21,22; empty = all)");
        System.err.println("  --help               Show this help");
        System.err.println();
        System.err.println("Available decks: " + Arrays.toString(PresetDecks.availablePresets()));
    }

    /**
     * Parse a variant string to a GameType enum value.
     */
    private static GameType parseGameType(String variant) {
        if (variant == null || variant.isEmpty()) {
            return GameType.Constructed;
        }
        switch (variant) {
            case "Commander":
                return GameType.Commander;
            case "Oathbreaker":
                return GameType.Oathbreaker;
            case "TinyLeaders":
                return GameType.TinyLeaders;
            case "Brawl":
                return GameType.Brawl;
            case "Constructed":
            default:
                return GameType.Constructed;
        }
    }
}
