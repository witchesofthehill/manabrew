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

    /**
     * Same, for the seat the prompt is addressed to.
     *
     * <p>Hosting a table means every seat has its own transport, so a bridge
     * that serves more than one player needs to know which one is being asked.
     * A single-seat bridge can ignore it.
     */
    default String exchange(int playerIndex, String promptJson) {
        return exchange(promptJson);
    }
}
