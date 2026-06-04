package forge.harness.parity;

import forge.harness.common.CountingRandom;

import forge.LobbyPlayer;
import forge.game.Game;
import forge.game.player.IGameEntitiesFactory;
import forge.game.player.Player;
import forge.game.player.PlayerController;

/**
 * A LobbyPlayer that creates {@link DeterministicController} instances
 * for cross-engine parity testing. Both controllers share the same
 * {@link CountingRandom} instance so that decision RNG consumption is identical
 * to the Rust side.
 */
public class DeterministicLobbyPlayer extends LobbyPlayer implements IGameEntitiesFactory {

    /** Shared RNG for agent decisions — same instance across both players. */
    private final CountingRandom rng;
    private final boolean preferActions;
    private final boolean deep;
    /** Turns for which verbose callback logging is active. Empty = all, null = off. */
    private final int[] verboseTurns;

    public DeterministicLobbyPlayer(String name, CountingRandom rng, boolean preferActions, boolean deep) {
        this(name, rng, preferActions, deep, null);
    }

    public DeterministicLobbyPlayer(String name, CountingRandom rng, boolean preferActions, boolean deep, int[] verboseTurns) {
        super(name);
        this.rng = rng;
        this.preferActions = preferActions;
        this.deep = deep;
        this.verboseTurns = verboseTurns;
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player p = new Player(getName(), game, id);
        p.setFirstController(new DeterministicController(game, p, this, rng, preferActions, deep, verboseTurns));
        return p;
    }

    @Override
    public PlayerController createMindSlaveController(Player master, Player slave) {
        return new DeterministicController(slave.getGame(), slave, this, rng, preferActions, deep, verboseTurns);
    }

    @Override
    public void hear(LobbyPlayer player, String message) {
        // Headless — ignore all messages.
    }
}
