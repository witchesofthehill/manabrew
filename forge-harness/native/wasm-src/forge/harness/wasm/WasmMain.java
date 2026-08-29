package forge.harness.wasm;

import org.graalvm.webimage.api.JS;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

import forge.harness.host.ManaBrewInteractiveSession;

/**
 * Web Image entry point for the Forge harness.
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
     */
    @JS.Coerce
    @JS(// The browser host builds the bundle from cardset.rkyv and leaves it
        // here, so nothing is packed or shipped a second time.
        "if (typeof self !== 'undefined' && self.__forgeAssets) return self.__forgeAssets;"
        + "if (typeof require === 'function') {"
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

    @JS(args = {"fn"}, value = "globalThis.__forgeStartGame = fn;")
    private static native void exportStartGame(java.util.function.Function<org.graalvm.webimage.api.JSString, org.graalvm.webimage.api.JSString> fn);

    @JS.Coerce
    @JS("return Array.isArray(globalThis.__forgeSeatSabs) && globalThis.__forgeSeatSabs.length > 0;")
    private static native boolean hasSeatBuffers();

    @JS("globalThis.__forgeReady = true;"
        + "const resolve = globalThis.__forgeBootResolve;"
        + "globalThis.__forgeBootResolve = null;"
        + "if (resolve) resolve();"
        + "postMessage({ type: 'event', event: 'forge:ready', payload: {} });")
    private static native void announceReady();

    /**
     * Stays resident and hands the host a start function, so the app owns the
     * game lifecycle exactly as it does for the Rust engine. The call blocks
     * for the whole game: the bridge keeps the loop on this thread.
     */
    private static void serve() throws Exception {
        forge.harness.host.ManaBrewEngineAdapter adapter = new forge.harness.host.ManaBrewEngineAdapter();
        adapter.initialize("/forge-gui/");
        System.out.println("[wasm] forge initialized, waiting for a game");

        exportStartGame((request) -> {
            String requestJson = request.asString();
            try {
                // A table this browser hosts hands over one buffer per seat;
                // a game against the AI hands over one. Either way the host
                // owns the buffers and the engine only binds to them.
                if (hasSeatBuffers()) {
                    SabTransport.bindSeats();
                } else {
                    SabTransport.bind();
                }
                String gameId = com.google.gson.JsonParser.parseString(requestJson)
                        .getAsJsonObject().get("gameId").getAsString();
                final SabTransport transport =
                        new SabTransport(viewer -> adapter.getSnapshot(gameId, viewer));
                ManaBrewInteractiveSession.setBridge(transport);
                final String result = adapter.startGameJson(requestJson);
                // startGameJson blocks for the whole game, so reaching this
                // line means the game is over and every seat is still waiting
                // on an answer that will never come.
                System.out.println("[wasm] game over, publishing the final board");
                transport.publishGameOver();
                return org.graalvm.webimage.api.JSString.of(result);
            } catch (RuntimeException error) {
                error.printStackTrace(System.err);
                return org.graalvm.webimage.api.JSString.of(
                        "{\"error\":\"" + String.valueOf(error.getMessage()).replace("\"", "'") + "\"}");
            }
        });
        announceReady();
    }

    private static final String FORGE_HOME = "/forge-home";

    /**
     * The files Forge opens at startup, seeded so the reads succeed.
     *
     * <p>Three of them are XML documents with a {@code <preferences>} root
     * ({@code CardPreferences}, {@code DeckPreferences},
     * {@code ItemManagerConfig}) — an empty file is not "no preferences", it is
     * a parse error, and Forge prints a fatal-looking SAX trace for each.
     * {@code forge.preferences} is a plain key=value file, where empty is
     * exactly right.
     */
    private static void prepareHome() throws Exception {
        Path preferences = Path.of(FORGE_HOME, ".forge", "preferences");
        Files.createDirectories(preferences);
        String emptyXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<preferences/>\n";
        writeIfAbsent(preferences.resolve("card.preferences"), emptyXml);
        writeIfAbsent(preferences.resolve("deck.preferences"), emptyXml);
        writeIfAbsent(preferences.resolve("item_view.preferences"), emptyXml);
        writeIfAbsent(preferences.resolve("forge.preferences"), "");
    }

    private static void writeIfAbsent(final Path path, final String body) throws Exception {
        if (!Files.exists(path)) {
            Files.writeString(path, body);
        }
    }

    public static void main(String[] args) throws Exception {
        // Must be set before any forge class initializes: ThreadUtil reads it in
        // a static initializer. native-image's own -D only reaches the builder.
        System.setProperty("forge.synchronous", "true");
        // PresetDecks resolves its default dirs relative to the process CWD,
        // which is meaningless in the VFS.
        System.setProperty("preset.decks.dir", "/forge-gui/parity_decks");
        // There is no home directory in a browser, so Forge fell back to a
        // placeholder it could not read or write: every boot printed a stack
        // trace per preferences file it failed to open. Give it a real one in
        // the VFS. It lives as long as the worker does, which is one session:
        // nothing here survives a reload.
        System.setProperty("user.home", FORGE_HOME);
        prepareHome();

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

        if (args.length > 0 && "--serve".equals(args[0])) {
            serve();
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
