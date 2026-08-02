package forge.harness.host;

import forge.card.CardStateName;

public final class InteractiveSnapshotExtractorTest {
    private InteractiveSnapshotExtractorTest() {}

    public static void main(final String[] args) {
        assertFaceIndex(CardStateName.Backside, CardStateName.Original, 1);
        assertFaceIndex(null, CardStateName.Backside, 1);
        assertFaceIndex(CardStateName.Original, CardStateName.Backside, 0);
        assertFaceIndex(null, CardStateName.Original, 0);
    }

    private static void assertFaceIndex(
            final CardStateName abilityState,
            final CardStateName sourceState,
            final int expected
    ) {
        final int actual = InteractiveSnapshotExtractor.stackFaceIndex(abilityState, sourceState);
        if (actual != expected) {
            throw new AssertionError("expected " + expected + " but got " + actual);
        }
    }
}
