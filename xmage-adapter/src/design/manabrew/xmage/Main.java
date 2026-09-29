package design.manabrew.xmage;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import mage.cards.decks.DeckCardLists;
import mage.constants.*;
import mage.game.match.MatchOptions;
import mage.interfaces.MageClient;
import mage.interfaces.callback.ClientCallback;
import mage.players.PlayerType;
import mage.players.net.UserData;
import mage.remote.Connection;
import mage.remote.SessionImpl;
import mage.utils.MageVersion;
import mage.view.TableClientMessage;
import mage.view.TableView;
import org.apache.log4j.*;

public final class Main implements MageClient {
    static final Gson JSON = new Gson();
    private final PrintStream output;
    private final SessionImpl session = new mage.remote.SerializedSession(this);
    private final ExecutorService callbacks = Executors.newSingleThreadExecutor();
    private final PromptBridge bridge;

    Main(PrintStream output) {
        this.output = output;
        bridge = new PromptBridge(session, this::event);
    }

    public static void main(String[] args) throws Exception {
        PrintStream output = System.out;
        System.setOut(System.err);
        BasicConfigurator.configure(new ConsoleAppender(new PatternLayout("%p %m%n"), "System.err"));
        Logger.getRootLogger().setLevel(Level.WARN);
        Main client = new Main(output);
        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                client.request(line);
            }
        } finally {
            client.session.connectStop(false, false);
            client.callbacks.shutdownNow();
        }
        System.exit(0);
    }

    private void request(String line) {
        JsonElement id = JsonNull.INSTANCE;
        try {
            JsonObject request = JsonParser.parseString(line).getAsJsonObject();
            id = request.get("id");
            if (id == null || !(id.isJsonPrimitive()) || !"2.0".equals(request.get("jsonrpc").getAsString())) {
                throw new IllegalArgumentException("Expected JSON-RPC 2.0 request with an id");
            }
            JsonObject params = request.has("params") ? request.getAsJsonObject("params") : new JsonObject();
            Object result = dispatch(request.get("method").getAsString(), params);
            JsonObject response = object("jsonrpc", "2.0");
            response.add("id", id);
            response.add("result", JSON.toJsonTree(result));
            write(response);
        } catch (Exception error) {
            JsonObject response = object("jsonrpc", "2.0");
            response.add("id", id == null ? JsonNull.INSTANCE : id);
            JsonObject detail = object("message", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            detail.addProperty("code", -32000);
            response.add("error", detail);
            write(response);
        }
    }

    private Object dispatch(String method, JsonObject params) {
        if (method.equals("connect")) {
            Connection connection = new Connection();
            connection.setHost(params.get("host").getAsString());
            connection.setPort(params.get("port").getAsInt());
            connection.setUsername(params.get("username").getAsString());
            connection.setPassword(params.has("password") ? params.get("password").getAsString() : "");
            connection.setProxyType(Connection.ProxyType.NONE);
            UserData preferences = UserData.getDefaultUserDataView();
            if (params.has("autoSpendMana") && !params.get("autoSpendMana").getAsBoolean()) {
                preferences.setManaPoolAutomatic(false);
                preferences.setManaPoolAutomaticRestricted(false);
            }
            connection.setUserData(preferences);
            connection.setUserIdStr(UUID.randomUUID().toString());
            require(session.connectStart(connection), "XMage connection failed");
            return object("version", session.getVersionInfo());
        }
        if (!session.isConnected()) throw new IllegalStateException("Not connected");
        switch (method) {
            case "createTable": {
                MatchOptions options = new MatchOptions("ManaBrew protocol audit", "Two Player Duel", true);
                options.getPlayerTypes().add(PlayerType.HUMAN);
                options.getPlayerTypes().add(PlayerType.HUMAN);
                String deckType = params.has("deckType") ? params.get("deckType").getAsString() : "Constructed - Legacy";
                if (!java.util.Arrays.asList(session.getDeckTypes()).contains(deckType)) throw new IllegalArgumentException("Unknown deck type: " + deckType);
                options.setDeckType(deckType);
                options.setAttackOption(MultiplayerAttackOption.MULTIPLE);
                options.setRange(RangeOfInfluence.ALL);
                options.setWinsNeeded(1);
                options.setMatchTimeLimit(MatchTimeLimit.MIN__15);
                TableView table = session.createTable(session.getMainRoomId(), options);
                if (table == null) throw new IllegalStateException("XMage did not create table");
                return object("tableId", table.getTableId().toString());
            }
            case "joinTable":
                require(session.joinTable(session.getMainRoomId(), uuid(params, "tableId"), session.getUserName(),
                        PlayerType.HUMAN, 1, JSON.fromJson(params.get("deck"), DeckCardLists.class), ""), "Join rejected");
                return true;
            case "startMatch":
                require(session.startMatch(session.getMainRoomId(), uuid(params, "tableId")), "Start rejected");
                return true;
            case "joinGame":
                require(session.joinGame(uuid(params, "gameId")), "Join game rejected");
                return true;
            case "respond":
                bridge.respond(params);
                return true;
            case "concede":
                require(session.sendPlayerAction(PlayerAction.CONCEDE, uuid(params, "gameId"), null), "Concede rejected");
                return true;
            case "removeTable":
                require(session.removeTable(session.getMainRoomId(), uuid(params, "tableId")), "Remove rejected");
                return true;
            default:
                throw new IllegalArgumentException("Unknown method: " + method);
        }
    }

    @Override
    public void onCallback(ClientCallback callback) {
        callback.decompressData();
        callbacks.execute(() -> {
            try {
                if (callback.getData() instanceof TableClientMessage && callback.getMethod().name().equals("START_GAME")) {
                    TableClientMessage start = (TableClientMessage) callback.getData();
                    JsonObject data = object("gameId", start.getGameId().toString());
                    data.addProperty("playerId", start.getPlayerId().toString());
                    event("gameStarted", data);
                }
                bridge.accept(callback);
            } catch (Exception error) {
                bridge.invalidate();
                event("adapterError", object("message", error.toString()));
            }
        });
    }

    synchronized void event(String method, JsonObject params) {
        JsonObject notification = object("jsonrpc", "2.0");
        notification.addProperty("method", method);
        notification.add("params", params);
        write(notification);
    }

    private synchronized void write(JsonObject message) {
        output.println(JSON.toJson(message));
        output.flush();
    }

    static JsonObject object(String key, String value) {
        JsonObject object = new JsonObject();
        object.addProperty(key, value);
        return object;
    }

    static UUID uuid(JsonObject object, String key) {
        return UUID.fromString(object.get(key).getAsString());
    }

    static void require(boolean success, String message) {
        if (!success) throw new IllegalStateException(message);
    }

    @Override public MageVersion getVersion() { return new MageVersion(MageClient.class); }
    @Override public void onNewConnection() { bridge.invalidate(); }
    @Override public void connected(String message) { event("connected", object("message", message)); }
    @Override public void disconnected(boolean reconnect, boolean keepSession) { bridge.invalidate(); event("disconnected", new JsonObject()); }
    @Override public void showMessage(String message) { event("message", object("message", message)); }
    @Override public void showError(String message) { event("serverError", object("message", message)); }
}
