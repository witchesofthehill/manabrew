package forge.harness;

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
        long seed = 42;
        int maxTurns = 10;
        boolean preferActions = false;
        boolean deep = false;
        String forgeHome = null;
        boolean serverMode = false;
        String variant = "Constructed";
        String commandersArg = null;
        String verboseTurnsArg = null;

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--deck1":
                    if (i + 1 < args.length) deck1Name = args[++i];
                    break;
                case "--deck2":
                    if (i + 1 < args.length) deck2Name = args[++i];
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
                case "--variant":
                    if (i + 1 < args.length) variant = args[++i];
                    break;
                case "--commanders":
                    if (i + 1 < args.length) commandersArg = args[++i];
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

        // Parse commanders from comma-separated list
        List<String> commanders = new ArrayList<>();
        if (commandersArg != null && !commandersArg.isEmpty()) {
            for (String cmd : commandersArg.split(",")) {
                commanders.add(cmd.trim());
            }
        }

        // Resolve forge-gui assets directory
        String assetsDir = resolveAssetsDir(forgeHome);
        System.err.println("[harness] Assets dir: " + assetsDir);

        // In server mode, capture real stdout and redirect System.out BEFORE
        // FModel.initialize() to prevent Forge's stray println() calls from
        // leaking into the protocol stream during initialization.
        if (serverMode) {
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
            FModel.initialize(null, null);
        } catch (Exception e) {
            System.err.println("[harness] Failed to initialize Forge: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(1);
        }

        int[] verboseTurns = parseVerboseTurns(verboseTurnsArg);

        if (serverMode) {
            runServerMode();
        } else {
            runOneShot(deck1Name, deck2Name, seed, maxTurns, preferActions, deep, variant, commanders, verboseTurns);
        }
    }

    /**
     * Original one-shot mode: run a single game and exit.
     */
    private static void runOneShot(
        String deck1Name,
        String deck2Name,
        long seed,
        int maxTurns,
        boolean preferActions,
        boolean deep,
        String variant,
        List<String> commanders,
        int[] verboseTurns
    ) {
        // In one-shot mode, protocol output goes to real System.out
        protocolOut = System.out;

        System.err.printf("[harness] Running: %s vs %s | seed=%d | max_turns=%d | variant=%s%n",
            deck1Name, deck2Name, seed, maxTurns, variant);

        runGame(deck1Name, deck2Name, seed, maxTurns, preferActions, deep, variant, commanders, verboseTurns);

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

                // Extract parameters
                String deck1 = request.has("deck1") ? request.get("deck1").getAsString() : "red_burn";
                String deck2 = request.has("deck2") ? request.get("deck2").getAsString() : "green_stompy";
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
                int[] gameVerboseTurns = null;
                if (request.has("verbose_turns")) {
                    String vt = request.get("verbose_turns").getAsString();
                    gameVerboseTurns = parseVerboseTurns(vt);
                }

                System.err.printf("[harness] Request: %s vs %s | seed=%d | max_turns=%d | variant=%s%n",
                    deck1, deck2, gameSeed, gameMaxTurns, gameVariant);

                try {
                    runGame(deck1, deck2, gameSeed, gameMaxTurns, gamePreferActions, gameDeep, gameVariant, gameCommanders, gameVerboseTurns);
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
     * Run a single game with the given parameters.
     * Snapshots are written to {@link #protocolOut} (not System.out).
     */
    private static void runGame(
        String deck1Name,
        String deck2Name,
        long seed,
        int maxTurns,
        boolean preferActions,
        boolean deep,
        String variant,
        List<String> commanders,
        int[] verboseTurns
    ) {
        // Build decks
        Deck deck1 = PresetDecks.buildDeck(deck1Name);
        Deck deck2 = PresetDecks.buildDeck(deck2Name);

        if (deck1 == null) {
            throw new IllegalArgumentException("Unknown deck: " + deck1Name +
                ". Available: " + Arrays.toString(PresetDecks.availablePresets()));
        }
        if (deck2 == null) {
            throw new IllegalArgumentException("Unknown deck: " + deck2Name +
                ". Available: " + Arrays.toString(PresetDecks.availablePresets()));
        }

        // Assign commanders from existing main-deck cards if provided.
        // Contract: --commander names must already be present in each player's main deck.
        // Move one matching card per commander from Main -> Commander section.
        if (commanders != null && !commanders.isEmpty()) {
            List<String> uniqueCommanders = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (String cmdName : commanders) {
                String key = cmdName.toLowerCase(Locale.ROOT);
                if (seen.add(key)) {
                    uniqueCommanders.add(cmdName);
                }
            }

            for (Deck deck : Arrays.asList(deck1, deck2)) {
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
        }

        System.err.printf("[harness] Deck 1: %s (%d cards)%n", deck1Name,
            deck1.getMain().countAll());
        System.err.printf("[harness] Deck 2: %s (%d cards)%n", deck2Name,
            deck2.getMain().countAll());

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
        ParityReset.resetAllIdCounters();

        // Create a shared Random for agent decisions, seeded identically to
        // the Rust side's JavaRandom(seed). Both players share this instance
        // so RNG consumption order matches the Rust agents exactly.
        CountingRandom agentRng = new CountingRandom(seed, "agent");

        List<RegisteredPlayer> players = new ArrayList<>();

        // Create registered players with variant support
        RegisteredPlayer rp1 = RegisteredPlayer.forVariants(
            2, appliedVariants, deck1, null, false, null, null);
        rp1.setPlayer(new DeterministicLobbyPlayer("Player1", agentRng, preferActions, false, verboseTurns));
        players.add(rp1);

        RegisteredPlayer rp2 = RegisteredPlayer.forVariants(
            2, appliedVariants, deck2, null, false, null, null);
        rp2.setPlayer(new DeterministicLobbyPlayer("Player2", agentRng, preferActions, false, verboseTurns));
        players.add(rp2);

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
        System.err.println("  --seed <number>      RNG seed (default: 42)");
        System.err.println("  --max-turns <n>      Maximum turns (default: 10)");
        System.err.println("  --prefer-actions     Bias random choices toward acting instead of passing");
        System.err.println("  --forge-home <path>  Path to forge-gui/ assets directory");
        System.err.println("  --server             Run in server mode (stdin/stdout JSONL protocol)");
        System.err.println("  --variant <type>     Game variant: Constructed, Commander, Oathbreaker, TinyLeaders, Brawl");
        System.err.println("  --commanders <names> Comma-separated commander card names");
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
