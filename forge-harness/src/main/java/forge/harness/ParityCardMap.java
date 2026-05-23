package forge.harness;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Native-engine card-id to cross-engine parity-id mapping.
 *
 * <p>Deck cards are assigned sequential IDs (1, 2, 3, ...) at game start from
 * the opening hand + library.  Cards created mid-game (tokens, copies, detached
 * effects) are assigned the next sequential ID on first access, so both engines
 * produce identical parity IDs as long as they encounter cards in the same order.
 */
public final class ParityCardMap {
    private static final Map<Integer, Integer> CARD_TO_PARITY = new HashMap<>();
    private static int nextParityId = 1;
    private static boolean initialized = false;

    private ParityCardMap() {}

    public static synchronized void reset() {
        CARD_TO_PARITY.clear();
        nextParityId = 1;
        initialized = false;
    }

    public static synchronized void initializeFromOpeningState(final Game game) {
        if (initialized || game == null) {
            return;
        }
        final List<Player> players = new ArrayList<>(game.getRegisteredPlayers());
        players.sort(Comparator.comparingInt(Player::getId));

        for (final Player p : players) {
            for (final Card c : p.getCardsIn(ZoneType.Hand)) {
                assignIfAbsent(c);
            }
            for (final Card c : p.getCardsIn(ZoneType.Library)) {
                assignIfAbsent(c);
            }
        }
        initialized = true;
    }
    /**
     * Assign parity IDs for all currently existing cards in a canonical order.
     *
     * <p>This prevents ID assignment from depending on first-touch order at
     * decision time (which can differ between Rust/Java for same-name cards,
     * especially tokens).
     */
    public static synchronized void syncWithGame(final Game game) {
        if (game == null) {
            return;
        }
        final List<Player> players = new ArrayList<>(game.getRegisteredPlayers());
        players.sort(Comparator.comparingInt(Player::getId));

        for (final Player p : players) {
            assignZoneSorted(p, ZoneType.Hand, true);
            // Java iterates library in draw order (top -> bottom).
            for (final Card c : p.getCardsIn(ZoneType.Library)) {
                assignIfAbsent(c);
            }
            assignZoneSorted(p, ZoneType.Battlefield, true);
            // Skip token cards in graveyard/exile to avoid drift from transient
            // "dies then ceases to exist" object-lifetime differences.
            assignZoneSorted(p, ZoneType.Graveyard, false);
            assignZoneSorted(p, ZoneType.Exile, false);
            assignZoneSorted(p, ZoneType.Stack, false);
        }
    }

    public static synchronized int parityId(final Card c) {
        if (c == null) {
            return Integer.MAX_VALUE;
        }
        syncWithGame(c.getGame());

        final Integer existing = CARD_TO_PARITY.get(c.getId());
        if (existing != null) {
            return existing;
        }
        // Auto-assign next sequential parity ID for tokens / copies / effects
        final int id = nextParityId++;
        CARD_TO_PARITY.put(c.getId(), id);
        return id;
    }

    public static List<String> disambiguateCards(
            final List<Card> cards,
            final Function<Card, String> baseLabel
    ) {
        return appendKey(cards, baseLabel, c -> String.valueOf(parityId(c)));
    }

    public static List<String> disambiguateAbilities(
            final List<SpellAbility> abilities,
            final Function<SpellAbility, String> baseLabel
    ) {
        return appendKey(abilities, baseLabel, sa -> String.valueOf(parityId(sa.getHostCard())));
    }

    private static void assignIfAbsent(final Card c) {
        if (c == null || CARD_TO_PARITY.containsKey(c.getId())) {
            return;
        }
        CARD_TO_PARITY.put(c.getId(), nextParityId++);
    }

    private static void assignZoneSorted(final Player p, final ZoneType zone, final boolean includeTokens) {
        final CardCollection cards = new CardCollection(p.getCardsIn(zone));
        final Comparator<Card> comparator = Comparator
            .comparing((Card c) -> c.getName(), Comparator.nullsFirst(String::compareTo))
            .thenComparingInt(c -> c.getOwner() == null ? Integer.MAX_VALUE : c.getOwner().getId())
            .thenComparingInt(c -> c.getController() == null ? Integer.MAX_VALUE : c.getController().getId())
            .thenComparingLong(c -> c.getGameTimestamp())
            .thenComparingInt(c -> c.getId());
        cards.sort(comparator);
        for (final Card c : cards) {
            if (!includeTokens && c.isToken()) {
                continue;
            }
            assignIfAbsent(c);
        }
    }

    private static <T> List<String> appendKey(
            final List<T> items,
            final Function<T, String> baseLabel,
            final Function<T, String> key
    ) {
        final List<String> out = new ArrayList<>(items.size());
        for (int i = 0; i < items.size(); i++) {
            final String base = baseLabel.apply(items.get(i));
            out.add(base + "@" + key.apply(items.get(i)));
        }
        return out;
    }
}
