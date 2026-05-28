package manabrew.espresso;

import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Value;

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
            if (reuse) {
                warm.push(ctx);
            } else {
                ctx.context.close(true);
            }
        }
    }

    public String abortGameJson(final String sessionId) {
        final Ctx ctx = active.remove(sessionId);
        if (ctx != null) {
            ctx.context.close(true);
        }
        return "{\"sessionId\":\"" + sessionId + "\",\"ended\":true}";
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
