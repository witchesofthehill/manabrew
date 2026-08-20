package forge.harness.host;

import forge.card.CardDb;

public final class ManaBrewEngineAdapterTest {
    private ManaBrewEngineAdapterTest() {}

    public static void main(final String[] args) {
        final ManaBrewEngineAdapter.CardIdentity identity =
                new ManaBrewEngineAdapter.CardIdentity("Forest", "EOE", "266", true);
        final CardDb.CardRequest request = CardDb.CardRequest.fromString(
                ManaBrewEngineAdapter.cardRequest(identity));
        if (!"Forest".equals(request.cardName)
                || !"EOE".equals(request.edition)
                || !"266".equals(request.collectorNumber)
                || !request.isFoil) {
            throw new AssertionError("exact printing identity did not survive the Forge request");
        }
    }
}
