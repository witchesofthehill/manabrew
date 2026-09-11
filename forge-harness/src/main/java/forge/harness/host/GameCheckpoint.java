package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.game.Game;
import forge.game.GameStage;
import forge.game.GameState;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * A running game as text that another host can continue from. Forge's dev-mode
 * {@link GameState} carries the board; the sidecar carries what it does not:
 * eliminated seats, commander tax and damage, the monarch, the initiative and
 * day/night. Taken only at a clean point, so the stack and combat never need
 * carrying. Everything in it is hidden information: libraries in order, every
 * hand. It travels host to host only.
 */
final class GameCheckpoint {
    static final int VERSION = 1;

    private GameCheckpoint() {
    }

    /**
     * GameState.applyToGame defers through GameAction.invoke, which only runs
     * inline on a thread named {@code Game*}. The harness game thread is not,
     * so the deferred form races the engine. Apply directly, on the game thread.
     */
    private static final class DirectGameState extends GameState {
        void applyNow(final Game game) {
            applyGameOnThread(game);
        }
    }

    static boolean atCleanPoint(final Game game) {
        return game.getAge() == GameStage.Play
                && !game.isGameOver()
                && game.getPhaseHandler().getPhase() == PhaseType.MAIN1
                && game.getCombat() == null
                && game.getStack().isEmpty()
                && !game.getStack().hasSimultaneousStackEntries();
    }

    static String export(final Game game, final int seq) {
        final GameState state = new GameState();
        state.initFromGame(game);
        final List<Player> seats = game.getRegisteredPlayers();
        final JsonObject root = new JsonObject();
        root.addProperty("version", VERSION);
        root.addProperty("seq", seq);
        root.addProperty("turn", game.getPhaseHandler().getTurn());
        root.addProperty("activePlayer", seats.indexOf(game.getPhaseHandler().getPlayerTurn()));
        root.addProperty("state", state.toString());
        final JsonArray players = new JsonArray();
        for (final Player seat : seats) {
            final JsonObject entry = new JsonObject();
            entry.addProperty("eliminated", seat.hasLost());
            final JsonObject cast = new JsonObject();
            for (final Card commander : seat.getCommanders()) {
                cast.addProperty(commander.getName(), seat.getCommanderCast(commander));
            }
            entry.add("commanderCast", cast);
            final JsonArray damage = new JsonArray();
            for (final Map.Entry<Card, Integer> dealt : seat.getCommanderDamage()) {
                final Card commander = dealt.getKey();
                final int owner = seats.indexOf(commander.getOwner());
                if (owner < 0 || dealt.getValue() <= 0) {
                    continue;
                }
                final JsonObject hit = new JsonObject();
                hit.addProperty("owner", owner);
                hit.addProperty("commander", commander.getName());
                hit.addProperty("damage", dealt.getValue());
                damage.add(hit);
            }
            entry.add("commanderDamage", damage);
            players.add(entry);
        }
        root.add("players", players);
        root.addProperty("monarch", seats.indexOf(game.getMonarch()));
        root.addProperty("initiative", seats.indexOf(game.getHasInitiative()));
        if (game.getDayTime() != null) {
            root.addProperty("dayTime", game.getDayTime());
        }
        return root.toString();
    }

    static final class Restore {
        private final JsonObject root;
        private final DirectGameState state;
        private final boolean[] eliminated;

        private Restore(final JsonObject root, final DirectGameState state, final boolean[] eliminated) {
            this.root = root;
            this.state = state;
            this.eliminated = eliminated;
        }

        int turn() {
            return root.get("turn").getAsInt();
        }

        int survivors() {
            int alive = 0;
            for (final boolean gone : eliminated) {
                if (!gone) {
                    alive++;
                }
            }
            return alive;
        }
    }

    static Restore parse(final String json, final int seatCount) {
        final JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        final int version = root.has("version") ? root.get("version").getAsInt() : 0;
        if (version != VERSION) {
            throw new IllegalArgumentException("checkpoint version " + version + " is not " + VERSION);
        }
        final JsonArray players = root.getAsJsonArray("players");
        if (players == null || players.size() != seatCount) {
            throw new IllegalArgumentException("checkpoint has " + (players == null ? 0 : players.size())
                    + " seats, game has " + seatCount);
        }
        final boolean[] eliminated = new boolean[seatCount];
        for (int i = 0; i < seatCount; i++) {
            final JsonObject entry = players.get(i).getAsJsonObject();
            eliminated[i] = entry.has("eliminated") && entry.get("eliminated").getAsBoolean();
        }
        final DirectGameState state = new DirectGameState();
        state.parse(Arrays.asList(root.get("state").getAsString().split("\n")));
        return new Restore(root, state, eliminated);
    }

    static void apply(final Game game, final Restore restore) {
        final List<Player> seats = game.getRegisteredPlayers();
        for (int i = 0; i < seats.size(); i++) {
            if (restore.eliminated[i]) {
                seats.get(i).concede();
            }
        }
        game.getAction().checkGameOverCondition();
        if (game.getPlayers().size() != restore.survivors()) {
            throw new IllegalStateException("checkpoint expects " + restore.survivors()
                    + " seats in play, game has " + game.getPlayers().size());
        }
        restore.state.applyNow(game);

        final JsonArray players = restore.root.getAsJsonArray("players");
        for (int i = 0; i < seats.size(); i++) {
            final Player seat = seats.get(i);
            final JsonObject entry = players.get(i).getAsJsonObject();
            final JsonObject cast = entry.getAsJsonObject("commanderCast");
            for (final Card commander : seat.getCommanders()) {
                final JsonElement count = cast == null ? null : cast.get(commander.getName());
                for (int n = count == null ? 0 : count.getAsInt(); n > 0; n--) {
                    seat.incCommanderCast(commander);
                }
            }
            final JsonArray damage = entry.getAsJsonArray("commanderDamage");
            for (final JsonElement hitValue : damage == null ? new JsonArray() : damage) {
                final JsonObject hit = hitValue.getAsJsonObject();
                final Card commander = commanderNamed(
                        seats.get(hit.get("owner").getAsInt()), hit.get("commander").getAsString());
                if (commander != null) {
                    seat.addCommanderDamage(commander, hit.get("damage").getAsInt());
                }
            }
        }
        final int monarch = restore.root.get("monarch").getAsInt();
        if (monarch >= 0) {
            seats.get(monarch).createMonarchEffect(null);
            game.setMonarch(seats.get(monarch));
        }
        final int initiative = restore.root.get("initiative").getAsInt();
        if (initiative >= 0) {
            seats.get(initiative).createInitiativeEffect(null);
            game.setHasInitiative(seats.get(initiative));
        }
        if (restore.root.has("dayTime")) {
            game.setDayTime(restore.root.get("dayTime").getAsBoolean());
        }
    }

    private static Card commanderNamed(final Player owner, final String name) {
        for (final Card commander : new ArrayList<>(owner.getCommanders())) {
            if (commander.getName().equals(name)) {
                return commander;
            }
        }
        return null;
    }
}
