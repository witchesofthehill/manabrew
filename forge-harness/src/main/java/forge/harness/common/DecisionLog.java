package forge.harness.common;

import com.google.gson.Gson;
import forge.game.Game;
import forge.game.player.Player;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public final class DecisionLog {
    private static final Gson GSON = new Gson();
    private static Consumer<String> sink = s -> {};
    private static boolean deep = false;

    private DecisionLog() {}

    public static void setSink(Consumer<String> out, boolean deepEnabled) {
        sink = (out == null) ? (s -> {}) : out;
        deep = deepEnabled;
    }

    public static void logCheckpoint(final Player decidingPlayer, final String kind) {
        if (!deep || decidingPlayer == null) {
            return;
        }
        logChoice(decidingPlayer, kind, List.of(), "CALLBACK_ENTRY");
        sink.accept(SnapshotExtractor.snapshotJson(decidingPlayer.getGame()));
    }

    public static void logSnapshot(final Game game) {
        if (game == null) {
            return;
        }
        sink.accept(SnapshotExtractor.snapshotJson(game));
    }

    public static void logMainAction(
            final Player decidingPlayer,
            final List<String> options,
            final String choice
    ) {
        logChoice(decidingPlayer, "main_action", options, choice);
    }

    public static void logCallback(
            final Player decidingPlayer,
            final String kind,
            final String outcome,
            final List<String> args,
            final String... callbackArgs
    ) {
        if (decidingPlayer == null) {
            return;
        }
        final Map<String, Object> row = new LinkedHashMap<>();
        row.put("event", "callback");
        row.put("turn", decidingPlayer.getGame().getPhaseHandler().getTurn());
        row.put("phase", SnapshotExtractor.phaseToRustName(decidingPlayer.getGame().getPhaseHandler().getPhase()));
        row.put("player", decidingPlayer.getId());
        row.put("name", kind);
        row.put("outcome", outcome);
        row.put("args", new ArrayList<>(args == null ? List.of() : args));
        if (callbackArgs != null && callbackArgs.length > 0) {
            row.put("callback_args", List.of(callbackArgs));
        }
        row.put("timestamp_ms", System.currentTimeMillis());
        sink.accept(GSON.toJson(row));
    }

    public static void logChoice(
            final Player decidingPlayer,
            final String kind,
            final List<String> options,
            final String choice
    ) {
        if (decidingPlayer == null) {
            return;
        }
        final Map<String, Object> row = new LinkedHashMap<>();
        row.put("event", "decision");
        row.put("turn", decidingPlayer.getGame().getPhaseHandler().getTurn());
        row.put("phase", SnapshotExtractor.phaseToRustName(decidingPlayer.getGame().getPhaseHandler().getPhase()));
        row.put("deciding_player", decidingPlayer.getId());
        row.put("kind", kind);
        row.put("options", new ArrayList<>(options));
        row.put("choice", choice);
        row.put("timestamp_ms", System.currentTimeMillis());
        sink.accept(GSON.toJson(row));
    }
}
