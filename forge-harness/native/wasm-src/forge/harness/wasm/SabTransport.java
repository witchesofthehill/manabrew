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

    public static final int DEFAULT_BUFFER_SIZE = 256 * 1024;

    @JS.Coerce
    @JS("globalThis.__mbSab = new SharedArrayBuffer(size);"
        + "globalThis.__mbSig = new Int32Array(globalThis.__mbSab, 0, 2);"
        + "globalThis.__mbData = new Uint8Array(globalThis.__mbSab, 8);"
        + "globalThis.__mbSeats = [{ sig: globalThis.__mbSig, data: globalThis.__mbData }];"
        + "globalThis.__mbSeatOf = () => 0;"
        + "postMessage({ type: 'sab', sab: globalThis.__mbSab });"
        + "return true;")
    static native boolean install(int size);

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

    private final java.util.function.IntFunction<String> snapshots;
    private long checkpoint;
    private long lastRecvAt;

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
        // Engine think time: from the client's answer landing to the next
        // prompt being ready. This is the analogue of the hosted node-side
        // figure, and unlike a client-side measurement it is not quantised by
        // the reader's requestAnimationFrame loop.
        if (lastRecvAt > 0) {
            post("forge:decision", "{\"ms\":" + (System.currentTimeMillis() - lastRecvAt)
                    + ",\"type\":\"" + inputType(promptJson) + "\"}");
        }

        // Each seat sees the board through its own eyes: hidden zones are cut
        // per viewer, so hosting a table must not publish seat 0's view to
        // everyone.
        final String view = snapshots == null ? null : snapshots.apply(seat);
        if (view != null && !view.isEmpty()) {
            // The client reads state.gameView, matching GameSnapshotEventDto on
            // the Rust side; a bare game view leaves the board unmounted.
            sendTagged(seat, "state", "state", "{\"checkpointId\":" + (++checkpoint)
                    + ",\"label\":\"forge\",\"gameView\":" + view
                    + ",\"timestampMs\":" + System.currentTimeMillis() + "}");
        }
        sendTagged(seat, "prompt", "prompt", promptJson);

        final JsonObject message = JsonParser.parseString(recv(seat)).getAsJsonObject();
        lastRecvAt = System.currentTimeMillis();
        // ClientToServerMessage::Response -> {"kind":"response","promptId":N,"action":{...}}
        if (message.has("action")) {
            return message.get("action").toString();
        }
        return message.toString();
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
