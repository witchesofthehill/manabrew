/**
 * Stands in for the direct data plane's wasm module on a build that did not
 * produce it. `ring` compiles C for wasm32, which needs a clang that can target
 * it, so a machine without one builds everything else and lands here instead.
 * `DirectSeat` catches the throw and the seat stays on the relay.
 */
const MESSAGE =
  "the direct data plane was not built (needs a clang that targets wasm32; on macOS: brew install llvm)";

export default function init(): Promise<never> {
  return Promise.reject(new Error(MESSAGE));
}

export const WasmSeat = {
  bindSeat(): Promise<never> {
    return Promise.reject(new Error(MESSAGE));
  },
};
