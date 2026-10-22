package forge.harness.host;

import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.event.GameEventCardChangeZone;
import forge.game.event.GameEventCardStatsChanged;
import forge.game.event.GameEventSnapshotRestored;
import forge.game.player.Player;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;
import forge.game.zone.ZoneView;
import forge.harness.protocol.CardDto;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class HandKnowledge {
    private record Departure(int cardId, long timestamp, int handOwnerId) {}

    private static final class Observed {
        private final int cardId;
        private final long timestamp;
        private final int handOwnerId;
        private final CardDto disclosed;

        private Observed(final Card card, final int handOwnerId, final CardDto disclosed) {
            this.cardId = card.getId();
            this.timestamp = card.getGameTimestamp();
            this.handOwnerId = handOwnerId;
            this.disclosed = disclosed;
        }
    }

    private static final class ViewerKnowledge {
        private final List<Observed> cards = new ArrayList<>();
        private final List<Departure> departures = new ArrayList<>();
    }

    static final class Snapshot {
        private final Map<Player, List<Observed>> remembered;

        private Snapshot(final Map<Player, ViewerKnowledge> remembered) {
            this.remembered = new HashMap<>();
            for (final Map.Entry<Player, ViewerKnowledge> entry : remembered.entrySet()) {
                this.remembered.put(entry.getKey(), new ArrayList<>(entry.getValue().cards));
            }
        }
    }

    private final Game game;
    private final Map<Player, ViewerKnowledge> remembered = new HashMap<>();
    private boolean restoring;

    HandKnowledge(final Game game, final Set<Integer> botSeats) {
        this.game = game;
        final List<Player> players = game.getRegisteredPlayers();
        for (int seat = 0; seat < players.size(); seat++) {
            final Player player = players.get(seat);
            if (!botSeats.contains(seat) && !player.isAI() && !player.getController().isAI()) {
                remembered.put(player, new ViewerKnowledge());
            }
        }
        game.subscribeToEvents(this);
    }

    synchronized void remember(final Player viewer, final Card card, final CardDto disclosed) {
        final ViewerKnowledge knowledge = entriesFor(viewer);
        if (knowledge == null || restoring || disclosed == null || disclosed.identity == null
                || disclosed.identity.name == null || disclosed.identity.name.isEmpty()) {
            return;
        }
        observeDepartures(viewer, knowledge);
        final List<Observed> entries = knowledge.cards;
        final Player owner = handOwner(card);
        if (owner == null || owner == viewer || (disclosed.isFaceDown
                && !card.getView().canFaceDownBeShownTo(viewer.getView()))) {
            return;
        }
        final Observed observed = new Observed(card, owner.getId(), disclosed);
        for (int i = 0; i < entries.size(); i++) {
            if (entries.get(i).cardId == card.getId()) {
                entries.set(i, observed);
                return;
            }
        }
        entries.add(observed);
    }

    synchronized CardDto recalled(final Player viewer, final Card card) {
        final ViewerKnowledge knowledge = entriesFor(viewer);
        if (knowledge == null || restoring) {
            return null;
        }
        observeDepartures(viewer, knowledge);
        final List<Observed> entries = knowledge.cards;
        final Player owner = handOwner(card);
        if (owner == null || owner == viewer) {
            return null;
        }
        for (int i = 0; i < entries.size(); i++) {
            final Observed observed = entries.get(i);
            if (observed.cardId == card.getId()) {
                if (observed.timestamp == card.getGameTimestamp() && observed.handOwnerId == owner.getId()) {
                    return observed.disclosed;
                }
                entries.remove(i);
                return null;
            }
        }
        return null;
    }

    synchronized Snapshot snapshot() {
        return new Snapshot(remembered);
    }

    synchronized void restore(final Snapshot snapshot) {
        clear();
        for (final Map.Entry<Player, ViewerKnowledge> entry : remembered.entrySet()) {
            final List<Observed> saved = snapshot.remembered.get(entry.getKey());
            if (saved != null) {
                entry.getValue().cards.addAll(saved);
            }
        }
        restoring = false;
    }

    synchronized void clear() {
        for (final ViewerKnowledge knowledge : remembered.values()) {
            knowledge.cards.clear();
            knowledge.departures.clear();
        }
    }

    @Subscribe
    public synchronized void onZoneChange(final GameEventCardChangeZone event) {
        if (restoring) {
            return;
        }
        for (final ViewerKnowledge knowledge : remembered.values()) {
            for (int i = knowledge.departures.size() - 1; i >= 0; i--) {
                if (knowledge.departures.get(i).cardId() == event.card().getId()) {
                    knowledge.departures.remove(i);
                }
            }
        }
        final ZoneView from = event.from();
        if (from == null || from.zoneType() != ZoneType.Hand || from.player() == null) {
            return;
        }
        final int ownerId = from.player().getId();
        final ZoneView to = event.to();
        final Card destination = game.findById(event.card().getId());
        if (to != null && to.zoneType() == ZoneType.Hand && from.player().equals(to.player())) {
            if (destination != null && handOwner(destination) != null
                    && destination.getZone().getPlayer().getId() == ownerId) {
                for (final ViewerKnowledge knowledge : remembered.values()) {
                    final List<Observed> entries = knowledge.cards;
                    for (int i = 0; i < entries.size(); i++) {
                        final Observed observed = entries.get(i);
                        if (observed.cardId == destination.getId() && observed.handOwnerId == ownerId) {
                            entries.set(i, new Observed(destination, ownerId, observed.disclosed));
                            break;
                        }
                    }
                }
            }
            return;
        }
        final Zone destinationZone = destination == null ? null : destination.getZone();
        final boolean inDestination = to != null && destinationZone != null
                && destinationZone.getZoneType() == to.zoneType()
                && (to.player() == null ? destinationZone.getPlayer() == null
                        : destinationZone.getPlayer() != null
                                && destinationZone.getPlayer().getId() == to.player().getId());
        final CardView view = inDestination ? destination.getView() : null;
        Departure departure = null;
        for (final Map.Entry<Player, ViewerKnowledge> entry : remembered.entrySet()) {
            final Player viewer = entry.getKey();
            final boolean identified = view != null && view.canBeShownTo(viewer.getView())
                    && (!view.isFaceDown() || view.canFaceDownBeShownTo(viewer.getView()));
            final ViewerKnowledge knowledge = entry.getValue();
            final List<Observed> entries = knowledge.cards;
            boolean remainder = false;
            for (int i = entries.size() - 1; i >= 0; i--) {
                final Observed observed = entries.get(i);
                if (observed.handOwnerId == ownerId) {
                    if (!identified || observed.cardId == event.card().getId()) {
                        entries.remove(i);
                    } else {
                        remainder = true;
                    }
                }
            }
            // ChangeZoneEffect turns concealed exile cards face-down after the zone-change event.
            if (remainder && view != null && !view.isFaceDown()) {
                if (departure == null) {
                    departure = new Departure(destination.getId(), destination.getGameTimestamp(), ownerId);
                }
                knowledge.departures.add(departure);
            }
        }
    }

    @Subscribe
    public synchronized void onCardStatsChanged(final GameEventCardStatsChanged event) {
        if (restoring) {
            return;
        }
        for (final CardView view : event.cards()) {
            if (!view.isFaceDown()) {
                continue;
            }
            final Card card = game.findById(view.getId());
            if (card == null) {
                continue;
            }
            for (final Map.Entry<Player, ViewerKnowledge> entry : remembered.entrySet()) {
                final ViewerKnowledge knowledge = entry.getValue();
                if (knowledge.departures.isEmpty() || view.canFaceDownBeShownTo(entry.getKey().getView())) {
                    continue;
                }
                for (final Departure departure : knowledge.departures) {
                    if (departure.cardId() != card.getId() || departure.timestamp() != card.getGameTimestamp()) {
                        continue;
                    }
                    for (int i = knowledge.cards.size() - 1; i >= 0; i--) {
                        if (knowledge.cards.get(i).handOwnerId == departure.handOwnerId()) {
                            knowledge.cards.remove(i);
                        }
                    }
                }
            }
        }
    }

    @Subscribe
    public synchronized void onSnapshotRestored(final GameEventSnapshotRestored event) {
        clear();
        restoring = event.start();
    }

    private void observeDepartures(final Player viewer, final ViewerKnowledge knowledge) {
        for (int d = 0; d < knowledge.departures.size(); d++) {
            final Departure departure = knowledge.departures.get(d);
            final Card card = game.findById(departure.cardId());
            if (card == null || card.getGameTimestamp() != departure.timestamp()
                    || !card.isFaceDown() || card.getView().canFaceDownBeShownTo(viewer.getView())) {
                continue;
            }
            for (int i = knowledge.cards.size() - 1; i >= 0; i--) {
                if (knowledge.cards.get(i).handOwnerId == departure.handOwnerId()) {
                    knowledge.cards.remove(i);
                }
            }
        }
        knowledge.departures.clear();
    }

    private ViewerKnowledge entriesFor(final Player viewer) {
        if (viewer == null || viewer.getGame() != game || viewer.isAI() || viewer.getController().isAI()) {
            return null;
        }
        return remembered.get(viewer);
    }

    private Player handOwner(final Card card) {
        if (card == null || card.getGame() != game) {
            return null;
        }
        final Zone zone = card.getZone();
        if (zone == null || zone.getZoneType() != ZoneType.Hand || zone.getPlayer() == null) {
            return null;
        }
        for (int i = 0; i < zone.size(); i++) {
            if (zone.get(i) == card) {
                return zone.getPlayer();
            }
        }
        return null;
    }
}
