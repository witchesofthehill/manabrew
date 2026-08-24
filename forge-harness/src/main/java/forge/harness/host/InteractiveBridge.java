package forge.harness.host;

/**
 * Supplies player actions synchronously instead of through the action queue.
 *
 * Single-threaded targets (GraalVM Web Image) cannot run the game on its own
 * thread, so the engine has to block in place while the client decides. The
 * implementation lives outside this jar; see forge-harness/native/wasm-src.
 */
public interface InteractiveBridge {

    /** Publishes the prompt and blocks until the client answers it. */
    String exchange(String promptJson);
}
