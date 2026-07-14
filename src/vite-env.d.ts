/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCRYFALL_SYMBOL_BASE?: string;
  readonly VITE_HOSTED_AI_ENABLED?: string;
  readonly VITE_STATUS_BANNER_URL?: string;
  readonly VITE_RELAY_HOST?: string;
  readonly VITE_RELAY_PORT?: string;
  readonly VITE_RELAY_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Set by `public/config.js` (rewritten at container start by the web image's
// entrypoint). Runtime relay config takes priority over the build-time
// VITE_RELAY_* default — see `config/knownRelays.ts`.
interface Window {
  __MANABREW_RUNTIME__?: {
    relay?: { host?: string; port?: number; password?: string };
    // Runtime toggle for the Forge "Play vs AI" hosted engine. The published
    // web image ships this off; the deployment's entrypoint sets it from
    // HOSTED_AI_ENABLED. Overrides the build-time VITE_HOSTED_AI_ENABLED.
    hostedAiEnabled?: boolean;
  };
}

declare const __APP_VERSION__: string;

// `unplugin-icons` with `compiler: 'raw'` exports the plain SVG string
// as the default import for any `~icons/<set>/<name>` module. Declare
// this here instead of pulling in `unplugin-icons/types/react`, which
// would type the imports as React components and shadow the string
// contract we rely on in `PointerLayer`.
declare module "~icons/*" {
  const svg: string;
  export default svg;
}
