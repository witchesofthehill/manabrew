export function forgeWasm() {
  return {
    name: "manabrew-forge-wasm",
    config() {
      return {
        assetsInclude: ["**/*.rkyv"],
        optimizeDeps: { exclude: ["@manabrew/forge-wasm"] },
      };
    },
  };
}
