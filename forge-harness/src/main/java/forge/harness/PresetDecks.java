package forge.harness;

import forge.card.CardDb;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.item.PaperCard;
import forge.model.FModel;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Builds preset decks from shared JSON files in the {@code parity_decks/} and
 * {@code DEFAULT_DECKS_DIRS} on the Rust side.
 */
public final class PresetDecks {
    private PresetDecks() {}

    /**
     * Default directories for preset deck JSON files (relative to CWD), searched
     * in order. Mirrors {@code DEFAULT_DECKS_DIRS} on the Rust side
     * ({@code forge-parity/src/runner.rs}).
     */
    private static final String[] DEFAULT_DECKS_DIRS = { "parity_decks", "public/preset_decks" };

    /**
     * Returns the list of directories to search for preset decks, in order.
     *
     * <p>The {@code preset.decks.dir} system property and {@code PRESET_DECKS_DIR}
     * environment variable both accept a comma-separated list of paths.
     * Single-path values keep working (no comma → single-element list).
     */
    private static String[] getDecksDirs() {
        String dir = System.getProperty("preset.decks.dir");
        if (dir != null && !dir.isEmpty()) {
            return dir.split(",");
        }
        dir = System.getenv("PRESET_DECKS_DIR");
        if (dir != null && !dir.isEmpty()) {
            return dir.split(",");
        }
        return DEFAULT_DECKS_DIRS;
    }

    /**
     * Build a Deck from a preset name or inline spec. Returns null if the preset is unknown.
     *
     * Supports inline deck specs with the "inline:" prefix:
     *   "inline:Mountain*17|Lightning Bolt*4|Shock*4"
     */
    public static Deck buildDeck(String presetName) {
        if (presetName.startsWith("inline:")) {
            return buildInlineDeck(presetName.substring(7));
        }

        Path jsonPath = null;
        for (String decksDir : getDecksDirs()) {
            Path candidate = Paths.get(decksDir.trim(), presetName + ".json");
            if (Files.exists(candidate)) {
                jsonPath = candidate;
                break;
            }
        }
        if (jsonPath == null) {
            return null;
        }

        String contents;
        try {
            contents = Files.readString(jsonPath);
        } catch (IOException e) {
            System.err.println("[harness] WARNING: Failed to read " + jsonPath + ": " + e.getMessage());
            return null;
        }

        JsonObject root = JsonParser.parseString(contents).getAsJsonObject();
        JsonArray cards = root.getAsJsonArray("cards");

        Deck deck = new Deck(presetName);
        CardPool main = deck.getOrCreate(DeckSection.Main);
        CardDb cardDb = FModel.getMagicDb().getCommonCards();

        for (JsonElement elem : cards) {
            JsonObject entry = elem.getAsJsonObject();
            String name = entry.get("name").getAsString();
            int count = entry.get("count").getAsInt();

            PaperCard card = lookupCard(cardDb, name);
            if (card == null) {
                System.err.println("[harness] WARNING: Card not found: " + name);
                continue;
            }
            main.add(card, count);
        }

        return deck;
    }

    /**
     * Mirrors {@code CardDatabase::get_by_card_name}: try the full name,
     * then fall back to the front face of a Scryfall {@code " // "} string.
     */
    private static PaperCard lookupCard(CardDb cardDb, String name) {
        PaperCard card = cardDb.getCard(name);
        if (card != null) {
            return card;
        }
        int sep = name.indexOf(" // ");
        if (sep < 0) {
            return null;
        }
        return cardDb.getCard(name.substring(0, sep));
    }

    /**
     * Build a Deck from an inline spec string: "Name*Count|Name*Count|..."
     * Uses '|' as delimiter because MTG card names can contain commas.
     */
    private static Deck buildInlineDeck(String spec) {
        Deck deck = new Deck("inline");
        CardPool main = deck.getOrCreate(DeckSection.Main);
        CardDb cardDb = FModel.getMagicDb().getCommonCards();

        for (String entry : spec.split("\\|")) {
            entry = entry.trim();
            if (entry.isEmpty()) continue;

            int lastStar = entry.lastIndexOf('*');
            if (lastStar < 0) {
                System.err.println("[harness] WARNING: Invalid inline entry (no '*'): " + entry);
                continue;
            }

            String name = entry.substring(0, lastStar);
            int count;
            try {
                count = Integer.parseInt(entry.substring(lastStar + 1));
            } catch (NumberFormatException e) {
                System.err.println("[harness] WARNING: Invalid count in entry: " + entry);
                continue;
            }

            PaperCard card = lookupCard(cardDb, name);
            if (card == null) {
                System.err.println("[harness] WARNING: Card not found: " + name);
                continue;
            }
            main.add(card, count);
        }

        return deck;
    }

    /**
     * Returns all available preset names by scanning every configured deck
     * directory. Names are deduped and sorted.
     */
    public static String[] availablePresets() {
        java.util.TreeSet<String> names = new java.util.TreeSet<>();
        for (String decksDir : getDecksDirs()) {
            File dir = new File(decksDir.trim());
            if (!dir.isDirectory()) {
                continue;
            }
            File[] files = dir.listFiles((d, name) -> name.endsWith(".json"));
            if (files == null) {
                continue;
            }
            for (File f : files) {
                names.add(f.getName().replace(".json", ""));
            }
        }
        return names.toArray(new String[0]);
    }
}
