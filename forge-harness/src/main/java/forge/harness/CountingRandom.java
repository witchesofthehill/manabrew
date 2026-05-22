package forge.harness;

import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A {@link Random} subclass that counts every {@code nextInt()} call.
 *
 * Used for debugging RNG desync between the Java harness and the Rust engine:
 * both engines are seeded identically and must consume RNG in the same order,
 * so call counts should match at every decision boundary.
 */
public final class CountingRandom extends Random {
    private final AtomicInteger callCount = new AtomicInteger(0);
    private final String label;

    public CountingRandom(long seed) {
        this(seed, "?");
    }

    public CountingRandom(long seed, String label) {
        super(seed);
        this.label = label;
    }

    @Override
    public int nextInt(int bound) {
        int n = callCount.incrementAndGet();
        int result = super.nextInt(bound);
        if (Boolean.getBoolean("forge.parity.rng.trace")) {
            System.err.printf("[rng-java #%d (%s)] nextInt(%d) = %d%n", n, label, bound, result);
        }
        String btBounds = System.getProperty("forge.parity.rng.bt.bounds");
        if (btBounds != null && "game".equals(label)) {
            for (String part : btBounds.split(",")) {
                if (part.trim().isEmpty()) continue;
                if (Integer.parseInt(part.trim()) == bound) {
                    StackTraceElement[] stack = new Throwable().getStackTrace();
                    System.err.printf("[rng-java-bt #%d (%s) bound=%d]%n", n, label, bound);
                    int limit = Math.min(stack.length, 20);
                    for (int i = 0; i < limit; i++) {
                        System.err.printf("    at %s%n", stack[i]);
                    }
                    break;
                }
            }
        }
        return result;
    }

    @Override
    public int nextInt() {
        int n = callCount.incrementAndGet();
        int result = super.nextInt();
        if (Boolean.getBoolean("forge.parity.rng.trace")) {
            System.err.printf("[rng-java #%d (%s)] nextInt() = %d%n", n, label, result);
        }
        if (Boolean.getBoolean("forge.parity.rng.bt.unbounded") && "game".equals(label)) {
            StackTraceElement[] stack = new Throwable().getStackTrace();
            System.err.printf("[rng-java-bt #%d (%s) unbounded]%n", n, label);
            int limit = Math.min(stack.length, 20);
            for (int i = 0; i < limit; i++) {
                System.err.printf("    at %s%n", stack[i]);
            }
        }
        return result;
    }

    /** Returns the total number of {@code nextInt} calls made so far. */
    public int getCallCount() {
        return callCount.get();
    }
}
