package forge.harness.wasm;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import forge.harness.host.InteractiveBridge;

import org.graalvm.webimage.api.JS;

/**
 * The engine half of the SharedArrayBuffer protocol in
 * manabrew-rs/crates/wasm/src/wasm_transport.rs, so a browser client written
 * against the Rust engine drives Forge without changes.
 *
 * Layout: slot 0 signal, slot 1 payload length, bytes from offset 8.
 * Signals: 0 idle, 1 prompt ready, 2 response ready, 3 prompt acknowledged.
 *
 * Atomics.wait parks the whole wasm stack, which is legal here because this
 * only ever runs on a worker.
 */
public final class SabTransport implements InteractiveBridge {

    /** Binds to a buffer the host allocated, so the app owns the SAB lifecycle. */
    @JS.Coerce
    @JS("const sab = globalThis.__forgeSab;"
        + "if (!sab) throw new Error('globalThis.__forgeSab is not set');"
        + "globalThis.__mbSab = sab;"
        + "globalThis.__mbSig = new Int32Array(sab, 0, 2);"
        + "globalThis.__mbData = new Uint8Array(sab, 8);"
        + "globalThis.__mbSeats = [{ sig: globalThis.__mbSig, data: globalThis.__mbData }];"
        + "globalThis.__mbSeatOf = () => 0;"
        + "return true;")
    static native boolean bind();

    /**
     * Binds one buffer per seat, for a table this browser is hosting.
     *
     * <p>`globalThis.__forgeSeatSabs` is an array indexed by the engine's own
     * player index, so a prompt for player-2 is published on the buffer the
     * host handed that seat and nowhere else.
     */
    @JS.Coerce
    @JS("const sabs = globalThis.__forgeSeatSabs;"
        + "if (!Array.isArray(sabs) || !sabs.length) throw new Error('globalThis.__forgeSeatSabs is not set');"
        + "globalThis.__mbSeats = sabs.map((sab) => sab && ({"
        + "  sig: new Int32Array(sab, 0, 2), data: new Uint8Array(sab, 8) }));"
        + "const first = globalThis.__mbSeats.findIndex((s) => s);"
        + "globalThis.__mbSeatOf = (seat) => (globalThis.__mbSeats[seat] ? seat : first);"
        + "globalThis.__mbSig = globalThis.__mbSeats[first].sig;"
        + "globalThis.__mbData = globalThis.__mbSeats[first].data;"
        + "return globalThis.__mbSeats.filter((s) => s).length;")
    static native int bindSeats();

    @JS.Coerce
    @JS("const s = globalThis.__mbSeats[globalThis.__mbSeatOf(seat)];"
        + "const sig = s.sig, data = s.data;"
        + "for (;;) {"
        + "  const cur = Atomics.load(sig, 0);"
        + "  if (cur === 0 || cur === 2 || cur === 3) break;"
        + "  Atomics.wait(sig, 0, cur);"
        + "}"
        + "const bytes = new TextEncoder().encode(json);"
        + "if (bytes.length > data.length) return false;"
        + "data.set(bytes, 0);"
        + "Atomics.store(sig, 1, bytes.length);"
        + "Atomics.store(sig, 0, 1);"
        + "Atomics.notify(sig, 0);"
        + "return true;")
    static native boolean send(int seat, String json);

    @JS.Coerce
    @JS("const s = globalThis.__mbSeats[globalThis.__mbSeatOf(seat)];"
        + "const sig = s.sig, data = s.data;"
        + "for (;;) {"
        + "  const cur = Atomics.load(sig, 0);"
        + "  if (cur === 2) break;"
        + "  Atomics.wait(sig, 0, cur);"
        + "}"
        + "const len = Atomics.load(sig, 1);"
        + "const out = new TextDecoder().decode(data.slice(0, len));"
        + "Atomics.store(sig, 0, 0);"
        + "Atomics.notify(sig, 0);"
        + "return out;")
    static native String recv(int seat);

    @JS.Coerce
    @JS("postMessage({ type: 'event', event: name, payload: JSON.parse(json) });")
    static native void post(String name, String json);

    @JS.Coerce
    @JS("return (globalThis.__mbSeats || []).length;")
    static native int seatCount();

    private final java.util.function.IntFunction<String> snapshots;
    /**
     * Seats a Manabot plays. A bot reads one board, the one it is prompted
     * on, so it gets a state only then; a person watches the whole game and
     * gets one on every prompt. Without this every prompt of any seat cost a
     * snapshot per bound seat, four times the work at a pod, most of it
     * discarded unread.
     */
    private final java.util.Set<Integer> botSeats;
    private long checkpoint;
    /** When a person's answer last landed; bot answers do not move it. */
    private long lastRecvAt;
    /**
     * Wall time spent inside bot prompts since that answer: the bot's own
     * snapshot, its wait on the worker and the transfer of its reply. What a
     * person's window contains besides this is the rules engine resolving
     * their action, so the two halves name who owns a long wait.
     */
    private long botMsSinceRecv;
    private int turnNow;
    private int turnAtLastPrompt = -1;
    /** Kept clear of the in-game sequence, which the session owns. */
    private long finalPromptId = 1_000_000;

    private static String inputType(final String promptJson) {
        try {
            final JsonObject input = JsonParser.parseString(promptJson)
                    .getAsJsonObject().getAsJsonObject("input");
            return input.get("type").getAsString();
        } catch (RuntimeException unknown) {
            return "?";
        }
    }

    public SabTransport(final java.util.function.IntFunction<String> snapshots) {
        this(snapshots, java.util.Collections.emptySet());
    }

    public SabTransport(final java.util.function.IntFunction<String> snapshots,
            final java.util.Set<Integer> botSeats) {
        this.snapshots = snapshots;
        this.botSeats = botSeats;
    }

    @Override
    public String exchange(final String promptJson) {
        return exchange(0, promptJson);
    }

    @Override
    public String exchange(final int playerIndex, final String promptJson) {
        final int seat = playerIndex < 0 ? 0 : playerIndex;
        final String type = inputType(promptJson);
        final boolean dice = "diceRolled".equals(type);
        final boolean bot = !dice && botSeats.contains(seat);
        // Broadcast before the telemetry post so `turnNow` is the turn this
        // prompt belongs to. A bot's prompt updates the bot alone: the people
        // at the table see the board on their own next prompt, as they did
        // when Forge's AI held these seats.
        final long botStartedAt = bot ? System.currentTimeMillis() : 0;
        if (bot) {
            sendState(seat);
        } else {
            broadcastState(dice);
        }
        // Engine think time: from a person's answer landing to that person's
        // next prompt being ready, bot prompts in between included. This is
        // the analogue of the hosted node-side figure, and unlike a
        // client-side measurement it is not quantised by the reader's
        // requestAnimationFrame loop.
        //
        // `turns` is how many turns passed inside that window. Anything above
        // zero means the opponents took their turns in it, which is most of
        // what a large reading is: this is not one decision being slow.
        // `bot` is the part of the window spent on bot prompts.
        if (!bot) {
            if (lastRecvAt > 0) {
                final int turns = turnAtLastPrompt < 0 ? 0 : Math.max(0, turnNow - turnAtLastPrompt);
                post("forge:decision", "{\"ms\":" + (System.currentTimeMillis() - lastRecvAt)
                        + ",\"bot\":" + botMsSinceRecv
                        + ",\"turns\":" + turns
                        + ",\"type\":\"" + type + "\"}");
            }
            turnAtLastPrompt = turnNow;
        }
        if (dice) {
            return exchangeWithAllSeats(promptJson);
        }
        sendTagged(seat, "prompt", "prompt", promptJson);

        final JsonObject message = JsonParser.parseString(recv(seat)).getAsJsonObject();
        if (bot) {
            botMsSinceRecv += System.currentTimeMillis() - botStartedAt;
        } else {
            lastRecvAt = System.currentTimeMillis();
            botMsSinceRecv = 0;
        }
        return decodeMessage(seat, message);
    }

    private String exchangeWithAllSeats(final String promptJson) {
        final int seats = Math.max(1, seatCount());
        final JsonObject prompt = JsonParser.parseString(promptJson).getAsJsonObject();
        for (int seat = 0; seat < seats; seat++) {
            prompt.addProperty("decidingPlayerId", "player-" + seat);
            sendTagged(seat, "prompt", "prompt", prompt.toString());
        }
        String result = null;
        for (int seat = 0; seat < seats; seat++) {
            final JsonObject message = JsonParser.parseString(recv(seat)).getAsJsonObject();
            if (result == null || message.has("directive")) {
                result = decodeMessage(seat, message);
            }
        }
        lastRecvAt = System.currentTimeMillis();
        botMsSinceRecv = 0;
        return result;
    }

    private static String decodeMessage(final int seat, final JsonObject message) {
        if (message.has("action")) {
            return message.get("action").toString();
        }
        if (message.has("directive")) {
            final JsonObject canonical = new JsonObject();
            canonical.addProperty("type", "directive");
            canonical.add("directive", message.get("directive"));
            canonical.addProperty("player", seat);
            return canonical.toString();
        }
        return message.toString();
    }

    /**
     * The turn out of a game view, without parsing the whole thing: this runs
     * once per prompt and the view is the largest string the engine produces.
     */
    private static int turnOf(final String view) {
        final int at = view.indexOf("\"turn\":");
        if (at < 0) {
            return -1;
        }
        int cursor = at + 7;
        int turn = 0;
        boolean any = false;
        while (cursor < view.length() && view.charAt(cursor) >= '0' && view.charAt(cursor) <= '9') {
            turn = turn * 10 + (view.charAt(cursor) - '0');
            any = true;
            cursor++;
        }
        return any ? turn : -1;
    }

    /** Every person's seat; `bots` too, which only the dice roll needs. */
    private void broadcastState(final boolean bots) {
        final int seats = Math.max(1, seatCount());
        for (int viewer = 0; viewer < seats; viewer++) {
            if (bots || !botSeats.contains(viewer)) {
                sendState(viewer);
            }
        }
    }

    private void sendState(final int viewer) {
        final String view = snapshots == null ? null : snapshots.apply(viewer);
        if (view == null || view.isEmpty()) {
            return;
        }
        final int turn = turnOf(view);
        if (turn >= 0) {
            turnNow = turn;
        }
        // The client reads state.gameView, matching GameSnapshotEventDto on
        // the Rust side; a bare game view leaves the board unmounted.
        sendTagged(viewer, "state", "state", "{\"checkpointId\":" + (++checkpoint)
                + ",\"label\":\"forge\",\"gameView\":" + view
                + ",\"timestampMs\":" + System.currentTimeMillis() + "}");
    }

    public void publishGameOver(final String engineError) {
        final int seats = Math.max(1, seatCount());
        for (int seat = 0; seat < seats; seat++) {
            if (engineError != null && !engineError.isEmpty()) {
                sendTagged(seat, "error", "error", "{\"code\":\"engineCrash\",\"message\":"
                        + new com.google.gson.JsonPrimitive(engineError) + "}");
            }
            final String view = snapshots == null ? null : snapshots.apply(seat);
            if (view != null && !view.isEmpty()) {
                sendTagged(seat, "state", "state", "{\"checkpointId\":" + (++checkpoint)
                        + ",\"label\":\"forge\",\"gameView\":" + view
                        + ",\"timestampMs\":" + System.currentTimeMillis() + "}");
            }
            sendTagged(seat, "prompt", "prompt", "{\"promptId\":" + (++finalPromptId)
                    + ",\"decidingPlayerId\":\"player-" + seat
                    + "\",\"input\":{\"type\":\"gameOver\"}}");
        }
    }

    private static void sendTagged(
            final int seat, final String kind, final String field, final String body) {
        final String framed = "{\"kind\":\"" + kind + "\",\"" + field + "\":" + body + "}";
        if (!send(seat, framed)) {
            System.err.println("[wasm] " + kind + " payload is " + (framed.length() / 1024)
                    + " KiB and does not fit the shared buffer, dropping it");
        }
    }
}
