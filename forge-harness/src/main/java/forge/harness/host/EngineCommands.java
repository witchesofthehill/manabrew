package forge.harness.host;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

public final class EngineCommands {
    private EngineCommands() {}

    public static String execute(final ManaBrewEngineAdapter adapter, final String json) {
        final JsonObject request = JsonParser.parseString(json).getAsJsonObject();
        final String command = request.get("command").getAsString();
        final String session = request.has("sessionId") ? request.get("sessionId").getAsString() : "";
        return switch (command) {
            case "startGame" -> adapter.startGameJson(request.get("payload").getAsString());
            case "submitAction" -> adapter.submitAction(session, request.get("payload").getAsString());
            case "getPrompt" -> adapter.getPrompt(session, request.get("playerIndex").getAsInt());
            case "getSnapshot" -> adapter.getSnapshot(session, request.has("viewer") ? request.get("viewer").getAsInt() : -1);
            case "getGameOver" -> adapter.getGameOver(session);
            case "getStateRevision" -> adapter.getStateRevision(session);
            case "drainCheckpointMetrics" -> adapter.drainCheckpointMetrics(session);
            case "drainDirectives" -> adapter.drainDirectives(session);
            case "getRewindRequest" -> adapter.getRewindRequest(session);
            case "resumeAfterFailedRewind" -> adapter.resumeAfterFailedRewind(session);
            case "replayReady" -> adapter.replayReady(session);
            case "endGame", "abortGame" -> adapter.endGameJson(session);
            default -> throw new IllegalArgumentException("unsupported engine command: " + command);
        };
    }
}
