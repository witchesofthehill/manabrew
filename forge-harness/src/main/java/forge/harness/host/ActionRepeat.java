package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.game.Game;
import forge.game.player.Player;
import forge.harness.common.SnapshotExtractor;
import forge.harness.protocol.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class ActionRepeat {

    private static final String[] RUNAWAY_COUNTERS = {"cardsCreatedThisTurn", "triggersFiredThisTurn"};

    private enum RepeatStatus { PENDING, RUNNING, DECLINED, CANCELLED, APPLIED, FAILED }

    private static final class RepeatVote {
        private final int id;
        private final int requester;
        private final int iterations;
        private final ActionRecording recording;
        private final Set<Integer> awaiting;
        private RepeatStatus status = RepeatStatus.PENDING;
        private int decliner = -1;
        private int failedIteration;

        private RepeatVote(final int id, final int requester, final int iterations,
                final ActionRecording recording, final Set<Integer> awaiting) {
            this.id = id;
            this.requester = requester;
            this.iterations = iterations;
            this.recording = recording;
            this.awaiting = awaiting;
        }
    }

    private static final class Replay {
        private final RepeatVote vote;
        private final ManaBrewInteractiveSession.SessionSnapshot snapshot;
        private final Player priorityPlayer;
        private final long startedAt = System.currentTimeMillis();
        private int step;
        private int completed;
        private boolean failed;

        private Replay(final RepeatVote vote, final ManaBrewInteractiveSession.SessionSnapshot snapshot,
                final Player priorityPlayer) {
            this.vote = vote;
            this.snapshot = snapshot;
            this.priorityPlayer = priorityPlayer;
        }

        private int iteration() {
            return step == 0 && completed > 0 ? completed : completed + 1;
        }
    }

    private final ManaBrewInteractiveSession session;
    private final Game game;
    private ActionRecording activeRecording;
    private int recordingSeat = -1;
    private final Map<Integer, ActionRecording> recordings = new HashMap<>();
    private RepeatVote repeatVote;
    private int repeatVoteCount;
    private Replay replay;

    ActionRepeat(final ManaBrewInteractiveSession session, final Game game) {
        this.session = session;
        this.game = game;
    }

    static boolean isDirective(final String kind) {
        return "start_recording".equals(kind) || "stop_recording".equals(kind)
                || "request_repeat".equals(kind) || "repeat_vote".equals(kind);
    }

    boolean replaying() {
        return replay != null;
    }

    void handleDirective(final JsonObject action) {
        final int player = action.get("player").getAsInt();
        switch (action.get("kind").getAsString()) {
            case "start_recording":
                startRecording(player);
                break;
            case "stop_recording":
                stopRecording(player);
                break;
            case "request_repeat":
                requestRepeat(player, action.get("iterations").getAsInt());
                break;
            default:
                castRepeatVote(player, action.get("voteId").getAsInt(), action.get("accept").getAsBoolean());
                break;
        }
    }

    private boolean recordingAvailable(final int seat) {
        return replay == null && (activeRecording == null || recordingSeat == seat) && stackEmpty();
    }

    private boolean repeatAvailable(final int seat) {
        return recordings.containsKey(seat) && replay == null && activeRecording == null
                && (repeatVote == null || repeatVote.status != RepeatStatus.PENDING) && stackEmpty();
    }

    void onAnswer(final JsonObject response) {
        cancelRepeatVote();
        recordResponse(response);
    }

    private boolean stackEmpty() {
        return game.getStack().isEmpty() && !game.getStack().hasSimultaneousStackEntries();
    }

    private boolean atOwnPriority(final int seat) {
        return session.priorityPromptOpen() && session.promptedSeat() == seat && stackEmpty();
    }

    private void startRecording(final int seat) {
        if (!atOwnPriority(seat) || !recordingAvailable(seat)) {
            ActionRecording.log("start refused for seat " + seat + ": prompted=" + session.promptedSeat()
                    + " priorityPrompt=" + session.priorityPromptOpen() + " stack=" + game.getStack().size()
                    + " replaying=" + (replay != null) + " recordingSeat=" + recordingSeat);
            publishRecording(seat, new RecordingStatus_failed(RecordingFailure.NOT_AT_PRIORITY));
            return;
        }
        ActionRecording.log("start recording for seat " + seat);
        activeRecording = new ActionRecording(game);
        recordingSeat = seat;
        recordings.remove(seat);
        publishRecording(seat, new RecordingStatus_recording());
    }

    private void stopRecording(final int seat) {
        if (activeRecording == null || recordingSeat != seat) {
            return;
        }
        final ActionRecording recording = activeRecording;
        activeRecording = null;
        recordingSeat = -1;
        if (!atOwnPriority(seat)) {
            ActionRecording.log("stop refused for seat " + seat + ": prompted=" + session.promptedSeat()
                    + " priorityPrompt=" + session.priorityPromptOpen() + " stack=" + game.getStack().size()
                    + "; recording discarded");
            publishRecording(seat, new RecordingStatus_failed(RecordingFailure.NOT_AT_PRIORITY));
            return;
        }
        if (recording.actions().isEmpty()) {
            ActionRecording.log("stop for seat " + seat + ": no action recorded; recording discarded");
            publishRecording(seat, new RecordingStatus_failed(RecordingFailure.EMPTY));
            return;
        }
        ActionRecording.log("stop recording for seat " + seat + ": " + recording.size() + " steps, actions "
                + recording.actions());
        recordings.put(seat, recording);
        publishRecording(seat, new RecordingStatus_ready(recording.actions()));
    }

    private void failRecording(final RecordingFailure reason) {
        ActionRecording.log("recording for seat " + recordingSeat + " failed: " + reason
                + " (prompt for seat " + session.promptedSeat() + ")");
        publishRecording(recordingSeat, new RecordingStatus_failed(reason));
        activeRecording = null;
        recordingSeat = -1;
    }

    private void recordResponse(final JsonObject response) {
        if (activeRecording == null || response == null || !response.has("output")) {
            return;
        }
        final JsonObject prompt = session.openPrompt();
        if (session.promptedSeat() == recordingSeat) {
            if (!activeRecording.record(prompt, response)) {
                failRecording(RecordingFailure.UNSUPPORTED_PROMPT);
            }
            return;
        }
        final JsonObject passive = passiveAnswer(prompt.getAsJsonObject("input").get("type").getAsString());
        if (passive == null || !passive.getAsJsonObject("output").get("type")
                .equals(response.getAsJsonObject("output").get("type"))) {
            failRecording(RecordingFailure.OPPONENT_ACTED);
        }
    }

    private static JsonObject passiveAnswer(final String promptType) {
        final JsonObject output = new JsonObject();
        if ("chooseAction".equals(promptType)) {
            output.addProperty("type", "pass");
        } else if ("revealCards".equals(promptType)) {
            output.addProperty("type", "revealCardsAcknowledged");
        } else {
            return null;
        }
        final JsonObject answer = new JsonObject();
        answer.addProperty("type", promptType);
        answer.add("output", output);
        return answer;
    }

    private void requestRepeat(final int requester, final int iterations) {
        if (iterations < 1 || !atOwnPriority(requester) || !repeatAvailable(requester)) {
            ActionRecording.log("repeat x" + iterations + " refused for seat " + requester + ": recording="
                    + recordings.containsKey(requester) + " replaying=" + (replay != null)
                    + " recordingActive=" + (activeRecording != null) + " stack=" + game.getStack().size());
            return;
        }
        final Set<Integer> voters = session.voterSeats(requester);
        repeatVote = new RepeatVote(++repeatVoteCount, requester, iterations, recordings.get(requester), voters);
        ActionRecording.log("repeat x" + iterations + " requested by seat " + requester + ", awaiting votes from "
                + voters);
        publishRepeatVote();
        if (voters.isEmpty()) {
            startReplay();
        }
    }

    private void castRepeatVote(final int voter, final int voteId, final boolean accept) {
        final RepeatVote vote = repeatVote;
        if (vote == null || vote.status != RepeatStatus.PENDING || vote.id != voteId || !vote.awaiting.remove(voter)) {
            return;
        }
        final boolean requesterPromptOpen = session.priorityPromptOpen() && session.promptedSeat() == vote.requester;
        ActionRecording.log("seat " + voter + (accept ? " accepted" : " declined") + " repeat vote " + voteId
                + "; still awaiting " + vote.awaiting);
        if (!accept) {
            vote.status = RepeatStatus.DECLINED;
            vote.decliner = voter;
            publishRepeatVote();
            return;
        }
        publishRepeatVote();
        if (vote.awaiting.isEmpty() && requesterPromptOpen) {
            startReplay();
        }
    }

    private void cancelRepeatVote() {
        if (repeatVote != null && repeatVote.status == RepeatStatus.PENDING
                && session.promptedSeat() == repeatVote.requester) {
            ActionRecording.log("repeat vote " + repeatVote.id + " cancelled: the requester answered the prompt");
            repeatVote.status = RepeatStatus.CANCELLED;
            publishRepeatVote();
        }
    }

    private void startReplay() {
        final long started = System.currentTimeMillis();
        final ManaBrewInteractiveSession.SessionSnapshot snapshot = session.captureSnapshot();
        repeatVote.recording.beginIteration();
        resetRunawayWindow();
        replay = new Replay(repeatVote, snapshot, game.getPhaseHandler().getPriorityPlayer());
        repeatVote.status = RepeatStatus.RUNNING;
        publishRepeatVote();
        ActionRecording.log("replay start: " + repeatVote.iterations + " iterations of " + repeatVote.recording.size()
                + " steps; snapshot took " + (System.currentTimeMillis() - started) + " ms");
    }

    JsonObject replayAnswer() {
        final Replay run = replay;
        if (session.isClosed() || game.isGameOver()) {
            endReplay(run.failed ? RepeatStatus.FAILED : RepeatStatus.APPLIED);
            return ManaBrewInteractiveSession.syntheticPass();
        }
        final JsonObject prompt = session.openPrompt();
        if (run.failed) {
            return minimalAnswer(prompt);
        }
        final int seat = session.promptedSeat();
        final String type = prompt.getAsJsonObject("input").get("type").getAsString();
        if (seat != run.vote.requester) {
            final JsonObject passive = passiveAnswer(type);
            if (passive == null) {
                ActionRecording.log("iteration " + run.iteration() + ": seat " + seat
                        + " got a " + type + " prompt, which the replay cannot answer");
                return failReplay(prompt);
            }
            ActionRecording.log("iteration " + run.iteration() + ": seat " + seat + " " + type
                    + " answered passively");
            return passive;
        }
        final ActionRecording recording = run.vote.recording;
        if (run.step == 0 && run.completed > 0) {
            ActionRecording.log("iteration " + run.completed + " done at " + (System.currentTimeMillis() - run.startedAt)
                    + " ms");
            if (run.completed == run.vote.iterations) {
                session.publishOpenPrompt();
                endReplay(RepeatStatus.APPLIED);
                return null;
            }
            recording.beginIteration();
            resetRunawayWindow();
        }
        final JsonObject answer = recording.resolve(run.step, prompt);
        if (answer == null) {
            return failReplay(prompt);
        }
        ActionRecording.log("iteration " + (run.completed + 1) + " step " + run.step + ": " + type + " answered at "
                + (System.currentTimeMillis() - run.startedAt) + " ms");
        run.step = (run.step + 1) % recording.size();
        if (run.step == 0) {
            run.completed++;
            publishRepeatVote();
        }
        return answer;
    }

    private void resetRunawayWindow() {
        try {
            for (final String counter : RUNAWAY_COUNTERS) {
                final java.lang.reflect.Field field = Game.class.getDeclaredField(counter);
                field.setAccessible(true);
                field.setInt(game, 0);
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("cannot reset Forge's per-turn runaway counters", e);
        }
    }

    private JsonObject failReplay(final JsonObject prompt) {
        ActionRecording.log("replay failed in iteration " + replay.iteration()
                + "; giving minimal answers until the next priority, then restoring the snapshot");
        replay.failed = true;
        replay.vote.failedIteration = replay.iteration();
        return minimalAnswer(prompt);
    }

    private static JsonObject minimalAnswer(final JsonObject prompt) {
        final JsonObject input = prompt.getAsJsonObject("input");
        final String type = input.get("type").getAsString();
        final JsonObject output = new JsonObject();
        switch (type) {
            case "chooseAction":
                output.addProperty("type", "pass");
                break;
            case "payManaCost":
                output.addProperty("type", "cancel");
                break;
            case "chooseBoardTargets":
                if (input.get("cancellable").getAsBoolean()) {
                    output.addProperty("type", "cancel");
                } else {
                    output.addProperty("type", "boardTargets");
                    output.add("chosen", firstOf(input.getAsJsonArray("candidates"), input.get("minTargets").getAsInt(),
                            null));
                }
                break;
            case "chooseCards":
                output.addProperty("type", "chooseCardsDecision");
                output.add("chosenCardIds", firstOf(input.getAsJsonArray("cards"), input.get("min").getAsInt(), "id"));
                break;
            case "mulliganPutBack":
                output.addProperty("type", "mulliganPutBackDecision");
                output.add("cardIds", firstOf(input.getAsJsonArray("handCardIds"), input.get("count").getAsInt(), null));
                break;
            case "chooseFromSelection": {
                output.addProperty("type", "selectionDecision");
                final JsonArray indices = new JsonArray();
                final JsonArray options = input.getAsJsonArray("options");
                int total = 0;
                for (int i = 0; i < options.size() && total < input.get("minTotal").getAsInt(); i++) {
                    indices.add(i);
                    total += options.get(i).getAsJsonObject().get("weight").getAsInt();
                }
                output.add("chosenIndices", indices);
                break;
            }
            case "chooseNumber":
                output.addProperty("type", "numberDecision");
                output.addProperty("chosenNumber", input.get("min").getAsInt());
                break;
            case "chooseColor": {
                output.addProperty("type", "colorDecision");
                final JsonObject colors = new JsonObject();
                colors.addProperty(input.getAsJsonArray("validColors").get(0).getAsString(), input.get("amount").getAsInt());
                output.add("chosenColors", colors);
                break;
            }
            case "chooseBoolean":
                output.addProperty("type", "decision");
                output.addProperty("value", false);
                break;
            case "reorder": {
                output.addProperty("type", "reorderDecision");
                final JsonArray items = input.getAsJsonArray("items");
                output.add("orderedIds", firstOf(items, items.size(), "id"));
                break;
            }
            case "scry": {
                output.addProperty("type", "scryDecision");
                final JsonArray zones = new JsonArray();
                final JsonArray cards = input.getAsJsonArray("cards");
                for (int i = 0; i < input.getAsJsonArray("zones").size(); i++) {
                    zones.add(i == 0 ? firstOf(cards, cards.size(), "id") : new JsonArray());
                }
                output.add("zoneCardIds", zones);
                break;
            }
            case "chooseAttackers":
                output.addProperty("type", "declareAttackers");
                output.add("assignments", new JsonArray());
                break;
            case "chooseBlockers":
                output.addProperty("type", "declareBlockers");
                output.add("assignments", new JsonArray());
                break;
            case "chooseDamageAssignmentOrder": {
                output.addProperty("type", "damageAssignmentOrderDecision");
                final JsonArray blockers = input.getAsJsonArray("blockerIds");
                output.add("orderedBlockerIds", firstOf(blockers, blockers.size(), null));
                break;
            }
            case "chooseCombatDamageAssignment": {
                output.addProperty("type", "combatDamageAssignmentDecision");
                final JsonArray assignments = new JsonArray();
                final JsonArray blockers = input.getAsJsonArray("blockerIds");
                final JsonElement assignee = blockers.size() > 0 ? blockers.get(0) : input.get("defenderId");
                if (assignee != null && !assignee.isJsonNull()) {
                    final JsonObject entry = new JsonObject();
                    entry.add("assigneeId", assignee);
                    entry.addProperty("damage", input.get("totalDamage").getAsInt());
                    assignments.add(entry);
                }
                output.add("assignments", assignments);
                break;
            }
            case "mulligan":
                output.addProperty("type", "mulliganDecision");
                output.addProperty("keep", true);
                break;
            case "revealCards":
                output.addProperty("type", "revealCardsAcknowledged");
                break;
            case "diceRolled":
                output.addProperty("type", "diceRolledAcknowledged");
                break;
            default:
                throw new IllegalStateException("no minimal answer for a " + type + " prompt");
        }
        final JsonObject answer = new JsonObject();
        answer.addProperty("type", type);
        answer.add("output", output);
        return answer;
    }

    private static JsonArray firstOf(final JsonArray source, final int count, final String field) {
        final JsonArray picked = new JsonArray();
        for (int i = 0; i < Math.min(count, source.size()); i++) {
            picked.add(field == null ? source.get(i) : source.get(i).getAsJsonObject().get(field));
        }
        return picked;
    }

    private void endReplay(final RepeatStatus status) {
        ActionRecording.log("replay end: " + status + " after " + replay.completed + " iterations, "
                + (System.currentTimeMillis() - replay.startedAt) + " ms");
        replay.vote.status = status;
        replay = null;
        publishRepeatVote();
        session.announceState();
    }

    boolean passesDuringReplay(final Player player) {
        final Replay run = replay;
        final int seat = SnapshotExtractor.playerIndex(game, player);
        if (run == null || (!run.failed && seat == run.vote.requester)) {
            return false;
        }
        ActionRecording.log("iteration " + run.iteration() + ": seat " + seat + " passes priority"
                + (run.failed ? " (replay failed)" : ""));
        return true;
    }

    boolean revertFailedRepeat() {
        final Replay run = replay;
        if (run == null || !run.failed) {
            return false;
        }
        final long started = System.currentTimeMillis();
        session.restoreSnapshot(run.snapshot, run.priorityPlayer);
        ActionRecording.log("snapshot restored in " + (System.currentTimeMillis() - started) + " ms");
        endReplay(RepeatStatus.FAILED);
        return true;
    }

    private void publishRecording(final int seat, final RecordingStatus status) {
        session.publishDirective(seat, new EngineDirective_recording(status));
    }

    private void publishRepeatVote() {
        final RepeatVote vote = repeatVote;
        final RepeatVoteStatus status;
        switch (vote.status) {
            case PENDING:
                status = new RepeatVoteStatus_pending();
                break;
            case RUNNING:
                status = new RepeatVoteStatus_running(replay == null ? 0 : replay.completed);
                break;
            case DECLINED:
                status = new RepeatVoteStatus_declined("player-" + vote.decliner);
                break;
            case CANCELLED:
                status = new RepeatVoteStatus_cancelled();
                break;
            case APPLIED:
                status = new RepeatVoteStatus_applied();
                break;
            default:
                status = new RepeatVoteStatus_failed(vote.failedIteration);
                break;
        }
        final List<String> awaiting = new ArrayList<>();
        for (final int seat : vote.awaiting) {
            awaiting.add("player-" + seat);
        }
        final EngineDirective directive = new EngineDirective_repeatVote(new RepeatVoteDto(
                vote.id, "player-" + vote.requester, vote.iterations, vote.recording.actions(), awaiting, status));
        for (final int seat : session.humanSeats()) {
            session.publishDirective(seat, directive);
        }
    }
}
