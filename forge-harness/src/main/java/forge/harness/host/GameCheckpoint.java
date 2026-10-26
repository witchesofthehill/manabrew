package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import forge.localinstance.properties.ForgePreferences;
import forge.model.FModel;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.TreeMap;

final class GameCheckpoint {
    private static final long STEP_TIMEOUT_NANOS = 30_000_000_000L;

    private GameCheckpoint() {}

    static JsonObject verification(final ManaBrewInteractiveSession session, final ReplayRandom rng) {
        final JsonObject state = new JsonObject();
        final JsonArray views = new JsonArray();
        for (int seat = -1; seat < session.getGame().getRegisteredPlayers().size(); seat++) {
            final JsonObject view = session.verificationView(seat);
            view.remove("checkpoints");
            view.remove("restoreVote");
            view.remove("snapshotRecording");
            view.remove("decisionHistory");
            views.add(view);
        }
        state.add("views", views);
        final JsonArray zones = new JsonArray();
        for (final Player player : session.getGame().getRegisteredPlayers()) {
            for (final ZoneType zone : ZoneType.values()) {
                final JsonArray cards = new JsonArray();
                for (final Card card : player.getCardsIn(zone)) {
                    final JsonObject identity = new JsonObject();
                    identity.addProperty("id", card.getId());
                    identity.addProperty("name", card.getName());
                    identity.addProperty("foil", card.getPaperCard() != null && card.getPaperCard().isFoil());
                    identity.addProperty("state", card.getCurrentStateName().name());
                    identity.addProperty("paper", card.getPaperCard() == null ? "" :
                            card.getPaperCard().getName() + "|" + card.getPaperCard().getEdition()
                                    + "|" + card.getPaperCard().getCollectorNumber());
                    cards.add(identity);
                }
                zones.add(cards);
            }
        }
        state.add("zones", zones);
        final JsonObject verification = new JsonObject();
        verification.addProperty("state", digest(canonical(state).toString().getBytes(StandardCharsets.UTF_8)));
        verification.addProperty("rng", rng.position());
        return verification;
    }

    static String capture(final ManaBrewInteractiveSession session, final String start,
            final long nextSequence, final JsonObject history) {
        final JsonObject snapshot = new JsonObject();
        snapshot.addProperty("version", 1);
        snapshot.addProperty("nextSequence", nextSequence);
        if (history != null) {
            validateHistory(history);
            if (!start.equals(history.get("startRequest").getAsString())
                    || history.getAsJsonArray("entries").size() != nextSequence - 1) {
                throw new IllegalArgumentException("snapshot history does not reach this decision boundary");
            }
            snapshot.add("journal", history.deepCopy());
        }
        snapshot.add("prompt", JsonParser.parseString(session.getLatestPromptJson()));
        snapshot.add("verification", session.replayVerification());
        return snapshot.toString();
    }

    static String withIdentity(final String snapshot, final String identity) {
        final JsonObject root = JsonParser.parseString(snapshot).getAsJsonObject();
        root.addProperty("identity", identity);
        return root.toString();
    }

    static String restore(final ManaBrewEngineAdapter adapter, final String json) {
        final JsonObject snapshot = JsonParser.parseString(json).getAsJsonObject();
        if (snapshot.get("version").getAsInt() != 1
                || !adapter.replayIdentity().equals(snapshot.get("identity").getAsString())) {
            throw new IllegalArgumentException("replay snapshot version or engine/assets/preferences identity mismatch");
        }
        final JsonObject history = snapshot.getAsJsonObject("journal");
        validateHistory(history);
        if (new java.math.BigDecimal(snapshot.get("nextSequence").getAsString()).longValueExact()
                != (long) history.getAsJsonArray("entries").size() + 1) {
            throw new IllegalArgumentException("snapshot boundary does not match journal length");
        }
        final String start = history.get("startRequest").getAsString();
        final String sessionId = JsonParser.parseString(start).getAsJsonObject().get("gameId").getAsString();
        final String handle = adapter.startGameJson(start);
        try {
            final JsonObject manifest = JsonParser.parseString(adapter.readDecisionJournal(sessionId)).getAsJsonObject();
            if (!start.equals(manifest.get("startRequest").getAsString())) {
                throw new IllegalStateException("replay manifest mismatch");
            }
            adapter.acknowledgeDecisionJournal(sessionId, 0);
            for (final JsonElement value : history.getAsJsonArray("entries")) {
                final JsonObject entry = value.getAsJsonObject();
                final long sequence = entry.get("sequence").getAsLong();
                // Queue the snapshot read behind the previous action on the game thread.
                // A directive can consume input without replacing the pending prompt.
                final JsonObject before = JsonParser.parseString(adapter.replayBoundary(sessionId)).getAsJsonObject();
                if (before.get("nextSequence").getAsLong() != sequence) {
                    throw new IllegalStateException("replay boundary sequence mismatch");
                }
                requireEqual(entry.get("prompt"), before.get("prompt"), "prompt", sequence);
                requireEqual(entry.get("verification"), before.get("verification"), "state/RNG", sequence);
                adapter.submitAction(sessionId, entry.get("action").toString());
                final long deadline = System.nanoTime() + STEP_TIMEOUT_NANOS;
                JsonObject batch;
                while (true) {
                    final String raw = adapter.readDecisionJournal(sessionId);
                    if (!raw.isEmpty()) {
                        batch = JsonParser.parseString(raw).getAsJsonObject();
                        if (batch.has("unavailableReason") || !batch.getAsJsonArray("entries").isEmpty()) break;
                    }
                    awaitProgress(adapter, sessionId, deadline, sequence);
                }
                final JsonArray expected = new JsonArray();
                expected.add(entry);
                requireEqual(expected, batch.get("entries"), "consumption", sequence);
                adapter.acknowledgeDecisionJournal(sessionId, sequence);
            }
            final JsonObject actual = JsonParser.parseString(adapter.exportReplaySnapshot(sessionId, history.toString())).getAsJsonObject();
            requireEqual(snapshot.get("prompt"), actual.get("prompt"), "terminal prompt", history.getAsJsonArray("entries").size());
            requireEqual(snapshot.get("verification"), actual.get("verification"), "terminal state/RNG", history.getAsJsonArray("entries").size());
            return handle;
        } catch (RuntimeException error) {
            adapter.endGame(sessionId);
            throw error;
        }
    }

    static void validateHistory(final JsonObject history) {
        if (history.get("version").getAsInt() != 2 || history.has("unavailableReason")) {
            throw new IllegalArgumentException("unsupported or invalidated decision journal");
        }
        final JsonObject start = JsonParser.parseString(history.get("startRequest").getAsString()).getAsJsonObject();
        if (!start.has("decisionJournal") || !start.get("decisionJournal").getAsBoolean()) {
            throw new IllegalArgumentException("snapshot requires a journaled start");
        }
        long sequence = 0;
        for (final JsonElement value : history.getAsJsonArray("entries")) {
            final JsonObject entry = value.getAsJsonObject();
            if (new java.math.BigDecimal(entry.get("sequence").getAsString()).longValueExact() != ++sequence
                    || !entry.has("verification") || !entry.has("prompt") || !entry.has("action")) {
                throw new IllegalArgumentException("invalid journal entry at decision " + sequence);
            }
            final int player = new java.math.BigDecimal(entry.get("playerIndex").getAsString()).intValueExact();
            if (player < 0 || !entry.getAsJsonObject("prompt").get("decidingPlayerId").getAsString().equals("player-" + player)) {
                throw new IllegalArgumentException("journal player mismatch at decision " + sequence);
            }
        }
    }

    static void requireEqual(final JsonElement expected, final JsonElement actual,
            final String kind, final long sequence) {
        if (expected == null || !expected.equals(actual)) {
            throw new IllegalStateException(kind + " divergence at decision " + sequence);
        }
    }

    private static void awaitProgress(final ManaBrewEngineAdapter adapter, final String sessionId,
            final long deadline, final long sequence) {
        if (Boolean.parseBoolean(adapter.getGameOver(sessionId)) || System.nanoTime() >= deadline) {
            throw new IllegalStateException("replay stopped at decision " + sequence);
        }
        try {
            Thread.sleep(1);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("replay interrupted", error);
        }
    }

    static String identity(final String assetsDir) {
        try {
            final MessageDigest hash = MessageDigest.getInstance("SHA-256");
            final Path engine = Path.of(GameCheckpoint.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            final Path forgeArtifact = Path.of(forge.game.Game.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            if (!Files.isRegularFile(engine) || !engine.equals(forgeArtifact)) {
                throw new IllegalArgumentException("replay snapshots require the packaged harness jar");
            }
            hashTree(hash, engine);
            hashTree(hash, Path.of(assetsDir, "res"));
            for (final ForgePreferences.FPref pref : ForgePreferences.FPref.values()) {
                hash.update((pref.name() + "=" + FModel.getPreferences().getPref(pref) + "\n").getBytes(StandardCharsets.UTF_8));
            }
            return HexFormat.of().formatHex(hash.digest());
        } catch (Exception error) {
            throw new IllegalStateException("cannot identify replay engine", error);
        }
    }

    private static void hashTree(final MessageDigest hash, final Path root) throws Exception {
        try (final var paths = Files.walk(root)) {
            for (final Path path : paths.sorted().toList()) {
                if (Files.isSymbolicLink(path)) throw new IllegalArgumentException("replay assets must not contain symlinks");
                if (!Files.isRegularFile(path)) continue;
                final byte[] name = root.relativize(path).toString().replace('\\', '/').getBytes(StandardCharsets.UTF_8);
                hash.update(java.nio.ByteBuffer.allocate(4).putInt(name.length).array());
                hash.update(name);
                final MessageDigest content = MessageDigest.getInstance("SHA-256");
                try (final var input = Files.newInputStream(path)) {
                    final byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) content.update(buffer, 0, count);
                }
                hash.update(content.digest());
            }
        }
    }

    private static String digest(final byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static JsonElement canonical(final JsonElement value) {
        if (value.isJsonObject()) {
            final TreeMap<String, JsonElement> sorted = new TreeMap<>();
            value.getAsJsonObject().entrySet().forEach(entry -> sorted.put(entry.getKey(), canonical(entry.getValue())));
            final JsonObject object = new JsonObject();
            sorted.forEach(object::add);
            return object;
        }
        if (value.isJsonArray()) {
            final JsonArray array = new JsonArray();
            value.getAsJsonArray().forEach(entry -> array.add(canonical(entry)));
            return array;
        }
        return value;
    }
}
