package forge.harness.wasm;

import org.graalvm.webimage.api.JS;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

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
     * The tar as a latin1 string: one char per byte, so the bytes survive
     * intact and Java recovers them with a straight ISO-8859-1 decode.
     *
     * String is the only bulk type that crosses the @JS boundary cheaply, and
     * this avoids base64's 33% inflation and its decode pass. There is no way
     * to share the buffer outright: WasmGC keeps Java objects in GC structs
     * rather than linear memory, so a byte[] has no address a SharedArrayBuffer
     * could alias.
     */
    @JS.Coerce
    @JS("const fs = require('fs'); const zlib = require('zlib');"
        + "return zlib.gunzipSync(fs.readFileSync(path)).toString('latin1');")
    static native String hostReadAssets(String path);

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
            String raw = hostReadAssets("assets.tar.gz");
            long tFetch = System.currentTimeMillis();
            System.out.println("[wasm] latin1 path: JS gunzip produced " + (raw.length() / 1024) + " KiB in " + (tFetch - t0) + "ms");
            byte[] tar = raw.getBytes(StandardCharsets.ISO_8859_1);
            long tDecode = System.currentTimeMillis();
            System.out.println("[wasm] latin1 path: recovered " + (tar.length / 1024) + " KiB in " + (tDecode - tFetch) + "ms");
            Path root = Path.of("/forge-gui");
            Files.createDirectories(root);
            untar(tar, root);
            System.out.println("[wasm] latin1 path: total boot " + (System.currentTimeMillis() - t0) + "ms");
        }

        String[] forwarded = new String[args.length + 2];
        forwarded[0] = "--forge-home";
        forwarded[1] = "/forge-gui/";
        System.arraycopy(args, 0, forwarded, 2, args.length);

        forge.harness.Main.main(forwarded);
        System.out.println("[wasm] total " + (System.currentTimeMillis() - t0) + "ms");
    }
}
