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

        final ManaBrewEngineAdapter.CardNameIndex names =
                new ManaBrewEngineAdapter.CardNameIndex() {
                    @Override
                    public boolean knowsCard(final String name) {
                        return "Lightning Bolt".equals(name);
                    }

                    @Override
                    public String cardNamePrintedAs(
                            final String setCode,
                            final String collectorNumber,
                            final String flavorName) {
                        return "FCA".equals(setCode)
                                        && "40".equals(collectorNumber)
                                        && "Thrum of the Vestige".equals(flavorName)
                                ? "Lightning Bolt"
                                : null;
                    }

                    @Override
                    public String cardNameForFlavorName(final String flavorName) {
                        return null; // empty under lazy card loading, as in the harness
                    }
                };

        final CardDb.CardRequest flavor = CardDb.CardRequest.fromString(
                ManaBrewEngineAdapter.cardRequest(
                        new ManaBrewEngineAdapter.CardIdentity(
                                "Thrum of the Vestige", "FCA", "40", false),
                        names));
        if (!"Lightning Bolt".equals(flavor.cardName)
                || !"FCA".equals(flavor.edition)
                || !"40".equals(flavor.collectorNumber)) {
            throw new AssertionError("a flavor name did not resolve to the card Forge knows: "
                    + flavor.cardName + "|" + flavor.edition + "|" + flavor.collectorNumber);
        }

        final CardDb.CardRequest mistyped = CardDb.CardRequest.fromString(
                ManaBrewEngineAdapter.cardRequest(
                        new ManaBrewEngineAdapter.CardIdentity("Lightnin Bolt", "FCA", "40", false),
                        names));
        if (!"Lightnin Bolt".equals(mistyped.cardName)) {
            throw new AssertionError("a mistyped card was swapped for the printing: "
                    + mistyped.cardName);
        }

        final CardDb.CardRequest plain = CardDb.CardRequest.fromString(
                ManaBrewEngineAdapter.cardRequest(
                        new ManaBrewEngineAdapter.CardIdentity("Lightning Bolt", "LEA", "161", false),
                        names));
        if (!"Lightning Bolt".equals(plain.cardName) || !"LEA".equals(plain.edition)) {
            throw new AssertionError("a known card name was rewritten: " + plain.cardName);
        }
    }
}
