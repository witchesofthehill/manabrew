package forge.harness.wasm;

import org.graalvm.webimage.api.JS;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import forge.harness.host.ManaBrewInteractiveSession;

/**
 * Web Image entry point for the Forge harness.
 */
public final class WasmMain {

    private WasmMain() {
    }

    private static void writeFramed(InputStream raw, Path root) throws Exception {
        ByteArrayOutputStream segment = new ByteArrayOutputStream(1 << 16);
        byte[] chunk = new byte[1 << 16];
        int files = 0;
        long bytes = 0;
        String name = null;
        int read;
        while ((read = raw.read(chunk)) != -1) {
            int start = 0;
            for (int i = 0; i < read; i++) {
                if (chunk[i] != 0) {
                    continue;
                }
                segment.write(chunk, start, i - start);
                start = i + 1;
                if (name == null) {
                    name = segment.toString(StandardCharsets.UTF_8);
                } else {
                    Path target = root.resolve(name);
                    Files.createDirectories(target.getParent());
                    Files.write(target, segment.toByteArray());
                    files++;
                    bytes += segment.size();
                    name = null;
                }
                segment.reset();
            }
            segment.write(chunk, start, read - start);
        }
        System.out.println("[wasm] streamed " + files + " files, " + (bytes / 1024) + " KiB into the VFS");
    }

    /**
     * Assets embedded in the module at build time
     * ({@code FORGE_ASSETS} + {@code -H:IncludeResources}), read back with
     * no JS crossing at all. The build fails without them, so a module that
     * reaches this method without the resource is a broken build, not a
     * degraded mode to run in.
     */
    private static void loadEmbeddedAssets(long t0) throws Exception {
        try (InputStream embedded = WasmMain.class.getResourceAsStream("/assets-framed.txt")) {
            if (embedded == null) {
                throw new IllegalStateException("assets-framed.txt missing from the module — rebuild with FORGE_ASSETS");
            }
            Path root = Path.of("/forge-gui");
            Files.createDirectories(root);
            writeFramed(embedded, root);
            System.out.println("[wasm] embedded assets: total boot " + (System.currentTimeMillis() - t0) + "ms");
        }
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

        loadEmbeddedAssets(t0);

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
