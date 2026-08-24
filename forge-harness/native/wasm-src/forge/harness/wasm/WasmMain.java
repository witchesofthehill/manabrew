package forge.harness.wasm;

import org.graalvm.webimage.api.JS;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import forge.harness.host.ManaBrewInteractiveSession;

/**
 * Web Image entry point for the Forge harness.
 *
 * Two Web Image constraints shape this class, both measured rather than assumed:
 *
 *  1. The image gets an empty in-memory filesystem (jimfs) with no host mount,
 *     so Forge's assets must be pushed in before {@code FModel.initialize} runs.
 *  2. {@code java.util.zip} is dead. Inflater fails with
 *     "UnsatisfiedLinkError: Can't load library: zip", which also kills Forge's
 *     own cardsfolder.zip reader. Decompression has to happen on the JS side,
 *     where both Node (zlib) and browsers (DecompressionStream) do it natively.
 *
 * There is also no typed-array to byte[] coercion, so bulk bytes cross the
 * boundary inside a String. Both encodings are kept here to keep the
 * measurement reproducible: latin1 by default, base64 under
 * -Dwasm.assets.base64.
 *
 * This is boot-time only. Per-move traffic never uses either path — it goes
 * over the SharedArrayBuffer, same protocol as
 * manabrew-rs/crates/wasm/src/wasm_transport.rs.
 *
 * The archive is read through Node's fs purely so the spike runs on the command
 * line. In the browser the same bytes come from fetch() plus the Cache API,
 * which is already how src/workers/game-engine.worker.ts ships the Rust
 * engine's card archive.
 */
public final class WasmMain {

    private static final int TAR_BLOCK = 512;

    private WasmMain() {
    }

    @JS.Coerce
    @JS("const fs = require('fs'); const zlib = require('zlib');"
        + "return zlib.gunzipSync(fs.readFileSync(path)).toString('base64');")
    static native String hostReadGunzippedBase64(String path);

    /**
     * Assets as one NUL-framed "path\0body\0..." string.
     *
     * Everything Forge reads here is text, so this stays out of binary entirely:
     * the browser decodes it as ordinary UTF-8 rather than paying for the
     * x-user-defined byte-per-char trick, which dominated boot time. String is
     * the only bulk type that crosses the @JS boundary cheaply anyway, since
     * WasmGC keeps Java objects in GC structs rather than linear memory, so a
     * byte[] has no address a SharedArrayBuffer could alias.
     */
    @JS.Coerce
    @JS("if (typeof require === 'function') {"
        + "  const fs = require('fs'); const zlib = require('zlib');"
        + "  return zlib.gunzipSync(fs.readFileSync(path)).toString('utf8');"
        + "}"
        // Workers allow synchronous XHR, which is the only way an @JS snippet
        // can hand bytes back: fetch is async and this must return a value.
        // The wire stays compressed because the server sets Content-Encoding.
        + "const url = new URL(path.replace(/\\.gz$/, ''), self.location.href).href;"
        + "console.log('[assets] GET ' + url);"
        + "const xhr = new XMLHttpRequest();"
        + "xhr.open('GET', url, false);"
        + "xhr.send(null);"
        + "console.log('[assets] status ' + xhr.status + ', ' + xhr.responseText.length + ' chars');"
        + "if (xhr.status !== 200 && xhr.status !== 0) throw new Error('asset fetch failed: ' + xhr.status);"
        + "return xhr.responseText;")
    static native String hostReadAssets(String path);

    private static void writeFramed(String framed, Path root) throws Exception {
        int files = 0;
        int i = 0;
        while (i < framed.length()) {
            int sep = framed.indexOf('\0', i);
            if (sep < 0) {
                break;
            }
            String name = framed.substring(i, sep);
            int end = framed.indexOf('\0', sep + 1);
            if (end < 0) {
                end = framed.length();
            }
            Path target = root.resolve(name);
            Files.createDirectories(target.getParent());
            Files.writeString(target, framed.substring(sep + 1, end));
            files++;
            i = end + 1;
        }
        System.out.println("[wasm] wrote " + files + " files into the VFS");
    }

    /** Minimal ustar reader. Only the fields Forge's asset tree actually uses. */
    private static void untar(byte[] tar, Path root) throws Exception {
        int offset = 0;
        int files = 0;
        long bytes = 0;
        while (offset + TAR_BLOCK <= tar.length) {
            // Two consecutive zero blocks terminate the archive.
            if (tar[offset] == 0) {
                break;
            }
            String name = cstr(tar, offset, 100);
            long size = octal(tar, offset + 124, 12);
            char type = (char) tar[offset + 156];
            offset += TAR_BLOCK;

            Path target = root.resolve(name);
            if (type == '5') {
                Files.createDirectories(target);
            } else if (type == '0' || type == 0) {
                Files.createDirectories(target.getParent());
                byte[] content = new byte[(int) size];
                System.arraycopy(tar, offset, content, 0, (int) size);
                Files.write(target, content);
                files++;
                bytes += size;
            }
            // Payloads are padded up to the next 512-byte boundary.
            offset += (int) ((size + TAR_BLOCK - 1) / TAR_BLOCK) * TAR_BLOCK;
        }
        System.out.println("[wasm] unpacked " + files + " files, " + (bytes / 1024) + " KiB into the VFS");
    }

    private static String cstr(byte[] b, int off, int max) {
        int end = off;
        while (end < off + max && b[end] != 0) {
            end++;
        }
        return new String(b, off, end - off, StandardCharsets.UTF_8);
    }

    private static long octal(byte[] b, int off, int len) {
        long value = 0;
        for (int i = off; i < off + len; i++) {
            int c = b[i];
            if (c < '0' || c > '7') {
                continue;
            }
            value = value * 8 + (c - '0');
        }
        return value;
    }

    private static final String GAME_ID = "web-image-demo";

    /** Expands a parity deck (name + count) into the flat deck the adapter wants. */
    private static JsonArray deckFrom(String path) throws Exception {
        JsonObject root = JsonParser.parseString(Files.readString(Path.of(path))).getAsJsonObject();
        JsonArray out = new JsonArray();
        for (JsonElement entry : root.getAsJsonArray("cards")) {
            JsonObject card = entry.getAsJsonObject();
            int count = card.has("count") ? card.get("count").getAsInt() : 1;
            for (int i = 0; i < count; i++) {
                JsonObject identity = new JsonObject();
                identity.addProperty("name", card.get("name").getAsString());
                out.add(identity);
            }
        }
        return out;
    }

    private static JsonObject seat(String name, JsonArray deck, boolean ai) {
        JsonObject player = new JsonObject();
        player.addProperty("name", name);
        player.addProperty("ai", ai);
        player.add("deck", deck);
        return player;
    }

    private static void runBrowserGame(String[] args) throws Exception {
        SabTransport.install(SabTransport.DEFAULT_BUFFER_SIZE);

        forge.harness.host.ManaBrewEngineAdapter adapter = new forge.harness.host.ManaBrewEngineAdapter();
        adapter.initialize("/forge-gui/");
        System.out.println("[wasm] forge initialized, starting game");

        ManaBrewInteractiveSession.setBridge(
                new SabTransport(viewer -> adapter.getSnapshot(GAME_ID, viewer)));

        JsonArray players = new JsonArray();
        players.add(seat("You", deckFrom("/forge-gui/parity_decks/red_burn.json"), false));
        players.add(seat("Forge AI", deckFrom("/forge-gui/parity_decks/green_stompy.json"), true));

        JsonObject request = new JsonObject();
        request.addProperty("gameId", GAME_ID);
        request.addProperty("variant", "Constructed");
        request.addProperty("startingLife", 20);
        request.addProperty("seed", 42L);
        request.add("players", players);

        // Blocks until the game ends: the bridge keeps the loop on this thread.
        adapter.startGameJson(request.toString());

        System.out.println("[wasm] game over");
        SabTransport.post("game:over", "{\"gameId\":\"" + GAME_ID + "\"}");
    }

    public static void main(String[] args) throws Exception {
        // Must be set before any forge class initializes: ThreadUtil reads it in
        // a static initializer. native-image's own -D only reaches the builder.
        System.setProperty("forge.synchronous", "true");
        // PresetDecks resolves its default dirs relative to the process CWD,
        // which is meaningless in the VFS.
        System.setProperty("preset.decks.dir", "/forge-gui/parity_decks");

        long t0 = System.currentTimeMillis();
        System.out.println("[wasm] availableProcessors=" + Runtime.getRuntime().availableProcessors());

        if (Boolean.getBoolean("wasm.assets.base64")) {
            String b64 = hostReadGunzippedBase64("assets.tar.gz");
            long tFetch = System.currentTimeMillis();
            System.out.println("[wasm] base64 path: JS produced " + (b64.length() / 1024) + " KiB in " + (tFetch - t0) + "ms");
            byte[] tar = Base64.getDecoder().decode(b64);
            long tDecode = System.currentTimeMillis();
            System.out.println("[wasm] base64 path: decoded " + (tar.length / 1024) + " KiB in " + (tDecode - tFetch) + "ms");
            Path root = Path.of("/forge-gui");
            Files.createDirectories(root);
            untar(tar, root);
            System.out.println("[wasm] base64 path: total boot " + (System.currentTimeMillis() - t0) + "ms");
        } else {
            // Measured: one call beats slicing. 11 MB takes ~0.6s on Node and
            // ~40s in Chrome, and 44 chunked crossings made Chrome worse (~68s),
            // so the cost is per-crossing overhead rather than payload size.
            String framed = hostReadAssets("assets.txt.gz");
            long tFetch = System.currentTimeMillis();
            System.out.println("[wasm] pulled " + (framed.length() / 1024) + " KiB across the JS boundary in " + (tFetch - t0) + "ms");
            Path root = Path.of("/forge-gui");
            Files.createDirectories(root);
            writeFramed(framed, root);
            System.out.println("[wasm] total boot " + (System.currentTimeMillis() - t0) + "ms");
        }

        if (args.length > 0 && "--browser".equals(args[0])) {
            runBrowserGame(args);
            return;
        }

        String[] forwarded = new String[args.length + 2];
        forwarded[0] = "--forge-home";
        forwarded[1] = "/forge-gui/";
        System.arraycopy(args, 0, forwarded, 2, args.length);

        forge.harness.Main.main(forwarded);
        System.out.println("[wasm] total " + (System.currentTimeMillis() - t0) + "ms");
    }
}
