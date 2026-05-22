package forge.harness;

import com.google.gson.Gson;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

public final class ParityLog {
    private static final Gson GSON = new Gson();
    private static final ThreadLocal<List<String>> SINK = ThreadLocal.withInitial(() -> null);
    private static final ThreadLocal<Random> RNG_REF = ThreadLocal.withInitial(() -> null);

    private ParityLog() {}

    public static void enable(final Random rng) {
        SINK.set(new ArrayList<>());
        RNG_REF.set(rng);
    }

    public static void enable() {
        enable(null);
    }

    public static void disable() {
        SINK.remove();
        RNG_REF.remove();
    }

    public static int rngCallCount() {
        final Random rng = RNG_REF.get();
        if (rng instanceof CountingRandom cr) {
            return cr.getCallCount();
        }
        return -1;
    }

    public static void log(final String name, final Integer choices, final String outcome) {
        final List<String> sink = SINK.get();
        if (sink == null) {
            return;
        }
        final Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("name", name);
        if (choices != null) {
            entry.put("choices", choices);
        }
        entry.put("outcome", outcome);
        final int cc = rngCallCount();
        if (cc >= 0) {
            entry.put("rng_call_count", cc);
        }
        sink.add(GSON.toJson(entry));
    }

    public static List<String> drain() {
        final List<String> sink = SINK.get();
        if (sink == null || sink.isEmpty()) {
            return List.of();
        }
        final List<String> result = new ArrayList<>(sink);
        sink.clear();
        return result;
    }
}
