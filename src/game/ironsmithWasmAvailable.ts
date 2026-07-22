// Ironsmith's trusted-runtime WASM ships as the `ironsmith-wasm` npm dependency,
// so it is always bundled. The flag is retained so the runtime registry and
// lobby tile keep a single availability gate; the Settings opt-in
// (`ironsmithRuntimeEnabled`) is what actually surfaces the experimental engine.
export const IRONSMITH_WASM_AVAILABLE = true as const;
