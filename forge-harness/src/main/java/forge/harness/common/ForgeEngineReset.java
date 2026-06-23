package forge.harness.common;

import java.lang.reflect.Field;

/**
 * Reflection-based reset of private static ID counters in forge-game classes.
 * Used by both harness engines (parity batches and the hosted session pool) to
 * isolate cross-game state without modifying forge-game.
 */
public final class ForgeEngineReset {
    private ForgeEngineReset() {}

    private static boolean logged = false;

    /** Reset all known static ID counters in forge-game to 0. */
    public static void resetAllIdCounters() {
        if (!logged) {
            System.err.println("[manabrew-engine-reset] Resetting all forge-game ID counters via reflection");
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
        } catch (ClassNotFoundException | NoSuchFieldException e) {
            // Class or field absent in this Forge build — nothing to reset.
        } catch (Exception e) {
            System.err.printf("[manabrew-engine-reset] WARNING: Failed to reset %s.%s: %s%n",
                className, fieldName, e.getMessage());
        }
    }
}
