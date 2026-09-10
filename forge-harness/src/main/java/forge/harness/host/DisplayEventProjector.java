package forge.harness.host;

import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.card.CardView.CardStateView;
import forge.game.event.EventValueChangeType;
import forge.game.event.GameEvent;
import forge.game.event.GameEventBlockersDeclared;
import forge.game.event.GameEventCardAttachment;
import forge.game.event.GameEventCardChangeZone;
import forge.game.event.GameEventCardCounters;
import forge.game.event.GameEventCardDamaged;
import forge.game.event.GameEventCardDestroyed;
import forge.game.event.GameEventCardPhased;
import forge.game.event.GameEventCardRegenerated;
import forge.game.event.GameEventCardSacrificed;
import forge.game.event.GameEventCardStatsChanged;
import forge.game.event.GameEventCardTapped;
import forge.game.event.GameEventDayTimeChanged;
import forge.game.event.GameEventFlipCoin;
import forge.game.event.GameEventGameOutcome;
import forge.game.event.GameEventGameStarted;
import forge.game.event.GameEventLandPlayed;
import forge.game.event.GameEventManaBurn;
import forge.game.event.GameEventPlayerLivesChanged;
import forge.game.event.GameEventPlayerPoisoned;
import forge.game.event.GameEventPlayerShardsChanged;
import forge.game.event.GameEventRollDie;
import forge.game.event.GameEventShuffle;
import forge.game.event.GameEventSnapshotRestored;
import forge.game.event.GameEventSpeedChanged;
import forge.game.event.GameEventSpellAbilityCast;
import forge.game.event.GameEventSpellResolved;
import forge.game.event.GameEventSprocketUpdate;
import forge.game.event.GameEventTokenCreated;
import forge.game.event.GameEventTurnBegan;
import forge.game.event.GameEventTurnEnded;
import forge.game.event.GameEventZone;
import forge.game.event.IGameEventVisitor;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.harness.common.SnapshotExtractor;
import forge.item.IPaperCard;

import java.util.Objects;

final class DisplayEventProjector extends IGameEventVisitor.Base<DisplayEventProjector.Projection> {
    enum EventType {
        CARD_DRAW("game.card.draw"),
        CARD_PLAY("game.card.play"),
        CARD_TAP("game.card.tap"),
        CARD_UNTAP("game.card.untap"),
        CARD_DISCARD("game.card.discard"),
        CARD_DESTROY("game.card.destroy"),
        CARD_EXILE("game.card.exile"),
        LIBRARY_SHUFFLE("game.library.shuffle"),
        PLAYER_LIFE_GAIN("game.player.life-gain"),
        PLAYER_LIFE_LOSS("game.player.life-loss"),
        TURN_START("game.turn.start"),
        DIE_ROLL("game.random.die-roll"),
        GAME_START("game.start"),
        GAME_CARD_COUNTER_ADD("game.card.counter-add"),
        GAME_COMBAT_BLOCK("game.combat.block"),
        GAME_CARD_DAMAGE("game.card.damage"),
        GAME_DAY_NIGHT_DAY("game.day-night.day"),
        GAME_TURN_END("game.turn.end"),
        GAME_CARD_ATTACH("game.card.attach"),
        GAME_CARD_TRANSFORM("game.card.transform"),
        GAME_RANDOM_COIN_FLIP("game.random.coin-flip"),
        GAME_OUTCOME_LOSS("game.outcome.loss"),
        GAME_PLAYER_MANA_BURN("game.player.mana-burn"),
        GAME_DAY_NIGHT_NIGHT("game.day-night.night"),
        GAME_CARD_PHASE("game.card.phase"),
        GAME_PLAYER_POISON("game.player.poison"),
        GAME_CARD_REGENERATE("game.card.regenerate"),
        GAME_CARD_COUNTER_REMOVE("game.card.counter-remove"),
        GAME_CARD_SACRIFICE("game.card.sacrifice"),
        GAME_SNAPSHOT_RESTORED("game.snapshot.restored"),
        GAME_PLAYER_SPEED_UP("game.player.speed-up"),
        GAME_CONTRAPTION_SPROCKET("game.contraption.sprocket"),
        GAME_PLAYER_SHARD("game.player.shard"),
        GAME_TOKEN_CREATE("game.token.create"),
        GAME_OUTCOME_WIN("game.outcome.win"),
        GAME_SPELL_RESOLVE_ARTIFACT("game.spell.resolve.artifact"),
        GAME_SPELL_RESOLVE_ARTIFACT_CREATURE("game.spell.resolve.artifact-creature"),
        GAME_SPELL_RESOLVE_CREATURE("game.spell.resolve.creature"),
        GAME_SPELL_RESOLVE_ENCHANTMENT("game.spell.resolve.enchantment"),
        GAME_SPELL_RESOLVE_INSTANT("game.spell.resolve.instant"),
        GAME_SPELL_RESOLVE_PLANESWALKER("game.spell.resolve.planeswalker"),
        GAME_SPELL_RESOLVE_SORCERY("game.spell.resolve.sorcery"),
        GAME_LAND_ENTER_BLACK("game.land.enter.black"),
        GAME_LAND_ENTER_BLUE("game.land.enter.blue"),
        GAME_LAND_ENTER_GREEN("game.land.enter.green"),
        GAME_LAND_ENTER_RED("game.land.enter.red"),
        GAME_LAND_ENTER_WHITE("game.land.enter.white"),
        GAME_LAND_ENTER_BLACK_RED("game.land.enter.black-red"),
        GAME_LAND_ENTER_BLACK_WHITE("game.land.enter.black-white"),
        GAME_LAND_ENTER_BLUE_BLACK("game.land.enter.blue-black"),
        GAME_LAND_ENTER_GREEN_BLACK("game.land.enter.green-black"),
        GAME_LAND_ENTER_GREEN_BLUE("game.land.enter.green-blue"),
        GAME_LAND_ENTER_GREEN_RED("game.land.enter.green-red"),
        GAME_LAND_ENTER_RED_BLUE("game.land.enter.red-blue"),
        GAME_LAND_ENTER_WHITE_BLUE("game.land.enter.white-blue"),
        GAME_LAND_ENTER_WHITE_GREEN("game.land.enter.white-green"),
        GAME_LAND_ENTER_WHITE_RED("game.land.enter.white-red"),
        GAME_LAND_ENTER_BLACK_RED_GREEN("game.land.enter.black-red-green"),
        GAME_LAND_ENTER_BLACK_WHITE_GREEN("game.land.enter.black-white-green"),
        GAME_LAND_ENTER_BLUE_BLACK_RED("game.land.enter.blue-black-red"),
        GAME_LAND_ENTER_GREEN_BLACK_BLUE("game.land.enter.green-black-blue"),
        GAME_LAND_ENTER_GREEN_BLUE_RED("game.land.enter.green-blue-red"),
        GAME_LAND_ENTER_GREEN_RED_WHITE("game.land.enter.green-red-white"),
        GAME_LAND_ENTER_RED_BLUE_WHITE("game.land.enter.red-blue-white"),
        GAME_LAND_ENTER_WHITE_BLUE_BLACK("game.land.enter.white-blue-black"),
        GAME_LAND_ENTER_WHITE_GREEN_BLUE("game.land.enter.white-green-blue"),
        GAME_LAND_ENTER_WHITE_RED_BLACK("game.land.enter.white-red-black"),
        GAME_LAND_ENTER_OTHER("game.land.enter.other"),
        GAME_CARD_SCRIPTED_EFFECT("game.card.scripted-effect"),
        DECISION_REQUIRED("prompt.decision-required"),
        TARGET_REQUIRED("prompt.target-required"),
        PAYMENT_REQUIRED("prompt.payment-required"),
        COMBAT_REQUIRED("prompt.combat-required"),
        ACTION_REJECTED("prompt.action-rejected");

        private final String wireName;

        EventType(final String wireName) {
            this.wireName = wireName;
        }

        String wireName() {
            return wireName;
        }
    }

    static final class Origin {
        final String type;
        final String playerId;
        final String cardId;

        private Origin(final String type, final String playerId, final String cardId) {
            this.type = type;
            this.playerId = playerId;
            this.cardId = cardId;
        }

        static Origin player(final String playerId) {
            return playerId == null ? null : new Origin("player", playerId, null);
        }

        static Origin card(final String cardId) {
            return cardId == null ? null : new Origin("card", null, cardId);
        }
    }

    static final class Context {
        final String kind;
        final String cardName;
        final String setCode;
        final String playerId;
        final String activePlayerName;
        final Integer turnNumber;
        final Long promptId;

        private Context(
                final String kind,
                final String cardName,
                final String setCode,
                final String playerId,
                final String activePlayerName,
                final Integer turnNumber,
                final Long promptId
        ) {
            this.kind = kind;
            this.cardName = cardName;
            this.setCode = setCode;
            this.playerId = playerId;
            this.activePlayerName = activePlayerName;
            this.turnNumber = turnNumber;
            this.promptId = promptId;
        }

        static Context card(
                final String cardName,
                final String setCode,
                final String playerId
        ) {
            return new Context("card", cardName, setCode, playerId, null, null, null);
        }

        static Context turn(final String activePlayerName, final int turnNumber) {
            return new Context("turn", null, null, null, activePlayerName, turnNumber, null);
        }

        static Context prompt(final long promptId) {
            return new Context("prompt", null, null, null, null, null, promptId);
        }
    }

    static final class Event {
        final long sequence;
        final String eventType;
        final Origin origin;
        final int count;
        final Context context;

        Event(
                final long sequence,
                final EventType eventType,
                final Origin origin,
                final int count,
                final Context context
        ) {
            if (sequence < 1) {
                throw new IllegalArgumentException("display event sequence must be positive");
            }
            if (count < 1) {
                throw new IllegalArgumentException("display event count must be positive");
            }
            this.sequence = sequence;
            this.eventType = Objects.requireNonNull(eventType, "eventType").wireName();
            this.origin = origin;
            this.count = count;
            this.context = context;
        }
    }

    interface Sink {
        void broadcast(EventType eventType, Origin origin, int count, Context context);
        void recipient(
                int playerIndex,
                EventType eventType,
                Origin origin,
                int count,
                Context context
        );
    }

    static final class Projection {
        final EventType eventType;
        final Origin origin;
        final Context context;

        private Projection(
                final EventType eventType,
                final Origin origin,
                final Context context
        ) {
            this.eventType = eventType;
            this.origin = origin;
            this.context = context;
        }
    }

    private final Game game;
    private final Sink sink;
    private long lastPromptEventId;

    DisplayEventProjector(final Game game, final Sink sink) {
        this.game = Objects.requireNonNull(game, "game");
        this.sink = Objects.requireNonNull(sink, "sink");
    }

    @Subscribe
    public void receive(final GameEvent event) {
        if (event instanceof GameEventGameOutcome outcome) {
            publishOutcome(outcome);
            return;
        }
        final Projection projection = event.visit(this);
        if (projection != null) {
            sink.broadcast(
                    projection.eventType,
                    projection.origin,
                    1,
                    projection.context);
        }
    }

    void publishPrompt(final int playerIndex, final long promptId, final String promptType) {
        if (!claimPromptId(playerIndex, promptId)) {
            return;
        }
        final EventType eventType = promptEventType(promptType);
        if (eventType != null) {
            sink.recipient(playerIndex, eventType, null, 1, Context.prompt(promptId));
        }
    }

    void publishActionRejected(final int playerIndex, final long promptId) {
        if (playerIndex >= 0) {
            sink.recipient(
                    playerIndex,
                    EventType.ACTION_REJECTED,
                    null,
                    1,
                    Context.prompt(promptId));
        }
    }

    private boolean claimPromptId(final int playerIndex, final long promptId) {
        if (playerIndex < 0 || promptId == lastPromptEventId) {
            return false;
        }
        lastPromptEventId = promptId;
        return true;
    }

    @Override
    public Projection visit(final GameEventGameStarted event) {
        return event(EventType.GAME_START, null);
    }

    @Override
    public Projection visit(final GameEventTurnBegan event) {
        return event(
                EventType.TURN_START,
                playerOrigin(event.turnOwner()),
                Context.turn(event.turnOwner().getName(), event.turnNumber()));
    }

    @Override
    public Projection visit(final GameEventSpellAbilityCast event) {
        if (event.sa() == null
                || !event.sa().isSpell()
                || event.si() == null) {
            return null;
        }
        return cardPlayed(event.sa().getHostCard(), event.si().getActivatingPlayer());
    }

    @Override
    public Projection visit(final GameEventLandPlayed event) {
        return cardPlayed(event.land(), event.player());
    }

    @Override
    public Projection visit(final GameEventCardDamaged event) {
        return event(EventType.GAME_CARD_DAMAGE, null);
    }

    @Override
    public Projection visit(final GameEventCardDestroyed event) {
        return event(EventType.CARD_DESTROY, null);
    }

    @Override
    public Projection visit(final GameEventCardAttachment event) {
        return event(EventType.GAME_CARD_ATTACH, null);
    }

    @Override
    public Projection visit(final GameEventCardChangeZone event) {
        final ZoneType from = event.from() == null ? null : event.from().zoneType();
        final ZoneType to = event.to() == null ? null : event.to().zoneType();
        if (from == ZoneType.Library && to == ZoneType.Hand) {
            return event(EventType.CARD_DRAW, null);
        }
        if (from == ZoneType.Hand && (to == ZoneType.Graveyard || to == ZoneType.Library)) {
            return event(EventType.CARD_DISCARD, null);
        }
        return to == ZoneType.Exile ? event(EventType.CARD_EXILE, null) : null;
    }

    @Override
    public Projection visit(final GameEventCardStatsChanged event) {
        return event.transform() ? event(EventType.GAME_CARD_TRANSFORM, null) : null;
    }

    @Override
    public Projection visit(final GameEventCardRegenerated event) {
        return event(EventType.GAME_CARD_REGENERATE, null);
    }

    @Override
    public Projection visit(final GameEventCardSacrificed event) {
        return event(EventType.GAME_CARD_SACRIFICE, null);
    }

    @Override
    public Projection visit(final GameEventCardCounters event) {
        if (event.newValue() == event.oldValue()) {
            return null;
        }
        return event(
                event.newValue() > event.oldValue()
                        ? EventType.GAME_CARD_COUNTER_ADD
                        : EventType.GAME_CARD_COUNTER_REMOVE,
                null);
    }

    @Override
    public Projection visit(final GameEventTurnEnded event) {
        return event(EventType.GAME_TURN_END, null);
    }

    @Override
    public Projection visit(final GameEventFlipCoin event) {
        return event(EventType.GAME_RANDOM_COIN_FLIP, null);
    }

    @Override
    public Projection visit(final GameEventRollDie event) {
        return event(EventType.DIE_ROLL, null);
    }

    @Override
    public Projection visit(final GameEventPlayerLivesChanged event) {
        if (event.newLives() == event.oldLives()) {
            return null;
        }
        return event(
                event.newLives() < event.oldLives()
                        ? EventType.PLAYER_LIFE_LOSS
                        : EventType.PLAYER_LIFE_GAIN,
                playerOrigin(event.player()));
    }

    @Override
    public Projection visit(final GameEventPlayerShardsChanged event) {
        return event(EventType.GAME_PLAYER_SHARD, playerOrigin(event.player()));
    }

    @Override
    public Projection visit(final GameEventManaBurn event) {
        return event(EventType.GAME_PLAYER_MANA_BURN, null);
    }

    @Override
    public Projection visit(final GameEventPlayerPoisoned event) {
        return event(EventType.GAME_PLAYER_POISON, null);
    }

    @Override
    public Projection visit(final GameEventShuffle event) {
        return event(EventType.LIBRARY_SHUFFLE, playerOrigin(event.player()));
    }

    @Override
    public Projection visit(final GameEventSpeedChanged event) {
        return event.newValue() > event.oldValue()
                ? event(EventType.GAME_PLAYER_SPEED_UP, null)
                : null;
    }

    @Override
    public Projection visit(final GameEventTokenCreated event) {
        return event(EventType.GAME_TOKEN_CREATE, null);
    }

    @Override
    public Projection visit(final GameEventSprocketUpdate event) {
        if (event.oldSprocket() == event.sprocket() || event.sprocket() <= 0) {
            return null;
        }
        return event(EventType.GAME_CONTRAPTION_SPROCKET, null);
    }

    @Override
    public Projection visit(final GameEventDayTimeChanged event) {
        return event(
                event.daytime() ? EventType.GAME_DAY_NIGHT_DAY : EventType.GAME_DAY_NIGHT_NIGHT,
                null);
    }

    @Override
    public Projection visit(final GameEventBlockersDeclared event) {
        final boolean hasBlocker = event.blockers().values().stream().anyMatch(
                attackers -> attackers.entries().stream().anyMatch(
                        block -> !block.getKey().equals(block.getValue())));
        return hasBlocker ? event(EventType.GAME_COMBAT_BLOCK, null) : null;
    }

    @Override
    public Projection visit(final GameEventSpellResolved event) {
        if (event.spell() == null || !event.spell().isSpell()) {
            return null;
        }
        final CardView source = event.spell().getHostCard();
        if (source == null) {
            return null;
        }
        if (hasScriptedEffect(source)) {
            return event(EventType.GAME_CARD_SCRIPTED_EFFECT, null);
        }
        final CardStateView state = source.getCurrentState();
        if (state.isCreature() && state.isArtifact()) {
            return event(EventType.GAME_SPELL_RESOLVE_ARTIFACT_CREATURE, null);
        }
        if (state.isCreature()) {
            return event(EventType.GAME_SPELL_RESOLVE_CREATURE, null);
        }
        if (state.isArtifact()) {
            return event(EventType.GAME_SPELL_RESOLVE_ARTIFACT, null);
        }
        if (state.isInstant()) {
            return event(EventType.GAME_SPELL_RESOLVE_INSTANT, null);
        }
        if (state.isPlaneswalker()) {
            return event(EventType.GAME_SPELL_RESOLVE_PLANESWALKER, null);
        }
        if (state.isSorcery()) {
            return event(EventType.GAME_SPELL_RESOLVE_SORCERY, null);
        }
        return state.isEnchantment()
                ? event(EventType.GAME_SPELL_RESOLVE_ENCHANTMENT, null)
                : null;
    }

    @Override
    public Projection visit(final GameEventCardTapped event) {
        return event(event.tapped() ? EventType.CARD_TAP : EventType.CARD_UNTAP, null);
    }

    @Override
    public Projection visit(final GameEventZone event) {
        final CardView card = event.card();
        if (event.mode() != EventValueChangeType.Added
                || event.zoneType() != ZoneType.Battlefield
                || card == null
                || !card.getCurrentState().isLand()) {
            return null;
        }
        if (hasScriptedEffect(card)) {
            return event(EventType.GAME_CARD_SCRIPTED_EFFECT, null);
        }
        return event(landEventType(card.getCurrentState()), null);
    }

    @Override
    public Projection visit(final GameEventCardPhased event) {
        return event(EventType.GAME_CARD_PHASE, null);
    }

    @Override
    public Projection visit(final GameEventSnapshotRestored event) {
        return event.start() ? null : event(EventType.GAME_SNAPSHOT_RESTORED, null);
    }

    private void publishOutcome(final GameEventGameOutcome event) {
        for (final Player player : game.getRegisteredPlayers()) {
            final int playerIndex = SnapshotExtractor.playerIndex(game, player);
            final EventType eventType =
                    player.hasWon() || Objects.equals(event.winningPlayerName(), player.getName())
                    ? EventType.GAME_OUTCOME_WIN
                    : EventType.GAME_OUTCOME_LOSS;
            sink.recipient(
                    playerIndex,
                    eventType,
                    Origin.player("player-" + playerIndex),
                    1,
                    null);
        }
    }

    private Projection cardPlayed(final CardView view, final PlayerView playerView) {
        final Card card = game.findByView(view);
        final Player player = game.getPlayer(playerView);
        if (card == null || player == null) {
            return null;
        }
        final IPaperCard paper = card.getPaperCard();
        final Context context = card.isFaceDown()
                ? null
                : Context.card(
                        card.getName(),
                        paper == null ? card.getSetCode() : paper.getEdition(),
                        "player-" + SnapshotExtractor.playerIndex(game, player));
        return event(
                EventType.CARD_PLAY,
                Origin.card(SnapshotExtractor.javaCardId(card)),
                context);
    }

    private boolean hasScriptedEffect(final CardView view) {
        final Card card = game.findByView(view);
        return card != null
                && card.hasSVar("SoundEffect")
                && !card.getSVar("SoundEffect").isEmpty();
    }

    private static EventType landEventType(final CardStateView state) {
        if (state.origProduceAnyMana()) {
            return EventType.GAME_LAND_ENTER_OTHER;
        }
        return switch (state.origProduceMana()) {
            case W -> EventType.GAME_LAND_ENTER_WHITE;
            case U -> EventType.GAME_LAND_ENTER_BLUE;
            case B -> EventType.GAME_LAND_ENTER_BLACK;
            case R -> EventType.GAME_LAND_ENTER_RED;
            case G -> EventType.GAME_LAND_ENTER_GREEN;
            case WU -> EventType.GAME_LAND_ENTER_WHITE_BLUE;
            case GW -> EventType.GAME_LAND_ENTER_WHITE_GREEN;
            case RW -> EventType.GAME_LAND_ENTER_WHITE_RED;
            case WB -> EventType.GAME_LAND_ENTER_BLACK_WHITE;
            case BR -> EventType.GAME_LAND_ENTER_BLACK_RED;
            case UB -> EventType.GAME_LAND_ENTER_BLUE_BLACK;
            case GU -> EventType.GAME_LAND_ENTER_GREEN_BLUE;
            case BG -> EventType.GAME_LAND_ENTER_GREEN_BLACK;
            case RG -> EventType.GAME_LAND_ENTER_GREEN_RED;
            case UR -> EventType.GAME_LAND_ENTER_RED_BLUE;
            case WUB -> EventType.GAME_LAND_ENTER_WHITE_BLUE_BLACK;
            case GWU -> EventType.GAME_LAND_ENTER_WHITE_GREEN_BLUE;
            case RWB -> EventType.GAME_LAND_ENTER_WHITE_RED_BLACK;
            case WBG -> EventType.GAME_LAND_ENTER_BLACK_WHITE_GREEN;
            case BRG -> EventType.GAME_LAND_ENTER_BLACK_RED_GREEN;
            case UBR -> EventType.GAME_LAND_ENTER_BLUE_BLACK_RED;
            case GUR -> EventType.GAME_LAND_ENTER_GREEN_BLUE_RED;
            case BGU -> EventType.GAME_LAND_ENTER_GREEN_BLACK_BLUE;
            case RGW -> EventType.GAME_LAND_ENTER_GREEN_RED_WHITE;
            case URW -> EventType.GAME_LAND_ENTER_RED_BLUE_WHITE;
            default -> EventType.GAME_LAND_ENTER_OTHER;
        };
    }

    private static Projection event(final EventType eventType, final Origin origin) {
        return event(eventType, origin, null);
    }

    private static Projection event(
            final EventType eventType,
            final Origin origin,
            final Context context
    ) {
        return new Projection(eventType, origin, context);
    }

    private Origin playerOrigin(final PlayerView view) {
        final Player player = game.getPlayer(view);
        if (player == null) {
            return null;
        }
        return Origin.player("player-" + SnapshotExtractor.playerIndex(game, player));
    }


    private static EventType promptEventType(final String promptType) {
        if (promptType == null
                || "gameOver".equals(promptType)
                || "diceRolled".equals(promptType)) {
            return null;
        }
        switch (promptType) {
            case "chooseBoardTargets":
                return EventType.TARGET_REQUIRED;
            case "payManaCost":
                return EventType.PAYMENT_REQUIRED;
            case "chooseAttackers":
            case "chooseBlockers":
            case "chooseDamageAssignmentOrder":
            case "chooseCombatDamageAssignment":
                return EventType.COMBAT_REQUIRED;
            default:
                return EventType.DECISION_REQUIRED;
        }
    }
}
