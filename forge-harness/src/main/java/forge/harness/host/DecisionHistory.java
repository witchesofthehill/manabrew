package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;

final class DecisionHistory {
    private static final int MAX_BYTES = 64 * 1024 * 1024;
    private final String startRequest;
    private final JsonArray entries = new JsonArray();
    private JsonObject replay;
    private int replayIndex;
    private int bytes;
    private String unavailableReason;

    DecisionHistory(final String startRequest, final JsonObject replay) {
        this.startRequest = startRequest;
        this.replay = replay;
        bytes = startRequest.getBytes(StandardCharsets.UTF_8).length;
        if (replay != null) {
            final JsonObject history = replay.getAsJsonObject("journal");
            GameCheckpoint.validateHistory(history);
            if (!startRequest.equals(history.get("startRequest").getAsString())
                    || replay.get("nextSequence").getAsLong() != history.getAsJsonArray("entries").size() + 1L) {
                throw new IllegalArgumentException("rewind history does not match its boundary");
            }
        }
    }

    JsonObject replayAction(final String prompt, final JsonObject verification) {
        final JsonArray prefix = replay.getAsJsonObject("journal").getAsJsonArray("entries");
        final JsonObject boundary = replayIndex < prefix.size()
                ? prefix.get(replayIndex).getAsJsonObject() : replay;
        GameCheckpoint.requireEqual(boundary.get("prompt"), JsonParser.parseString(prompt), "prompt", replayIndex + 1L);
        GameCheckpoint.requireEqual(boundary.get("verification"), verification, "state/RNG", replayIndex + 1L);
        if (replayIndex == prefix.size()) { replay = null; return null; }
        replayIndex++;
        return boundary.getAsJsonObject("action");
    }

    void record(final int player, final String prompt, final JsonObject action, final JsonObject verification) {
        if (unavailableReason != null) return;
        final JsonObject entry = new JsonObject();
        entry.addProperty("sequence", entries.size() + 1);
        entry.addProperty("playerIndex", player);
        entry.add("prompt", JsonParser.parseString(prompt));
        entry.add("action", action.deepCopy());
        entry.add("verification", verification);
        final int size = entry.toString().getBytes(StandardCharsets.UTF_8).length;
        if (entries.size() >= 50000 || size > MAX_BYTES - bytes) {
            unavailableReason = "History recording reached its memory limit. Earlier decisions remain available.";
            return;
        }
        entries.add(entry);
        bytes += size;
    }

    int size() {
        return entries.size();
    }

    String unavailableReason() {
        return unavailableReason;
    }

    String rewind(final int sequence) {
        if (sequence < 1 || sequence > entries.size()) {
            throw new IllegalArgumentException("journal position is unavailable");
        }
        final JsonArray prefix = new JsonArray();
        for (int i = 0; i < sequence - 1; i++) prefix.add(entries.get(i));
        final JsonObject history = new JsonObject();
        history.addProperty("version", 2);
        history.addProperty("startRequest", startRequest);
        history.add("entries", prefix);
        final JsonObject target = entries.get(sequence - 1).getAsJsonObject();
        final JsonObject snapshot = new JsonObject();
        snapshot.addProperty("version", 1);
        snapshot.addProperty("nextSequence", sequence);
        snapshot.add("journal", history);
        snapshot.add("prompt", target.get("prompt"));
        snapshot.add("verification", target.get("verification"));
        return snapshot.toString();
    }

    static String description(final JsonObject action) {
        final String type = action.get("type").getAsString();
        final JsonObject output = action.has("output") && action.get("output").isJsonObject()
                ? action.getAsJsonObject("output") : new JsonObject();
        final String choice = output.has("type") ? output.get("type").getAsString() : "";
        return switch (type) {
            case "chooseAction" -> "pass".equals(choice) ? "Pass priority" : "Play an action";
            case "mulligan" -> output.has("keep") && output.get("keep").getAsBoolean() ? "Keep opening hand" : "Take a mulligan";
            case "mulliganPutBack" -> "Put cards back after mulligan";
            case "chooseAttackers" -> "Declare attackers";
            case "chooseBlockers" -> "Declare blockers";
            case "chooseBoardTargets" -> "Choose targets";
            case "payManaCost" -> "Pay mana";
            case "scry" -> "Scry decision";
            case "surveil" -> "Surveil decision";
            case "chooseCards" -> "Choose cards";
            case "chooseNumber" -> "Choose a number";
            case "chooseFromSelection" -> "Choose an option";
            case "chooseBoolean" -> "Confirm a choice";
            case "reorder" -> "Order cards or abilities";
            case "revealCards" -> "Acknowledge revealed cards";
            case "diceRolled" -> "Acknowledge dice roll";
            case "directive" -> "Game control";
            default -> "Make a choice";
        };
    }
}
