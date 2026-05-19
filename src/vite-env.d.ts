/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_HOST?: string;
  readonly VITE_RELAY_PORT?: string;
  readonly VITE_RELAY_PASSWORD?: string;
  readonly VITE_SCRYFALL_SYMBOL_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// `unplugin-icons` with `compiler: 'raw'` exports the plain SVG string
// as the default import for any `~icons/<set>/<name>` module. Declare
// this here instead of pulling in `unplugin-icons/types/react`, which
// would type the imports as React components and shadow the string
// contract we rely on in `PointerLayer`.
declare module "~icons/*" {
  const svg: string;
  export default svg;
}
