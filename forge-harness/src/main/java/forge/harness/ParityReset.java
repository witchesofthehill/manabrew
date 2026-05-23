package forge.harness;

import java.lang.reflect.Field;

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
        resetStaticInt("forge.game.spellability.SpellAbility", "maxId");
        resetStaticInt("forge.game.spellability.SpellAbilityStackInstance", "maxId");
        resetStaticInt("forge.game.trigger.Trigger", "maxId");
        resetStaticInt("forge.game.cost.IndividualCostPaymentInstance", "maxId");
        resetStaticInt("forge.game.replacement.ReplacementEffect", "maxId");
        resetStaticInt("forge.game.staticability.StaticAbility", "maxId");
        resetStaticInt("forge.game.Game", "maxId");
    }

    private static void resetStaticInt(String className, String fieldName) {
        try {
            Class<?> clazz = Class.forName(className);
            Field field = clazz.getDeclaredField(fieldName);
            field.setAccessible(true);
            field.setInt(null, 0);
        } catch (Exception e) {
            System.err.printf("[parity-reset] WARNING: Failed to reset %s.%s: %s%n",
                className, fieldName, e.getMessage());
        }
    }
}
