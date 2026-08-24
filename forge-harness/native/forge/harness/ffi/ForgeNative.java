package forge.harness.ffi;

import com.google.gson.JsonObject;
import forge.harness.host.ManaBrewEngineAdapter;

import java.nio.charset.StandardCharsets;

import org.graalvm.nativeimage.IsolateThread;
import org.graalvm.nativeimage.VMRuntime;
import org.graalvm.nativeimage.UnmanagedMemory;
import org.graalvm.nativeimage.c.function.CEntryPoint;
import org.graalvm.nativeimage.c.type.CCharPointer;
import org.graalvm.nativeimage.c.type.CTypeConversion;
import org.graalvm.word.UnsignedWord;
import org.graalvm.word.WordFactory;

public final class ForgeNative {
    private static final ManaBrewEngineAdapter ADAPTER = new ManaBrewEngineAdapter();

    private ForgeNative() {
    }

    @CEntryPoint(name = "forge_initialize")
    static CCharPointer initialize(IsolateThread thread, CCharPointer assetsDir) {
        try {
            ADAPTER.initialize(str(assetsDir));
            return ok("");
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_start_game")
    static CCharPointer startGame(IsolateThread thread, CCharPointer requestJson) {
        try {
            return ok(ADAPTER.startGameJson(str(requestJson)));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_submit_action")
    static CCharPointer submitAction(IsolateThread thread, CCharPointer sessionId, CCharPointer actionJson) {
        try {
            return ok(ADAPTER.submitAction(str(sessionId), str(actionJson)));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_get_prompt")
    static CCharPointer getPrompt(IsolateThread thread, CCharPointer sessionId, int playerIndex) {
        try {
            return ok(ADAPTER.getPrompt(str(sessionId), playerIndex));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_get_snapshot")
    static CCharPointer getSnapshot(IsolateThread thread, CCharPointer sessionId, int viewer) {
        try {
            return ok(ADAPTER.getSnapshot(str(sessionId), viewer));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_get_game_over")
    static CCharPointer getGameOver(IsolateThread thread, CCharPointer sessionId) {
        try {
            return ok(ADAPTER.getGameOver(str(sessionId)));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_end_game")
    static CCharPointer endGame(IsolateThread thread, CCharPointer sessionId) {
        try {
            return ok(ADAPTER.endGameJson(str(sessionId)));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_abort_game")
    static CCharPointer abortGame(IsolateThread thread, CCharPointer sessionId) {
        try {
            return ok(ADAPTER.abortGameJson(str(sessionId)));
        } catch (Throwable t) {
            return err(t);
        }
    }

    @CEntryPoint(name = "forge_free_string")
    static void freeString(IsolateThread thread, CCharPointer ptr) {
        if (ptr.isNonNull()) {
            UnmanagedMemory.free(ptr);
        }
    }

    @CEntryPoint(name = "forge_dump_heap")
    static CCharPointer dumpHeap(IsolateThread thread, CCharPointer path, boolean liveObjectsOnly) {
        try {
            VMRuntime.dumpHeap(str(path), liveObjectsOnly);
            return ok(str(path));
        } catch (Throwable t) {
            return err(t);
        }
    }

    // One isolate hosts every room on the node, and a SubstrateVM collection
    // stops every thread in it, so a collection in one game pauses all of them.
    // Cumulative counters rather than per-pause samples: the caller differences
    // them, and pause time over wall time is the number that identified #684.
    @CEntryPoint(name = "forge_gc_stats")
    static CCharPointer gcStats(IsolateThread thread) {
        try {
            Runtime runtime = Runtime.getRuntime();
            JsonObject stats = new JsonObject();
            JsonObject byCollector = new JsonObject();
            stats.addProperty("heapUsedBytes", runtime.totalMemory() - runtime.freeMemory());
            stats.addProperty("heapTotalBytes", runtime.totalMemory());
            stats.addProperty("heapMaxBytes", runtime.maxMemory());
            long collections = 0;
            long pauseMillis = 0;
            // Per collector, because the two are nothing alike. An incremental
            // young collection is a few milliseconds. A complete one traces the
            // whole live set, and the live set here is a ~450MB card database
            // that is permanently reachable, so it costs ~1.3ms per MB whether
            // it reclaims anything or not (#684, #703). Aggregating them hides
            // the only number that matters.
            try {
                for (java.lang.management.GarbageCollectorMXBean bean :
                        java.lang.management.ManagementFactory.getGarbageCollectorMXBeans()) {
                    long count = bean.getCollectionCount();
                    long millis = bean.getCollectionTime();
                    if (count > 0) {
                        collections += count;
                    }
                    if (millis > 0) {
                        pauseMillis += millis;
                    }
                    JsonObject per = new JsonObject();
                    per.addProperty("collections", Math.max(count, 0));
                    per.addProperty("pauseMillis", Math.max(millis, 0));
                    byCollector.add(bean.getName(), per);
                }
            } catch (Throwable ignored) {
                collections = -1;
                pauseMillis = -1;
            }
            stats.add("byCollector", byCollector);
            stats.addProperty("collections", collections);
            stats.addProperty("pauseMillis", pauseMillis);
            return ok(stats.toString());
        } catch (Throwable t) {
            return err(t);
        }
    }

    private static String str(CCharPointer ptr) {
        return ptr.isNull() ? null : CTypeConversion.toJavaString(ptr);
    }

    private static CCharPointer ok(String result) {
        JsonObject response = new JsonObject();
        response.addProperty("ok", true);
        response.addProperty("result", result == null ? "" : result);
        return cstr(response.toString());
    }

    private static CCharPointer err(Throwable t) {
        JsonObject response = new JsonObject();
        response.addProperty("ok", false);
        response.addProperty("error", t.getMessage() == null ? t.toString() : t.getMessage());
        return cstr(response.toString());
    }

    private static CCharPointer cstr(String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        UnsignedWord size = WordFactory.unsigned(bytes.length + 1);
        CCharPointer ptr = UnmanagedMemory.malloc(size);
        for (int i = 0; i < bytes.length; i++) {
            ptr.write(i, bytes[i]);
        }
        ptr.write(bytes.length, (byte) 0);
        return ptr;
    }
}
