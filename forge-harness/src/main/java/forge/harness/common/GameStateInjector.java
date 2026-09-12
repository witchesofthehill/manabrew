package forge.harness.common;

import forge.game.Game;
import forge.game.GameState;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

/**
 * Loads a Forge dev-mode game-state file into a running game.
 *
 * <p>The format is Forge's own, written by {@code IDevModeCheats.dumpGameState} and read by
 * {@code setupGameState}: {@code humanbattlefield=}, {@code aihand=}, {@code turn=},
 * {@code activeplayer=}, {@code activephase=}, one {@code name;name} list per zone.
 * {@link GameState} lives in forge-game, so this needs nothing from the GUI.
 *
 * <p>Both entry points are opt-in through system properties, so a normal parity or host run never
 * reaches them.
 */
public final class GameStateInjector {
    private static final String STATE_PROPERTY = "harness.state.file";
    private static final String SCANS_PROPERTY = "harness.state.benchScans";
    private static final String DUMP_AFTER_PROPERTY = "harness.state.dumpAfterScans";
    private static final String DUMP_FILE_PROPERTY = "harness.state.dumpFile";

    private static int liveScans;

    private static boolean applied;

    private GameStateInjector() {}

    /**
     * GameState.applyToGame defers through GameAction.invoke. Callers here are already on the game
     * thread, where the deferred form has not taken effect by the time they look at the board.
     */
    private static final class DirectGameState extends GameState {
        void applyNow(final Game game) {
            applyGameOnThread(game);
        }
    }

    public static void applyFromFile(final Game game, final Path file) throws Exception {
        final DirectGameState state = new DirectGameState();
        state.parse(Files.readAllLines(file));
        state.applyNow(game);
    }

    /**
     * Applies the configured state once, at the first priority window that reaches this hook. With
     * {@code harness.state.benchScans} it then times that many action-space scans over the injected
     * board and exits: scan cost is superlinear in board size and hand size, and a bot will not
     * assemble a stated late-game board on demand.
     */
    /**
     * Times a scan on the live, aged game and writes the state out, so the same board can be
     * reloaded into a fresh process. A board snapshot does not carry timestamps, registered
     * triggers or layered effects, so aged and fresh are not the same engine state.
     */
    public static void maybeDump(final Game game, final Player player) {
        final int after = Integer.getInteger(DUMP_AFTER_PROPERTY, 0);
        if (after <= 0 || ++liveScans != after) {
            return;
        }
        final long start = System.nanoTime();
        final List<SpellAbility> possible = ActionSpace.getPossibleActions(player, true, true);
        final double ms = (System.nanoTime() - start) / 1_000_000.0;
        int permanents = 0;
        for (final Player p : game.getPlayers()) {
            permanents += p.getCardsIn(ZoneType.Battlefield).size();
        }
        System.err.printf("[harness] AGED scans=%d permanents=%d hand=%d actions=%d scan=%.1fms%n",
                after, permanents, player.getCardsIn(ZoneType.Hand).size(), possible.size(), ms);
        final String out = System.getProperty(DUMP_FILE_PROPERTY);
        if (out != null && !out.isBlank()) {
            try {
                final GameState dumped = new GameState();
                dumped.initFromGame(game);
                Files.writeString(Path.of(out), dumped.toString());
                System.err.println("[harness] dumped aged state to " + out);
            } catch (final Exception error) {
                System.err.println("[harness] dump failed: " + error);
            }
        }
        System.exit(0);
    }

    public static void maybeApply(final Game game, final Player player) {
        final String file = System.getProperty(STATE_PROPERTY);
        if (file == null || file.isBlank() || applied) {
            return;
        }
        applied = true;
        try {
            applyFromFile(game, Path.of(file));
        } catch (final Exception error) {
            System.err.println("[harness] failed to apply game state " + file + ": " + error);
            System.exit(2);
        }

        final int scans = Integer.getInteger(SCANS_PROPERTY, 0);
        if (scans > 0) {
            benchmark(game, player, scans);
        }
    }

    private static void benchmark(final Game game, final Player player, final int scans) {
        int actions = 0;
        final long[] elapsed = new long[scans];
        for (int i = 0; i < scans; i++) {
            final long start = System.nanoTime();
            final List<SpellAbility> possible = ActionSpace.getPossibleActions(player, true, true);
            elapsed[i] = System.nanoTime() - start;
            actions = possible.size();
        }
        Arrays.sort(elapsed);

        int permanents = 0;
        for (final Player p : game.getPlayers()) {
            permanents += p.getCardsIn(ZoneType.Battlefield).size();
        }
        System.err.printf(
                "[harness] BENCH permanents=%d hand=%d actions=%d scans=%d median=%.1fms max=%.1fms%n",
                permanents,
                player.getCardsIn(ZoneType.Hand).size(),
                actions,
                scans,
                elapsed[scans / 2] / 1_000_000.0,
                elapsed[scans - 1] / 1_000_000.0);
        System.exit(0);
    }
}
