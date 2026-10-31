package forge.harness.host;

import java.util.Random;

final class ReplayRandom extends Random {
    private long calls;
    private long trace = 0xcbf29ce484222325L;

    ReplayRandom(final long seed) {
        super(seed);
    }

    @Override
    protected int next(final int bits) {
        final int value = super.next(bits);
        calls++;
        trace = (trace ^ bits) * 0x100000001b3L;
        trace = (trace ^ Integer.toUnsignedLong(value)) * 0x100000001b3L;
        return value;
    }

    String position() {
        return calls + ":" + Long.toUnsignedString(trace, 16);
    }
}
