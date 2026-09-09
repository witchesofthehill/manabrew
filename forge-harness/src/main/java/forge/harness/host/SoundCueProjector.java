package forge.harness.host;

import com.google.common.eventbus.Subscribe;
import forge.game.Game;
import forge.game.event.GameEvent;
import forge.game.event.GameEventCardChangeZone;
import forge.game.event.GameEventCardDestroyed;
import forge.game.event.GameEventCardTapped;
import forge.game.event.GameEventGameStarted;
import forge.game.event.GameEventLandPlayed;
import forge.game.event.GameEventPlayerLivesChanged;
import forge.game.event.GameEventRollDie;
import forge.game.event.GameEventShuffle;
import forge.game.event.GameEventSpellAbilityCast;
import forge.game.event.GameEventTurnBegan;
import forge.game.event.IGameEventVisitor;
import forge.game.player.Player;
import forge.game.player.PlayerView;
import forge.game.zone.ZoneType;
import forge.harness.common.SnapshotExtractor;

import java.util.Objects;

final class SoundCueProjector extends IGameEventVisitor.Base<SoundCueProjector.Projection> {
    enum SoundType {
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
        DECISION_REQUIRED("prompt.decision-required"),
        TARGET_REQUIRED("prompt.target-required"),
        PAYMENT_REQUIRED("prompt.payment-required"),
        COMBAT_REQUIRED("prompt.combat-required"),
        ACTION_REJECTED("prompt.action-rejected");

        private final String wireName;

        SoundType(final String wireName) {
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

    static final class Cue {
        final String kind = "soundCue";
        final long sequence;
        final String soundType;
        final Origin origin;
        final int count;
        final Long promptId;

        Cue(
                final long sequence,
                final SoundType soundType,
                final Origin origin,
                final int count,
                final Long promptId
        ) {
            if (sequence < 1) {
                throw new IllegalArgumentException("sound sequence must be positive");
            }
            if (count < 1) {
                throw new IllegalArgumentException("sound cue count must be positive");
            }
            this.sequence = sequence;
            this.soundType = Objects.requireNonNull(soundType, "soundType").wireName();
            this.origin = origin;
            this.count = count;
            this.promptId = promptId;
        }
    }

    interface Sink {
        void broadcast(SoundType soundType, Origin origin, int count);
        void recipient(int playerIndex, SoundType soundType, Origin origin, int count, long promptId);
    }

    static final class Projection {
        final SoundType soundType;
        final Origin origin;

        private Projection(final SoundType soundType, final Origin origin) {
            this.soundType = soundType;
            this.origin = origin;
        }
    }

    private final Game game;
    private final Sink sink;
    private long lastPromptCueId;

    SoundCueProjector(final Game game, final Sink sink) {
        this.game = Objects.requireNonNull(game, "game");
        this.sink = Objects.requireNonNull(sink, "sink");
    }

    @Subscribe
    public void receive(final GameEvent event) {
        final Projection projection = event.visit(this);
        if (projection != null) {
            sink.broadcast(projection.soundType, projection.origin, 1);
        }
    }

    void publishPrompt(final int playerIndex, final long promptId, final String promptType) {
        if (!claimPromptId(playerIndex, promptId)) {
            return;
        }
        final SoundType soundType = promptSoundType(promptType);
        if (soundType != null) {
            sink.recipient(playerIndex, soundType, null, 1, promptId);
        }
    }

    void publishActionRejected(final int playerIndex, final long promptId) {
        if (playerIndex >= 0) {
            sink.recipient(playerIndex, SoundType.ACTION_REJECTED, null, 1, promptId);
        }
    }

    private boolean claimPromptId(final int playerIndex, final long promptId) {
        if (playerIndex < 0 || promptId == lastPromptCueId) {
            return false;
        }
        lastPromptCueId = promptId;
        return true;
    }

    @Override
    public Projection visit(final GameEventGameStarted event) {
        return cue(SoundType.GAME_START, null);
    }

    @Override
    public Projection visit(final GameEventTurnBegan event) {
        return cue(SoundType.TURN_START, playerOrigin(event.turnOwner()));
    }

    @Override
    public Projection visit(final GameEventCardChangeZone event) {
        final ZoneType from = event.from() == null ? null : event.from().zoneType();
        final ZoneType to = event.to() == null ? null : event.to().zoneType();
        if (from == ZoneType.Library && to == ZoneType.Hand) {
            return cue(SoundType.CARD_DRAW, null);
        }
        if (from == ZoneType.Hand && (to == ZoneType.Graveyard || to == ZoneType.Library)) {
            return cue(SoundType.CARD_DISCARD, null);
        }
        return to == ZoneType.Exile ? cue(SoundType.CARD_EXILE, null) : null;
    }

    @Override
    public Projection visit(final GameEventCardDestroyed event) {
        return cue(SoundType.CARD_DESTROY, null);
    }

    @Override
    public Projection visit(final GameEventCardTapped event) {
        return cue(event.tapped() ? SoundType.CARD_TAP : SoundType.CARD_UNTAP, null);
    }

    @Override
    public Projection visit(final GameEventSpellAbilityCast event) {
        if (event.sa() == null || !event.sa().isSpell()) {
            return null;
        }
        return cue(SoundType.CARD_PLAY, null);
    }

    @Override
    public Projection visit(final GameEventLandPlayed event) {
        return cue(SoundType.CARD_PLAY, null);
    }

    @Override
    public Projection visit(final GameEventShuffle event) {
        return cue(SoundType.LIBRARY_SHUFFLE, playerOrigin(event.player()));
    }

    @Override
    public Projection visit(final GameEventPlayerLivesChanged event) {
        if (event.newLives() == event.oldLives()) {
            return null;
        }
        return cue(
                event.newLives() < event.oldLives()
                        ? SoundType.PLAYER_LIFE_LOSS
                        : SoundType.PLAYER_LIFE_GAIN,
                playerOrigin(event.player()));
    }

    @Override
    public Projection visit(final GameEventRollDie event) {
        return cue(SoundType.DIE_ROLL, null);
    }

    private static Projection cue(final SoundType soundType, final Origin origin) {
        return new Projection(soundType, origin);
    }

    private Origin playerOrigin(final PlayerView view) {
        final Player player = game.getPlayer(view);
        if (player == null) {
            return null;
        }
        return Origin.player("player-" + SnapshotExtractor.playerIndex(game, player));
    }


    private static SoundType promptSoundType(final String promptType) {
        if (promptType == null
                || "chooseAction".equals(promptType)
                || "gameOver".equals(promptType)
                || "diceRolled".equals(promptType)) {
            return null;
        }
        switch (promptType) {
            case "chooseBoardTargets":
                return SoundType.TARGET_REQUIRED;
            case "payManaCost":
                return SoundType.PAYMENT_REQUIRED;
            case "chooseAttackers":
            case "chooseBlockers":
            case "chooseDamageAssignmentOrder":
            case "chooseCombatDamageAssignment":
                return SoundType.COMBAT_REQUIRED;
            default:
                return SoundType.DECISION_REQUIRED;
        }
    }
}
