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
    private long checkpoint;
    private long lastRecvAt;
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
        this.snapshots = snapshots;
    }

    @Override
    public String exchange(final String promptJson) {
        return exchange(0, promptJson);
    }

    @Override
    public String exchange(final int playerIndex, final String promptJson) {
        final int seat = playerIndex < 0 ? 0 : playerIndex;
        // Broadcast before the telemetry post so `turnNow` is the turn this
        // prompt belongs to.
        broadcastState();
        // Engine think time: from the client's answer landing to the next
        // prompt being ready. This is the analogue of the hosted node-side
        // figure, and unlike a client-side measurement it is not quantised by
        // the reader's requestAnimationFrame loop.
        //
        // `turns` is how many turns passed inside that window. Anything above
        // zero means the opponents took their turns in it, which is most of
        // what a large reading is: this is not one decision being slow.
        if (lastRecvAt > 0) {
            final int turns = turnAtLastPrompt < 0 ? 0 : Math.max(0, turnNow - turnAtLastPrompt);
            post("forge:decision", "{\"ms\":" + (System.currentTimeMillis() - lastRecvAt)
                    + ",\"turns\":" + turns
                    + ",\"type\":\"" + inputType(promptJson) + "\"}");
        }
        turnAtLastPrompt = turnNow;
        if ("diceRolled".equals(inputType(promptJson))) {
            return exchangeWithAllSeats(promptJson);
        }
        sendTagged(seat, "prompt", "prompt", promptJson);

        final JsonObject message = JsonParser.parseString(recv(seat)).getAsJsonObject();
        lastRecvAt = System.currentTimeMillis();
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

    private void broadcastState() {
        final int seats = Math.max(1, seatCount());
        for (int viewer = 0; viewer < seats; viewer++) {
            final String view = snapshots == null ? null : snapshots.apply(viewer);
            if (view == null || view.isEmpty()) {
                continue;
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
    }

    /**
     * The last thing a game says.
     *
     * <p>The engine runs the whole game inside one blocking call, so when that
     * call returns there is nobody left to answer anything: a client still
     * waiting on its last answer waits forever, and a concede written into the
     * buffer is never read. Publishing the final board — which carries
     * gameOver and the winner — and a gameOver prompt to every seat is what
     * the Rust engine does at the same point, and it is what lets the client
     * show the result instead of "waiting for the opponent".
     */
    public void publishGameOver() {
        final int seats = Math.max(1, seatCount());
        for (int seat = 0; seat < seats; seat++) {
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
