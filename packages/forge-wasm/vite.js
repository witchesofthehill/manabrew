export function forgeWasm() {
  return {
    name: "manabrew-forge-wasm",
    config() {
      return {
        optimizeDeps: { exclude: ["@manabrew/forge-wasm"] },
      };
    },
  };
}
