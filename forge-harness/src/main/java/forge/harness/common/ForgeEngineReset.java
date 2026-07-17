package forge.harness.common;

import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Reflection-based reset of private static ID counters in forge-game classes.
 * Used by both harness engines (parity batches and the hosted session pool) to
 * isolate cross-game state without modifying forge-game.
 *
 * <p>Every failure is fatal by design: a counter this class claims to reset
 * but silently cannot (class renamed, field moved, shape changed by an
 * upstream bump) breaks cross-game id isolation invisibly. Each reset is
 * verified by reading the counter back; callers treat a throw as an unusable
 * engine process.
 */
public final class ForgeEngineReset {
    private ForgeEngineReset() {}

    private static final String[][] COUNTERS = {
        {"forge.game.spellability.SpellAbility", "maxId"},
        {"forge.game.spellability.SpellAbilityStackInstance", "maxId"},
        {"forge.game.trigger.Trigger", "maxId"},
        {"forge.game.replacement.ReplacementEffect", "maxId"},
        {"forge.game.staticability.StaticAbility", "maxId"},
        {"forge.game.Game", "maxId"},
    };

    private static boolean logged = false;

    /** Reset all known static ID counters in forge-game to 0, verifying each. */
    public static void resetAllIdCounters() {
        if (!logged) {
            System.err.println("[manabrew-engine-reset] Resetting all forge-game ID counters via reflection");
            logged = true;
        }
        for (final String[] target : COUNTERS) {
            resetCounter(target[0], target[1]);
        }
    }

    private static void resetCounter(String className, String fieldName) {
        try {
            Field field = Class.forName(className).getDeclaredField(fieldName);
            field.setAccessible(true);
            Object value = field.get(null);
            if (value instanceof AtomicInteger counter) {
                counter.set(0);
                if (counter.get() != 0) {
                    throw new IllegalStateException(className + "." + fieldName + " did not reset to 0");
                }
            } else if (field.getType() == int.class) {
                field.setInt(null, 0);
                if (field.getInt(null) != 0) {
                    throw new IllegalStateException(className + "." + fieldName + " did not reset to 0");
                }
            } else {
                throw new IllegalStateException(
                    className + "." + fieldName + " has unsupported counter shape " + field.getType());
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(
                "cannot reset " + className + "." + fieldName + "; engine id isolation would silently break", e);
        }
    }
}
