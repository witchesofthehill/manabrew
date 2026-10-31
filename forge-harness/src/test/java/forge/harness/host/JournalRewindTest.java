package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

public final class JournalRewindTest {
    private static final String SESSION = "journal-rewind-regression";
    private static final String FORGE_HOME = "forge/forge-gui";
    private static final long SEED = 42;
    private static final int TARGET_TURN = 10;
    private static final int LAST_TURN = 12;
    private static final int MAX_DECISIONS = 5000;
    private static final int[] VIEWERS = {-1, 0, 1};
    private static final String[][] DECK = {
            {"Plains", "24"},
            {"Luminarch Aspirant", "4"},
            {"Nadaar, Selfless Paladin", "4"},
            {"Cloister Gargoyle", "4"},
            {"Seasoned Dungeoneer", "4"},
            {"Ajani's Pridemate", "4"},
            {"Healer's Hawk", "4"},
            {"Inspiring Overseer", "4"},
            {"Thraben Inspector", "4"},
            {"Raise the Alarm", "4"},
    };

    private JournalRewindTest() {}

    private record Boundary(long sequence, int turn, JsonObject prompt, JsonObject[] views, JsonObject action) {}

    public static void main(final String[] args) throws Exception {
        try (Engine source = Engine.launch()) {
            source.call("startGame", "payload", startRequest().toString());
            final List<Boundary> original = play(source);
            final Boundary target = original.get(0);
            final Boundary end = original.get(original.size() - 1);
            requireFixture(target, end);

            final JsonObject rewind = requestRewind(source, target);
            try (Engine restored = Engine.launch()) {
                restore(restored, rewind);
                final JsonObject restoredView = views(restored)[0];
                requireEqual(p1p1Counters(target.views()[0]), p1p1Counters(restoredView),
                        "restored +1/+1 counters differ from turn " + TARGET_TURN);
                requireEqual(dungeons(target.views()[0]), dungeons(restoredView),
                        "restored dungeon progress differs from turn " + TARGET_TURN);
                replay(restored, original);
            }
            System.out.println("PASS: rewound decision " + end.sequence() + " (turn " + end.turn()
                    + ") to decision " + target.sequence() + " (turn " + target.turn() + "), then matched "
                    + original.size() + " prompts and " + original.size() * VIEWERS.length + " views; +1/+1 counters "
                    + p1p1Counters(end.views()[0]) + " -> " + p1p1Counters(target.views()[0]) + ", dungeons "
                    + dungeons(end.views()[0]) + " -> " + dungeons(target.views()[0]) + "; "
                    + logLines(end.views()[0]).size() + " checkpoint log lines, e.g. " + logLines(end.views()[0]).subList(0, 6));
        }
    }

    private static JsonObject startRequest() {
        final JsonObject request = new JsonObject();
        request.addProperty("gameId", SESSION);
        request.addProperty("variant", "Constructed");
        request.addProperty("startingLife", 20);
        request.addProperty("seed", SEED);
        request.addProperty("snapshotRecording", false);
        request.addProperty("decisionJournal", true);
        request.addProperty("journalRewind", true);
        final JsonArray players = new JsonArray();
        for (int seat = 0; seat < 2; seat++) {
            final JsonArray deck = new JsonArray();
            for (final String[] entry : DECK) {
                for (int copy = 0; copy < Integer.parseInt(entry[1]); copy++) {
                    final JsonObject card = new JsonObject();
                    card.addProperty("name", entry[0]);
                    deck.add(card);
                }
            }
            final JsonObject player = new JsonObject();
            player.addProperty("name", "Player " + seat);
            player.addProperty("ai", false);
            player.add("deck", deck);
            players.add(player);
        }
        request.add("players", players);
        return request;
    }

    private static List<Boundary> play(final Engine source) throws Exception {
        final List<Boundary> boundaries = new ArrayList<>();
        JsonObject prompt = nextPrompt(source, -1);
        int turn = 0;
        for (long sequence = 1; sequence <= MAX_DECISIONS; sequence++) {
            final JsonObject[] views = views(source);
            turn = views[0].get("turn").getAsInt();
            if (turn > LAST_TURN) {
                boundaries.add(new Boundary(sequence, turn, prompt, views, null));
                return boundaries;
            }
            final JsonObject action = answer(prompt);
            if (turn >= TARGET_TURN) {
                boundaries.add(new Boundary(sequence, turn, prompt, views, action));
            }
            source.call("submitAction", "payload", action.toString());
            prompt = nextPrompt(source, prompt.get("promptId").getAsLong());
        }
        throw new AssertionError("turn " + (LAST_TURN + 1) + " not reached within " + MAX_DECISIONS
                + " decisions; stuck on turn " + turn + " at " + prompt);
    }

    private static void requireFixture(final Boundary target, final Boundary end) {
        require(target.turn() == TARGET_TURN, "first recorded decision is not on turn " + TARGET_TURN);
        final JsonArray checkpoints = end.views()[0].getAsJsonArray("checkpoints");
        JsonObject checkpoint = null;
        for (final JsonElement element : checkpoints) {
            if (element.getAsJsonObject().get("checkpointId").getAsLong() == target.sequence()) {
                checkpoint = element.getAsJsonObject();
            }
        }
        require(checkpoint != null, "decision " + target.sequence() + " is no longer a retained checkpoint");
        require(checkpoint.get("turn").getAsInt() == TARGET_TURN, "checkpoint " + target.sequence() + " is not on turn " + TARGET_TURN);
        require(checkpoints.get(checkpoints.size() - 1).getAsJsonObject().get("checkpointId").getAsLong() == end.sequence() - 1,
                "checkpoint ids do not match consumed decisions");
        for (final JsonElement player : end.views()[0].getAsJsonArray("players")) {
            require(!"lost".equals(player.getAsJsonObject().get("status").getAsString()), "a player lost before turn " + end.turn());
        }
        require(p1p1Counters(end.views()[0]) > p1p1Counters(target.views()[0]),
                "fixture adds no +1/+1 counters after turn " + TARGET_TURN);
        require(!dungeons(end.views()[0]).equals(dungeons(target.views()[0])),
                "fixture makes no dungeon progress after turn " + TARGET_TURN);
        require(!dungeons(target.views()[0]).isEmpty(), "fixture has no dungeon in progress at turn " + TARGET_TURN);
        require(!logLines(end.views()[0]).isEmpty(), "checkpoints carry no game log lines");
    }

    private static JsonObject requestRewind(final Engine source, final Boundary target) throws Exception {
        source.call("submitAction", "payload", directive(0, "requestRestore", "checkpointId", target.sequence()).toString());
        final JsonObject vote = await("restore vote", () -> {
            final JsonObject pending = restoreVote(source);
            return "pending".equals(status(pending)) ? pending : null;
        });
        source.call("submitAction", "payload",
                directive(1, "restoreVote", "voteId", vote.get("voteId").getAsLong(), "accept", true).toString());
        final JsonObject rewind = await("rewind request", () -> {
            final String raw = source.call("getRewindRequest");
            return raw.isEmpty() ? null : JsonParser.parseString(raw).getAsJsonObject();
        });
        requireEqual(target.prompt(), rewind.get("prompt"), "rewind target prompt");
        return rewind;
    }

    private static void restore(final Engine restored, final JsonObject rewind) throws Exception {
        final JsonObject start = JsonParser.parseString(
                rewind.getAsJsonObject("journal").get("startRequest").getAsString()).getAsJsonObject();
        start.add("replaySnapshot", rewind);
        restored.call("startGame", "payload", start.toString());
        await("replay", () -> Boolean.parseBoolean(restored.call("replayReady")) ? Boolean.TRUE : null);
        require("approved".equals(status(restoreVote(restored))), "restored game does not show the approved vote");
    }

    private static void replay(final Engine restored, final List<Boundary> original) throws Exception {
        JsonObject prompt = JsonParser.parseString(restored.call("getPrompt", "playerIndex", 0)).getAsJsonObject();
        for (final Boundary boundary : original) {
            final String at = "decision " + boundary.sequence() + " (turn " + boundary.turn() + ")";
            requireEqual(boundary.prompt(), prompt, at + " prompt");
            final JsonObject[] views = views(restored);
            for (int i = 0; i < VIEWERS.length; i++) {
                requireEqual(boundary.views()[i], views[i], at + " view for viewer " + VIEWERS[i]);
            }
            if (boundary.action() == null) {
                return;
            }
            restored.call("submitAction", "payload", boundary.action().toString());
            prompt = nextPrompt(restored, prompt.get("promptId").getAsLong());
        }
    }

    private static JsonObject answer(final JsonObject prompt) {
        final JsonObject input = prompt.getAsJsonObject("input");
        final String type = input.get("type").getAsString();
        final JsonObject output = new JsonObject();
        switch (type) {
            case "diceRolled" -> output.addProperty("type", "diceRolledAcknowledged");
            case "revealCards" -> output.addProperty("type", "revealCardsAcknowledged");
            case "mulligan" -> {
                output.addProperty("type", "mulliganDecision");
                output.addProperty("keep", true);
            }
            case "mulliganPutBack" -> {
                output.addProperty("type", "mulliganPutBackDecision");
                output.add("cardIds", first(input.getAsJsonArray("handCardIds"), input.get("count").getAsInt()));
            }
            case "chooseAction" -> {
                String actionId = null;
                for (final JsonElement action : input.getAsJsonArray("actions")) {
                    if (actionId == null && "cast".equals(action.getAsJsonObject().get("type").getAsString())) {
                        actionId = action.getAsJsonObject().get("id").getAsString();
                    }
                }
                output.addProperty("type", actionId == null ? "pass" : "act");
                if (actionId != null) {
                    output.addProperty("actionId", actionId);
                }
            }
            case "payManaCost" -> {
                output.addProperty("type", "pay");
                output.addProperty("auto", !input.get("canConfirmFromPool").getAsBoolean());
            }
            case "chooseAttackers" -> {
                final JsonArray assignments = new JsonArray();
                for (final JsonElement element : input.getAsJsonArray("attackers")) {
                    final JsonArray targets = element.getAsJsonObject().getAsJsonArray("validTargetIds");
                    if (!targets.isEmpty()) {
                        final JsonObject assignment = new JsonObject();
                        assignment.add("attackerId", element.getAsJsonObject().get("attackerId"));
                        assignment.add("targetId", targets.get(0));
                        assignments.add(assignment);
                    }
                }
                output.addProperty("type", "declareAttackers");
                output.add("assignments", assignments);
            }
            case "chooseBlockers" -> {
                final JsonArray assignments = new JsonArray();
                if (!input.has("error")) {
                    final Set<String> used = new HashSet<>();
                    for (final JsonElement element : input.getAsJsonArray("attackers")) {
                        final JsonObject attacker = element.getAsJsonObject();
                        if (attacker.get("minBlockers").getAsInt() > 1) {
                            continue;
                        }
                        for (final JsonElement blocker : attacker.getAsJsonArray("validBlockerIds")) {
                            if (used.add(blocker.getAsString())) {
                                final JsonObject assignment = new JsonObject();
                                assignment.add("blockerId", blocker);
                                assignment.add("attackerId", attacker.get("attackerId"));
                                assignments.add(assignment);
                                break;
                            }
                        }
                    }
                }
                output.addProperty("type", "declareBlockers");
                output.add("assignments", assignments);
            }
            case "chooseDamageAssignmentOrder" -> {
                output.addProperty("type", "damageAssignmentOrderDecision");
                output.add("orderedBlockerIds", input.getAsJsonArray("blockerIds"));
            }
            case "chooseCombatDamageAssignment" -> {
                final JsonArray blockers = input.getAsJsonArray("blockerIds");
                final JsonObject assignment = new JsonObject();
                assignment.add("assigneeId", blockers.isEmpty() ? input.get("defenderId") : blockers.get(0));
                assignment.add("damage", input.get("totalDamage"));
                final JsonArray assignments = new JsonArray();
                assignments.add(assignment);
                output.addProperty("type", "combatDamageAssignmentDecision");
                output.add("assignments", assignments);
            }
            case "chooseBoardTargets" -> {
                final JsonArray chosen = new JsonArray();
                chosen.add(input.getAsJsonArray("candidates").get(0));
                output.addProperty("type", "boardTargets");
                output.add("chosen", chosen);
            }
            case "chooseCards" -> {
                final int max = input.get("max").getAsInt();
                final JsonArray ids = new JsonArray();
                for (final JsonElement card : input.getAsJsonArray("cards")) {
                    ids.add(card.getAsJsonObject().get("id"));
                }
                output.addProperty("type", "chooseCardsDecision");
                output.add("chosenCardIds", first(ids, Math.max(input.get("min").getAsInt(), Math.min(1, max))));
            }
            case "chooseFromSelection" -> {
                final JsonArray indices = new JsonArray();
                final int count = Math.min(input.get("maxTotal").getAsInt(), Math.max(1, input.get("minTotal").getAsInt()));
                for (int i = 0; i < count; i++) {
                    indices.add(i);
                }
                output.addProperty("type", "selectionDecision");
                output.add("chosenIndices", indices);
            }
            case "chooseBoolean" -> {
                output.addProperty("type", "decision");
                output.addProperty("value", true);
            }
            case "chooseNumber" -> {
                output.addProperty("type", "numberDecision");
                output.add("chosenNumber", input.get("min"));
            }
            case "chooseColor" -> {
                final JsonObject colors = new JsonObject();
                colors.add(input.getAsJsonArray("validColors").get(0).getAsString(), input.get("amount"));
                output.addProperty("type", "colorDecision");
                output.add("chosenColors", colors);
            }
            case "scry" -> {
                final JsonArray piles = new JsonArray();
                final JsonArray top = new JsonArray();
                for (final JsonElement card : input.getAsJsonArray("cards")) {
                    top.add(card.getAsJsonObject().get("id"));
                }
                piles.add(top);
                for (int i = 1; i < input.getAsJsonArray("zones").size(); i++) {
                    piles.add(new JsonArray());
                }
                output.addProperty("type", "scryDecision");
                output.add("zoneCardIds", piles);
            }
            case "reorder" -> {
                final JsonArray ids = new JsonArray();
                for (final JsonElement item : input.getAsJsonArray("items")) {
                    ids.add(item.getAsJsonObject().get("id"));
                }
                output.addProperty("type", "reorderDecision");
                output.add("orderedIds", ids);
            }
            default -> throw new AssertionError("fixture cannot answer prompt " + type + ": " + prompt);
        }
        final JsonObject action = new JsonObject();
        action.addProperty("type", type);
        action.add("output", output);
        return action;
    }

    private static JsonArray first(final JsonArray values, final int count) {
        final JsonArray out = new JsonArray();
        for (int i = 0; i < count && i < values.size(); i++) {
            out.add(values.get(i));
        }
        return out;
    }

    private static JsonObject directive(final int player, final String type, final Object... fields) {
        final JsonObject directive = new JsonObject();
        directive.addProperty("type", type);
        for (int i = 0; i < fields.length; i += 2) {
            if (fields[i + 1] instanceof Boolean value) {
                directive.addProperty((String) fields[i], value);
            } else {
                directive.addProperty((String) fields[i], (Number) fields[i + 1]);
            }
        }
        final JsonObject action = new JsonObject();
        action.addProperty("type", "directive");
        action.addProperty("player", player);
        action.add("directive", directive);
        return action;
    }

    private static JsonObject nextPrompt(final Engine engine, final long previous) throws Exception {
        return await("prompt after " + previous, () -> {
            if (Boolean.parseBoolean(engine.call("getGameOver"))) {
                throw new AssertionError("game ended while waiting for a prompt");
            }
            final String raw = engine.call("getPrompt", "playerIndex", 0);
            if (raw.isEmpty()) {
                return null;
            }
            final JsonObject prompt = JsonParser.parseString(raw).getAsJsonObject();
            return prompt.get("promptId").getAsLong() == previous ? null : prompt;
        });
    }

    private static JsonObject[] views(final Engine engine) throws Exception {
        final JsonObject[] views = new JsonObject[VIEWERS.length];
        for (int i = 0; i < VIEWERS.length; i++) {
            views[i] = JsonParser.parseString(engine.call("getSnapshot", "viewer", VIEWERS[i])).getAsJsonObject();
            views[i].remove("restoreVote");
            views[i].remove("decisionHistory");
        }
        return views;
    }

    private static JsonObject restoreVote(final Engine engine) throws Exception {
        final JsonElement vote = JsonParser.parseString(engine.call("getSnapshot", "viewer", -1))
                .getAsJsonObject().get("restoreVote");
        return vote == null || vote.isJsonNull() ? null : vote.getAsJsonObject();
    }

    private static String status(final JsonObject vote) {
        return vote == null ? "" : vote.getAsJsonObject("status").get("type").getAsString();
    }

    private static int p1p1Counters(final JsonObject view) {
        int total = 0;
        for (final JsonElement zone : view.getAsJsonArray("zones")) {
            if (!"battlefield".equals(zone.getAsJsonObject().get("zone").getAsString())) {
                continue;
            }
            for (final JsonElement card : zone.getAsJsonObject().getAsJsonArray("cards")) {
                final JsonObject counters = card.getAsJsonObject().getAsJsonObject("counters");
                if (counters != null && counters.has("P1P1")) {
                    total += counters.get("P1P1").getAsInt();
                }
            }
        }
        return total;
    }

    private static List<String> logLines(final JsonObject view) {
        final List<String> lines = new ArrayList<>();
        for (final JsonElement checkpoint : view.getAsJsonArray("checkpoints")) {
            final JsonArray log = checkpoint.getAsJsonObject().getAsJsonArray("log");
            if (log != null) {
                log.forEach(line -> lines.add(line.getAsString()));
            }
        }
        return lines;
    }

    private static Set<String> dungeons(final JsonObject view) {
        final Set<String> dungeons = new TreeSet<>();
        for (final JsonElement player : view.getAsJsonArray("players")) {
            final JsonObject state = player.getAsJsonObject().getAsJsonObject("dungeonState");
            if (state != null) {
                dungeons.add(player.getAsJsonObject().get("id").getAsString() + ": "
                        + state.get("name").getAsString() + " / " + state.get("room").getAsString());
            }
        }
        return dungeons;
    }

    private interface Poll<T> {
        T poll() throws Exception;
    }

    private static <T> T await(final String what, final Poll<T> poll) throws Exception {
        final long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120);
        while (System.nanoTime() < deadline) {
            final T value = poll.poll();
            if (value != null) {
                return value;
            }
            Thread.sleep(2);
        }
        throw new AssertionError("timed out waiting for " + what);
    }

    private static void requireEqual(final Object expected, final Object actual, final String what) {
        if (expected instanceof JsonElement json) {
            final String difference = difference("$", json, (JsonElement) actual);
            if (difference != null) {
                throw new AssertionError(what + " diverged at " + difference);
            }
        } else if (!Objects.equals(expected, actual)) {
            throw new AssertionError(what + ": expected " + expected + ", got " + actual);
        }
    }

    private static String difference(final String path, final JsonElement expected, final JsonElement actual) {
        if (expected == null || actual == null || expected.isJsonNull() || actual.isJsonNull()) {
            return Objects.equals(expected, actual) ? null : path + ": expected " + expected + ", got " + actual;
        }
        if (expected.isJsonObject() && actual.isJsonObject()) {
            final Set<String> keys = new TreeSet<>(expected.getAsJsonObject().keySet());
            keys.addAll(actual.getAsJsonObject().keySet());
            for (final String key : keys) {
                final String difference = difference(path + "." + key,
                        expected.getAsJsonObject().get(key), actual.getAsJsonObject().get(key));
                if (difference != null) {
                    return difference;
                }
            }
            return null;
        }
        if (expected.isJsonArray() && actual.isJsonArray()) {
            final JsonArray left = expected.getAsJsonArray();
            final JsonArray right = actual.getAsJsonArray();
            for (int i = 0; i < Math.min(left.size(), right.size()); i++) {
                final String difference = difference(path + "[" + i + "]", left.get(i), right.get(i));
                if (difference != null) {
                    return difference;
                }
            }
            return left.size() == right.size() ? null
                    : path + ": expected " + left.size() + " entries, got " + right.size();
        }
        return expected.equals(actual) ? null : path + ": expected " + expected + ", got " + actual;
    }

    private static void require(final boolean condition, final String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static final class Engine implements AutoCloseable {
        private final Process process;
        private final Writer input;
        private final BlockingQueue<String> responses = new LinkedBlockingQueue<>();
        private final StringBuilder stderr = new StringBuilder();

        private Engine(final Process process) {
            this.process = process;
            this.input = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8);
            daemon(() -> {
                try (BufferedReader lines = reader(process.getInputStream())) {
                    for (String line; (line = lines.readLine()) != null; ) {
                        if (line.startsWith("{\"ok\":")) {
                            responses.add(line);
                        }
                    }
                }
            });
            daemon(() -> {
                try (BufferedReader lines = reader(process.getErrorStream())) {
                    for (String line; (line = lines.readLine()) != null; ) {
                        synchronized (stderr) {
                            stderr.append(line).append('\n');
                            if (stderr.length() > 16384) {
                                stderr.delete(0, stderr.length() - 16384);
                            }
                        }
                    }
                }
            });
        }

        static Engine launch() throws IOException {
            final String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
            return new Engine(new ProcessBuilder(java, "-Xmx1g", "-cp", System.getProperty("java.class.path"),
                    "forge.harness.Main", "--interactive-server", "--forge-home", FORGE_HOME).start());
        }

        String call(final String command, final Object... fields) throws Exception {
            final JsonObject request = new JsonObject();
            request.addProperty("command", command);
            request.addProperty("sessionId", SESSION);
            for (int i = 0; i < fields.length; i += 2) {
                if (fields[i + 1] instanceof Number number) {
                    request.addProperty((String) fields[i], number);
                } else {
                    request.addProperty((String) fields[i], (String) fields[i + 1]);
                }
            }
            input.write(request + "\n");
            input.flush();
            final String line = responses.poll(60, TimeUnit.SECONDS);
            if (line == null) {
                throw new AssertionError(command + " timed out: " + stderrTail());
            }
            final JsonObject response = JsonParser.parseString(line).getAsJsonObject();
            if (!response.get("ok").getAsBoolean()) {
                throw new AssertionError(command + " failed: " + response.get("error").getAsString() + "\n" + stderrTail());
            }
            return response.get("result").getAsString();
        }

        private String stderrTail() {
            synchronized (stderr) {
                return stderr.toString();
            }
        }

        @Override
        public void close() throws InterruptedException {
            process.destroyForcibly();
            process.waitFor(10, TimeUnit.SECONDS);
        }

        private interface Body {
            void run() throws IOException;
        }

        private static void daemon(final Body body) {
            final Thread thread = new Thread(() -> {
                try {
                    body.run();
                } catch (IOException ignored) {
                }
            });
            thread.setDaemon(true);
            thread.start();
        }

        private static BufferedReader reader(final java.io.InputStream stream) {
            return new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        }
    }
}
