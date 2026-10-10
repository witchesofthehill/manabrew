package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;

final class DecisionJournal {
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ENTRIES = 4096;
    private final boolean commitBarrier;
    private boolean closed;
    private String startRequest;
    private JsonArray entries = new JsonArray();
    private long nextSequence = 1;
    private int bytes;
    private String unavailableReason;
    private boolean failurePending;
    private Boolean retained;
    private long lastReadSequence = -1;
    private long acknowledgedSequence = -1;

    DecisionJournal(final String startRequest, final boolean commitBarrier) {
        this.commitBarrier = commitBarrier;
        if (commitBarrier) {
            retained = true;
        }
        this.startRequest = startRequest;
        bytes = startRequest.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > MAX_BYTES) {
            invalidate("start request exceeds journal limit");
        }
    }

    synchronized void record(final int playerIndex, final String prompt, final JsonObject action) {
        if (unavailableReason != null) {
            return;
        }
        final JsonObject entry = new JsonObject();
        entry.addProperty("sequence", nextSequence);
        entry.addProperty("playerIndex", playerIndex);
        entry.add("prompt", prompt == null ? null : JsonParser.parseString(prompt));
        entry.add("action", action.deepCopy());
        final int size = entry.toString().getBytes(StandardCharsets.UTF_8).length;
        if (entries.size() >= MAX_ENTRIES || size > MAX_BYTES - bytes) {
            invalidate("undrained decisions exceed journal limit");
            return;
        }
        entries.add(entry);
        bytes += size;
        nextSequence++;
    }

    synchronized void invalidate(final String reason) {
        if (unavailableReason != null) {
            return;
        }
        unavailableReason = reason;
        failurePending = true;
        startRequest = null;
        entries = new JsonArray();
        bytes = 0;
        notifyAll();
    }

    synchronized void awaitAcknowledgement() {
        if (!commitBarrier) {
            return;
        }
        final long sequence = nextSequence - 1;
        while (!closed && unavailableReason == null && acknowledgedSequence < sequence) {
            try {
                wait();
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("journal acknowledgement interrupted", error);
            }
        }
        if (closed || unavailableReason != null) {
            throw new IllegalStateException("journal unavailable: " + (closed ? "session closed" : unavailableReason));
        }
    }

    synchronized void close() {
        closed = true;
        notifyAll();
    }

    synchronized String read() {
        selectDeliveryMode(true);
        lastReadSequence = nextSequence - 1;
        return batch();
    }

    synchronized void acknowledge(final long sequence) {
        selectDeliveryMode(true);
        if (sequence < 0 || sequence > lastReadSequence) {
            throw new IllegalArgumentException("journal acknowledgement exceeds read prefix");
        }
        if (unavailableReason != null) {
            throw new IllegalStateException("journal unavailable: " + unavailableReason);
        }
        if (sequence <= acknowledgedSequence) {
            return;
        }
        if (startRequest != null) {
            bytes -= startRequest.getBytes(StandardCharsets.UTF_8).length;
            startRequest = null;
        }
        final var iterator = entries.iterator();
        while (iterator.hasNext()) {
            final var entry = iterator.next();
            if (entry.getAsJsonObject().get("sequence").getAsLong() > sequence) {
                break;
            }
            bytes -= entry.toString().getBytes(StandardCharsets.UTF_8).length;
            iterator.remove();
        }
        acknowledgedSequence = sequence;
        notifyAll();
    }

    private void selectDeliveryMode(final boolean retain) {
        if (retained != null && retained != retain) {
            throw new IllegalStateException("cannot mix journal drain and acknowledged delivery");
        }
        retained = retain;
    }

    synchronized String drain() {
        selectDeliveryMode(false);
        final String result = batch();
        startRequest = null;
        entries = new JsonArray();
        bytes = 0;
        failurePending = false;
        return result;
    }

    private String batch() {
        if (startRequest == null && entries.isEmpty() && !failurePending) {
            return "";
        }
        final JsonObject batch = new JsonObject();
        batch.addProperty("version", 1);
        if (commitBarrier) {
            batch.addProperty("commitBarrier", true);
        }
        batch.addProperty("nextSequence", nextSequence);
        if (startRequest != null) {
            batch.addProperty("startRequest", startRequest);
        }
        if (unavailableReason != null) {
            batch.addProperty("unavailableReason", unavailableReason);
        }
        batch.add("entries", entries);
        return batch.toString();
    }
}
