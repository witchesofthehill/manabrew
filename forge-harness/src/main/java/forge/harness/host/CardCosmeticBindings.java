package forge.harness.host;

import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.event.EventValueChangeType;
import forge.game.event.GameEventShuffle;
import forge.game.event.GameEventZone;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import forge.harness.host.ManaBrewEngineAdapter.CardIdentity;
import forge.item.IPaperCard;
import forge.item.PaperCard;

import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.concurrent.ConcurrentHashMap;

final class CardCosmeticBindings {
    private static final Map<Game, Map<Integer, CardIdentity>> BY_GAME =
            Collections.synchronizedMap(new WeakHashMap<>());

    static final class DeckEntry {
        final PaperCard paper;
        final ManaBrewEngineAdapter.CardIdentity identity;
        ZoneType zone;

        DeckEntry(final PaperCard paper, final ManaBrewEngineAdapter.CardIdentity identity,
                final ZoneType zone) {
            this.paper = paper;
            this.identity = identity;
            this.zone = zone;
        }
    }

    private final Game game;
    private final Map<Integer, CardIdentity> bindings = new ConcurrentHashMap<>();
    private final Map<Integer, Map<ZoneType, Map<IPaperCard, Deque<DeckEntry>>>> pending = new HashMap<>();
    private final Set<Integer> bound = new HashSet<>();
    private final Map<Integer, Map<String, CardIdentity>> tokenOverrides = new HashMap<>();
    private final Set<Integer> boundTokens = new HashSet<>();

    CardCosmeticBindings(final Game game, final List<List<DeckEntry>> decks,
            final List<ManaBrewEngineAdapter.PlayerConfig> players) {
        this.game = game;
        BY_GAME.put(game, bindings);
        for (int seat = 0; seat < decks.size(); seat++) {
            final Map<ZoneType, Map<IPaperCard, Deque<DeckEntry>>> zones = new EnumMap<>(ZoneType.class);
            for (final DeckEntry entry : decks.get(seat)) {
                zones.computeIfAbsent(entry.zone, ignored -> new HashMap<>())
                        .computeIfAbsent(entry.paper, ignored -> new ArrayDeque<>()).addLast(entry);
            }
            pending.put(game.getRegisteredPlayers().get(seat).getId(), zones);
            final Map<String, CardIdentity> tokens = new HashMap<>();
            for (final ManaBrewEngineAdapter.CardIdentity token : players.get(seat).getTokens()) {
                final String script = token.getTokenScript();
                if (script != null && !script.isBlank()) {
                    final String key = script.toLowerCase(Locale.ROOT);
                    if (!tokens.containsKey(key)) {
                        tokens.put(key, token);
                    }
                }
            }
            tokenOverrides.put(game.getRegisteredPlayers().get(seat).getId(), tokens);
        }
        game.subscribeToEvents(this);
    }

    static CardIdentity get(final Game game, final Card card) {
        final Map<Integer, CardIdentity> bindings = BY_GAME.get(game);
        return bindings == null ? null : bindings.get(card.getId());
    }

    @Subscribe
    public void onZone(final GameEventZone event) {
        if (event.mode() == EventValueChangeType.Removed) {
            return;
        }
        if (event.mode() == EventValueChangeType.Added && event.card() != null
                && event.card().isToken() && !boundTokens.contains(event.card().getId())) {
            bindToken(game.findById(event.card().getId()));
        }
        if (event.player() == null) {
            return;
        }
        final Map<ZoneType, Map<IPaperCard, Deque<DeckEntry>>> zones = pending.get(event.player().getId());
        if (zones == null) {
            return;
        }
        final Map<IPaperCard, Deque<DeckEntry>> entries = zones.get(event.zoneType());
        if (entries == null) {
            return;
        }
        for (final Player player : game.getRegisteredPlayers()) {
            if (player.getId() != event.player().getId()) {
                continue;
            }
            for (final Card card : player.getZone(event.zoneType()).getCards()) {
                if (!bound.add(card.getId())) {
                    continue;
                }
                final Deque<DeckEntry> copies = entries.get(card.getPaperCard());
                if (copies == null || copies.isEmpty()) {
                    continue;
                }
                final CardIdentity value = copies.removeFirst().identity;
                if (value.getCosmetics() != null) {
                    bindings.put(card.getId(), value);
                }
            }
            return;
        }
    }

    private void bindToken(final Card card) {
        if (card == null || !card.isToken() || !boundTokens.add(card.getId())) {
            return;
        }
        final String script = InteractiveSnapshotExtractor.tokenScript(card, card.getPaperCard());
        if (script == null || card.getOwner() == null) {
            return;
        }
        final Map<String, CardIdentity> overrides = tokenOverrides.get(card.getOwner().getId());
        final CardIdentity value = overrides == null ? null : overrides.get(script.toLowerCase(Locale.ROOT));
        if (value != null) {
            bindings.put(card.getId(), value);
        }
    }

    @Subscribe
    public void onShuffle(final GameEventShuffle event) {
        pending.remove(event.player().getId());
        if (pending.isEmpty()) {
            bound.clear();
        }
    }
}
