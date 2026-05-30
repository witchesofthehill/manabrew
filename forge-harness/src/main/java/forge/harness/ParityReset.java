package forge.harness;

import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Reflection-based reset of private static ID counters in forge-game classes.
 * Used by the parity harness to isolate cross-game state without modifying forge-game.
 */
public final class ParityReset {
    private ParityReset() {}

    private static boolean logged = false;

    /** Reset all known static ID counters in forge-game to 0. */
    public static void resetAllIdCounters() {
        if (!logged) {
            System.err.println("[parity-reset] Resetting all forge-game ID counters via reflection");
            logged = true;
        }
        resetStaticCounter("forge.game.spellability.SpellAbility", "maxId");
        resetStaticCounter("forge.game.spellability.SpellAbilityStackInstance", "maxId");
        resetStaticCounter("forge.game.trigger.Trigger", "maxId");
        resetStaticCounter("forge.game.cost.IndividualCostPaymentInstance", "maxId");
        resetStaticCounter("forge.game.replacement.ReplacementEffect", "maxId");
        resetStaticCounter("forge.game.staticability.StaticAbility", "maxId");
        resetStaticCounter("forge.game.Game", "maxId");
    }

    private static void resetStaticCounter(String className, String fieldName) {
        try {
            Class<?> clazz = Class.forName(className);
            Field field = clazz.getDeclaredField(fieldName);
            field.setAccessible(true);
            Object value = field.get(null);
            if (value instanceof AtomicInteger) {
                ((AtomicInteger) value).set(0);
            } else {
                field.setInt(null, 0);
            }
        } catch (Exception e) {
            System.err.printf("[parity-reset] WARNING: Failed to reset %s.%s: %s%n",
                className, fieldName, e.getMessage());
        }
    }
}
