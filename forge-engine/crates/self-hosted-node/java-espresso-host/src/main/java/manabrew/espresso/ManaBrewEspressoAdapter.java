package manabrew.espresso;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Value;

/**
 * Host-side router mirroring {@code forge.harness.ManaBrewEngineAdapter}'s JSON
 * string API, but giving each session its own Espresso guest context. Forge's
 * process-global statics (MyRandom, the maxId counters) are per-context, so
 * concurrent sessions no longer clobber each other.
 *
 * <p>The host JVM must be a GraalVM JDK with the Espresso polyglot runtime on its
 * classpath. The guest classpath (the Forge harness jar) is supplied via the
 * {@code manabrew.guest.classpath} system property.
 */
public final class ManaBrewEspressoAdapter {
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final String guestClasspath;
    private volatile String assetsDir;

    public ManaBrewEspressoAdapter() {
        this.guestClasspath = System.getProperty("manabrew.guest.classpath");
        if (guestClasspath == null || guestClasspath.isBlank()) {
            throw new IllegalStateException(
                    "manabrew.guest.classpath system property is required");
        }
    }

    public synchronized void initialize(final String assetsDir) {
        if (assetsDir == null || assetsDir.isBlank()) {
            throw new IllegalArgumentException("assetsDir is required");
        }
        this.assetsDir = assetsDir;
    }

    public String startGameJson(final String requestJson) {
        if (assetsDir == null) {
            throw new IllegalStateException("router must be initialized before starting games");
        }
        final Context context = Context.newBuilder("java")
                .allowAllAccess(true)
                .option("java.Classpath", guestClasspath)
                .build();
        final Value adapter = context.getBindings("java")
                .getMember("forge.harness.ManaBrewEngineAdapter")
                .newInstance();
        adapter.invokeMember("initialize", assetsDir);
        final String response = adapter.invokeMember("startGameJson", requestJson).asString();
        sessions.put(sessionId(response), new Session(context, adapter));
        return response;
    }

    public String submitAction(final String sessionId, final String actionJson) {
        return require(sessionId).adapter.invokeMember("submitAction", sessionId, actionJson)
                .asString();
    }

    public String getPrompt(final String sessionId, final int playerIndex) {
        return require(sessionId).adapter.invokeMember("getPrompt", sessionId, playerIndex)
                .asString();
    }

    public String getSnapshot(final String sessionId) {
        return require(sessionId).adapter.invokeMember("getSnapshot", sessionId).asString();
    }

    public String getGameOver(final String sessionId) {
        return require(sessionId).adapter.invokeMember("getGameOver", sessionId).asString();
    }

    public String endGameJson(final String sessionId) {
        final Session session = sessions.remove(sessionId);
        if (session == null) {
            return "{\"sessionId\":\"" + sessionId + "\",\"ended\":true}";
        }
        try {
            return session.adapter.invokeMember("endGameJson", sessionId).asString();
        } finally {
            session.context.close(true);
        }
    }

    private Session require(final String sessionId) {
        final Session session = sessions.get(sessionId);
        if (session == null) {
            throw new IllegalArgumentException("unknown sessionId: " + sessionId);
        }
        return session;
    }

    private static String sessionId(final String startGameResponse) {
        final String key = "\"sessionId\"";
        final int k = startGameResponse.indexOf(key);
        if (k < 0) {
            throw new IllegalStateException("startGame response missing sessionId: "
                    + startGameResponse);
        }
        final int open = startGameResponse.indexOf('"', k + key.length() + 1);
        final int close = startGameResponse.indexOf('"', open + 1);
        if (open < 0 || close < 0) {
            throw new IllegalStateException("malformed sessionId in: " + startGameResponse);
        }
        return startGameResponse.substring(open + 1, close);
    }

    private static final class Session {
        final Context context;
        final Value adapter;

        Session(final Context context, final Value adapter) {
            this.context = context;
            this.adapter = adapter;
        }
    }
}
