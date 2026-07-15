// The /design-system reference route ships in every dev build, and in a
// production build only when a deployment opts in via the runtime config
// (`window.__MANABREW_RUNTIME__.designSystem`, written by the web image's
// entrypoint from the DESIGN_SYSTEM env var). Read once at module load —
// config.js is a classic script that runs before the app module.
export const DESIGN_SYSTEM_ENABLED: boolean =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && window.__MANABREW_RUNTIME__?.designSystem === true);
