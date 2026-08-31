export interface ForgeWasmVitePlugin {
  name: string;
  config(): {
    assetsInclude: string[];
    optimizeDeps: { exclude: string[] };
  };
}

export declare function forgeWasm(): ForgeWasmVitePlugin;
