package forge.harness.host;

import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.player.PlayerController;
import forge.game.spellability.SpellAbility;

import java.util.List;

public final class ManaBrewAiLobbyPlayer extends LobbyPlayerAi {
    private final ManaBrewInteractiveSession session;

    public ManaBrewAiLobbyPlayer(final String name, final ManaBrewInteractiveSession session) {
        super(name, null);
        this.session = session;
    }

    @Override
    public PlayerController createMindSlaveController(final Player master, final Player slave) {
        return new Controller(slave, this, session);
    }

    @Override
    public Player createIngamePlayer(final Game game, final int id) {
        final Player player = new Player(getName(), game, id);
        player.setFirstController(new Controller(player, this, session));
        return player;
    }

    private static final class Controller extends PlayerControllerAi {
        private final ManaBrewInteractiveSession session;

        private Controller(final Player player, final ManaBrewAiLobbyPlayer lobbyPlayer,
                final ManaBrewInteractiveSession session) {
            super(player.getGame(), player, lobbyPlayer);
            this.session = session;
        }

        @Override
        public List<SpellAbility> chooseSpellAbilityToPlay() {
            if (session.actionRepeat().passesDuringReplay(getPlayer())) {
                return null;
            }
            return super.chooseSpellAbilityToPlay();
        }
    }
}
