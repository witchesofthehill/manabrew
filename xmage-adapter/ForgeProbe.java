import com.google.gson.*;
import forge.harness.host.ManaBrewEngineAdapter;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public final class ForgeProbe {
    private static final Gson JSON = new Gson();

    public static void main(String[] args) throws Exception {
        if (args.length < 3 || args.length > 4) throw new IllegalArgumentException("Expected assets directory, protocol-agent path, capture path, optional bolt/x-cost scenario");
        String scenario = args.length == 4 ? args[3] : "bolt";
        if (!List.of("bolt", "x-cost").contains(scenario)) throw new IllegalArgumentException("Unknown scenario");
        ManaBrewEngineAdapter adapter = new ManaBrewEngineAdapter();
        adapter.initialize(args[0]);
        List<ManaBrewEngineAdapter.CardIdentity> deck = new ArrayList<>();
        for (int i = 0; i < 10; i++) deck.add(new ManaBrewEngineAdapter.CardIdentity("Mountain", "M15", "262", false));
        for (int i = 0; i < 20; i++) deck.add(scenario.equals("x-cost")
                ? new ManaBrewEngineAdapter.CardIdentity("Fireball", "M10", "136", false)
                : new ManaBrewEngineAdapter.CardIdentity("Lightning Bolt", "M11", "149", false));
        var request = new ManaBrewEngineAdapter.StartGameRequest("forge-protocol-probe", "Constructed", 20, 7,
                List.of(new ManaBrewEngineAdapter.PlayerConfig("Seat 0", deck, List.of(), false),
                        new ManaBrewEngineAdapter.PlayerConfig("Seat 1", deck, List.of(), false)));
        String session = adapter.startGame(request).getSessionId();
        List<Process> bots = new ArrayList<>();
        List<BufferedReader> readers = new ArrayList<>();
        List<PrintWriter> writers = new ArrayList<>();
        ExecutorService executor = Executors.newSingleThreadExecutor();
        int answered = 0;
        int minimumLife = 20;
        Map<String, Integer> families = new TreeMap<>();
        long previous = -1;
        try (PrintWriter capture = new PrintWriter(Files.newBufferedWriter(Path.of(args[2])))) {
            for (int seat = 0; seat < 2; seat++) {
                Process bot = new ProcessBuilder(scenario.equals("x-cost") ? List.of(args[1], "--number-choice", "2", "--target-count", "1") : List.of(args[1])).redirectError(ProcessBuilder.Redirect.INHERIT).start();
                bots.add(bot);
                readers.add(bot.inputReader());
                writers.add(new PrintWriter(bot.outputWriter(), true));
            }
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120);
            while (!Boolean.parseBoolean(adapter.getGameOver(session))) {
                if (System.nanoTime() > deadline) throw new IllegalStateException("Forge game exceeded 120 seconds");
                String value = adapter.getPrompt(session, 0);
                if (value.isEmpty()) { Thread.sleep(5); continue; }
                JsonObject prompt = JsonParser.parseString(value).getAsJsonObject();
                long id = prompt.get("promptId").getAsLong();
                if (id == previous) { Thread.sleep(5); continue; }
                previous = id;
                int seat = Integer.parseInt(prompt.get("decidingPlayerId").getAsString().substring(7));
                String family = prompt.getAsJsonObject("input").get("type").getAsString();
                if (family.equals("gameOver")) break;
                record(capture, seat, "event", Map.of("method", "prompt", "params", prompt));
                JsonObject snapshot = JsonParser.parseString(adapter.getSnapshot(session, seat)).getAsJsonObject();
                record(capture, seat, "event", Map.of("method", "state", "params", Map.of("gameView", snapshot)));
                for (JsonElement player : snapshot.getAsJsonArray("players")) minimumLife = Math.min(minimumLife, player.getAsJsonObject().get("life").getAsInt());
                writers.get(seat).println(value);
                String line = executor.submit(() -> readers.get(seat).readLine()).get(10, TimeUnit.SECONDS);
                if (line == null) throw new IllegalStateException("Protocol agent exited");
                JsonObject response = JsonParser.parseString(line).getAsJsonObject();
                if (response.get("promptId").getAsLong() != id) throw new IllegalStateException("Mismatched prompt id");
                record(capture, seat, "request", Map.of("method", "respond", "id", id, "params", response));
                adapter.submitAction(session, response.getAsJsonObject("action").toString());
                record(capture, seat, "event", Map.of("id", id, "result", true));
                families.merge(family, 1, Integer::sum);
                answered++;
            }
            if (!Boolean.parseBoolean(adapter.getGameOver(session))) throw new IllegalStateException("No terminal Forge state");
            if (!families.containsKey("payManaCost") || !families.containsKey("chooseBoardTargets")) {
                throw new IllegalStateException("Game did not exercise spells, targets and payments");
            }
            if (minimumLife >= 20 || (scenario.equals("x-cost") && !families.containsKey("chooseNumber"))) {
                throw new IllegalStateException("Scenario did not exercise its intended mechanic");
            }
            record(capture, 0, "event", Map.of("method", "gameEnded", "params", Map.of("gameId", session)));
            System.out.println("FORGE_PROBE " + JSON.toJson(Map.of("answered", answered, "mechanics", families, "completed", true, "scenario", scenario, "minimumLife", minimumLife)));
        } finally {
            adapter.endGame(session);
            bots.forEach(Process::destroyForcibly);
            executor.shutdownNow();
        }
        System.exit(0);
    }

    private static void record(PrintWriter capture, int seat, String direction, Object message) {
        capture.println(JSON.toJson(Map.of("seat", seat, "direction", direction, "message", message)));
        capture.flush();
    }
}
