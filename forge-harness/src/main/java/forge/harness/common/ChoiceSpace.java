package forge.harness.common;

import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.util.collect.FCollectionView;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collections;
import java.util.List;
import java.util.Random;

public final class ChoiceSpace {

    public static final class ChoiceResult<T> {
        public final List<T> sorted;
        public final int index;
        public final T chosen;

        private ChoiceResult(final List<T> sorted, final int index, final T chosen) {
            this.sorted = sorted;
            this.index = index;
            this.chosen = chosen;
        }

        public boolean isPass() {
            return index >= sorted.size();
        }
    }

    private ChoiceSpace() {}

    public static <T> T pickOne(final FCollectionView<T> options, final Random rng) {
        if (options == null || options.isEmpty()) {
            return null;
        }
        if (options.size() == 1) {
            ParityLog.log("pick_one", 1, "idx=0");
            return options.get(0);
        }
        final int idx = rng.nextInt(options.size());
        ParityLog.log("pick_one", options.size(), "idx=" + idx);
        return options.get(idx);
    }

    public static <T> T pickOne(final List<T> options, final Random rng) {
        if (options == null || options.isEmpty()) {
            return null;
        }
        if (options.size() == 1) {
            ParityLog.log("pick_one", 1, "idx=0");
            return options.get(0);
        }
        final int idx = rng.nextInt(options.size());
        ParityLog.log("pick_one", options.size(), "idx=" + idx);
        return options.get(idx);
    }

    public static int pickCount(final int min, final int max, final int available, final Random rng) {
        final int hi = Math.min(Math.max(max, 0), Math.max(available, 0));
        final int lo = Math.min(Math.max(min, 0), hi);
        final int count = lo + (hi > lo ? rng.nextInt(hi - lo + 1) : 0);
        ParityLog.log("pick_count [" + min + "-" + max + "]", available, String.valueOf(count));
        return count;
    }

    public static int pickIntInRange(final int min, final int max, final Random rng) {
        if (max <= min) {
            ParityLog.log("pick_int_in_range[" + min + " to " + max + "]", null, String.valueOf(min));
            return min;
        }
        final long span = (long) max - (long) min + 1L;
        final int val;
        if (span <= Integer.MAX_VALUE) {
            val = min + rng.nextInt((int) span);
        } else {
            final long candidate = (long) min + rng.nextInt(Integer.MAX_VALUE);
            val = (int) Math.min(candidate, (long) max);
        }
        ParityLog.log("pick_int_in_range [" + min + " to " + max + "]", null, String.valueOf(val));
        return val;
    }

    public static CardCollection pickManyCards(
            final CardCollectionView options,
            final int min,
            final int max,
            final Random rng) {
        final CardCollection pool = new CardCollection(options == null ? new CardCollection() : options);
        final int count = pickCount(min, max, pool.size(), rng);
        final CardCollection out = new CardCollection();
        for (int i = 0; i < count && !pool.isEmpty(); i++) {
            out.add(pool.remove(pickIndex(pool.size(), rng)));
        }
        final int poolSize = options == null ? 0 : options.size();
        ParityLog.log("pick_many_unique [" + min + " to " + max + "]", poolSize, "picked " + out.size());
        return out;
    }

    public static <T> List<T> shuffleCopy(final List<T> options, final Random rng) {
        final List<T> out = new ArrayList<>(options);
        Collections.shuffle(out, rng);
        ParityLog.log("shuffle_copy", options.size(), "done");
        return out;
    }

    public static boolean pickBool(final Random rng) {
        final boolean result = rng.nextInt(2) == 1;
        ParityLog.log("pick_bool", 2, String.valueOf(result));
        return result;
    }

    public static int pickIndex(final int size, final Random rng) {
        if (size <= 0) {
            ParityLog.log("pick_index", 0, "idx=-1");
            return -1;
        }
        if (size == 1) {
            ParityLog.log("pick_index", 1, "idx=0");
            return 0;
        }
        final int idx = rng.nextInt(size);
        ParityLog.log("pick_index", size, "idx=" + idx);
        return idx;
    }

    public static int pickIndexWithPass(final int size, final Random rng) {
        if (size < 0) {
            return 0;
        }
        final int idx = rng.nextInt(size + 1);
        final String outcome = idx >= size ? "PASS" : "idx=" + idx;
        ParityLog.log("pick_index_with_pass", size, outcome);
        return idx;
    }

    public static <T> List<T> sortNative(
            final List<T> nativeOptions,
            final Comparator<T> parityComparator
    ) {
        final List<T> sorted = new ArrayList<>(nativeOptions);
        sorted.sort(parityComparator);
        return sorted;
    }

    public static <T> ChoiceResult<T> chooseFromNative(
            final List<T> nativeOptions,
            final Comparator<T> parityComparator,
            final boolean allowPass,
            final Random rng
    ) {
        final List<T> sorted = sortNative(nativeOptions, parityComparator);
        if (sorted.isEmpty()) {
            return new ChoiceResult<>(sorted, allowPass ? 0 : -1, null);
        }
        final int idx = allowPass ? pickIndexWithPass(sorted.size(), rng) : pickIndex(sorted.size(), rng);
        final T chosen = idx >= sorted.size() ? null : sorted.get(idx);
        return new ChoiceResult<>(sorted, idx, chosen);
    }

    public static int pickWeightedIndexWithPass(final int size, final int actionWeight, final Random rng) {
        final int safeSize = Math.max(0, size);
        final int safeWeight = Math.max(1, actionWeight);
        final int totalWeight = safeSize * safeWeight + 1;
        final int roll = rng.nextInt(totalWeight);
        final int idx;
        if (roll >= safeSize * safeWeight) {
            idx = safeSize;
        } else {
            idx = roll / safeWeight;
        }
        final String outcome = idx >= safeSize ? "PASS" : "idx=" + idx;
        ParityLog.log("pick_weighted w=" + safeWeight, safeSize, outcome);
        return idx;
    }
}
