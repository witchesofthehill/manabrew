package manabrew.espresso;

import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Value;

/**
 * Host-side router mirroring {@code forge.harness.ManaBrewEngineAdapter}'s JSON
 * string API, but giving each session its own Espresso guest context. Forge's
 * process-global statics (MyRandom, the maxId counters) are per-context, so
 * concurrent sessions no longer clobber each other.
 *
 * <p>Each context serves exactly one game and is then closed — one context is one
 * game's blast radius. A background replenisher keeps a warm pool of pre-initialized
 * contexts ready, so {@code FModel.initialize} (~50 s) is paid off the hot path
 * rather than when a player starts a game.
 *
 * <p>In-place context reuse (run another game in the same context, avoiding even the
 * background init) is opt-in via {@code -Dmanabrew.espresso.reuse=true}. It is safe
 * only because {@code ManaBrewInteractiveSession.close()} now joins its game thread;
 * without that join a lingering thread corrupts the next game in the context. Default
 * is single-use (one context per game) for a clean crash blast radius.
 *
 * <p>The host JVM must be a GraalVM JDK with the Espresso polyglot runtime on its
 * classpath. The guest classpath (the Forge harness jar) is supplied via the
 * {@code manabrew.guest.classpath} system property.
 */
public final class ManaBrewEspressoAdapter {
    private final Map<String, Ctx> active = new ConcurrentHashMap<>();
    private final Deque<Ctx> warm = new ConcurrentLinkedDeque<>();
    private final Object replenishLock = new Object();
    private final String guestClasspath;
    private final boolean reuse;
    private volatile String assetsDir;
    private volatile int poolSize;
    private volatile boolean running = true;

    public ManaBrewEspressoAdapter() {
        this.guestClasspath = System.getProperty("manabrew.guest.classpath");
        if (guestClasspath == null || guestClasspath.isBlank()) {
            throw new IllegalStateException(
                    "manabrew.guest.classpath system property is required");
        }
        this.reuse = Boolean.getBoolean("manabrew.espresso.reuse");
    }

    public synchronized void initialize(final String assetsDir) {
        if (assetsDir == null || assetsDir.isBlank()) {
            throw new IllegalArgumentException("assetsDir is required");
        }
        this.assetsDir = assetsDir;
        this.poolSize = Integer.getInteger("manabrew.espresso.poolSize", 0);
        if (poolSize > 0) {
            startReplenisher();
        }
    }

    public String startGameJson(final String requestJson) {
        if (assetsDir == null) {
            throw new IllegalStateException("router must be initialized before starting games");
        }
        final Ctx ctx = acquire();
        final String response = ctx.adapter.invokeMember("startGameJson", requestJson).asString();
        active.put(sessionId(response), ctx);
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
        final Ctx ctx = active.remove(sessionId);
        if (ctx == null) {
            return "{\"sessionId\":\"" + sessionId + "\",\"ended\":true}";
        }
        try {
            return ctx.adapter.invokeMember("endGameJson", sessionId).asString();
        } finally {
            // The guest endGame joins the game thread (close() now blocks on it), so
            // the context is idle and safe to reuse; otherwise close for a clean
            // one-game-per-context blast radius.
            if (reuse) {
                warm.push(ctx);
            } else {
                ctx.context.close(true);
            }
        }
    }

    private Ctx acquire() {
        final Ctx pooled = warm.poll();
        synchronized (replenishLock) {
            replenishLock.notifyAll();
        }
        if (pooled != null) {
            return pooled;
        }
        if (poolSize > 0) {
            System.err.println("[espresso] WARN pool exhausted (poolSize=" + poolSize
                    + ", active=" + active.size() + "); building context on the hot path,"
                    + " the player will wait ~50s for FModel.initialize");
        }
        return newContext();
    }

    private void startReplenisher() {
        final Thread replenisher = new Thread(() -> {
            while (running) {
                while (running && warm.size() < poolSize) {
                    warm.push(newContext());
                }
                synchronized (replenishLock) {
                    try {
                        replenishLock.wait(1000);
                    } catch (InterruptedException e) {
                        return;
                    }
                }
            }
        }, "espresso-context-replenisher");
        replenisher.setDaemon(true);
        replenisher.start();
    }

    private Ctx newContext() {
        final Context context = Context.newBuilder("java")
                .allowAllAccess(true)
                .option("java.Classpath", guestClasspath)
                .build();
        final Value adapter = context.getBindings("java")
                .getMember("forge.harness.ManaBrewEngineAdapter")
                .newInstance();
        adapter.invokeMember("initialize", assetsDir);
        return new Ctx(context, adapter);
    }

    private Ctx require(final String sessionId) {
        final Ctx ctx = active.get(sessionId);
        if (ctx == null) {
            throw new IllegalArgumentException("unknown sessionId: " + sessionId);
        }
        return ctx;
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

    private static final class Ctx {
        final Context context;
        final Value adapter;

        Ctx(final Context context, final Value adapter) {
            this.context = context;
            this.adapter = adapter;
        }
    }
}
