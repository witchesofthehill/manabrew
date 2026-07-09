/**
 * Platform abstraction entry point.
 *
 * This module provides automatic platform detection and a singleton
 * accessor for the platform API. It allows the React frontend to work
 * seamlessly with both Tauri (desktop) and Web (WASM) backends.
 *
 * Usage:
 * ```typescript
 * import { getPlatform, usePlatform } from '@/platform';
 *
 * // Function usage
 * const platform = getPlatform();
 * await platform.game.startGame({ ... });
 *
 * // React hook usage
 * function MyComponent() {
 *   const platform = usePlatform();
 *   // ...
 * }
 * ```
 */

import { createContext, useContext } from "react";
import type { IPlatformApi, PlatformFeature } from "./types";
import { TauriPlatform } from "./tauri";
import { WebPlatform } from "./web";

// Re-export types for convenience
export type {
  IPlatformApi,
  IGameApi,
  IServerApi,
  IStorageApi,
  IEventBus,
  PlatformFeature,
  StartGameParams,
  StartMultiplayerGameParams,
  RespondParams,
  RestoreSnapshotParams,
  SendDirectiveParams,
  ServerConnectParams,
  CreateRoomParams,
  JoinRoomParams,
  SetReadyParams,
  SetDeckSelectionParams,
} from "./types";
export type { RoomRelayEnvelope, RoomMessagePayload } from "@/types/server";

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect if running in a Tauri environment.
 */
function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2 uses __TAURI_INTERNALS__, v1 used __TAURI__
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((window as any).__TAURI_INTERNALS__ !== undefined || (window as any).__TAURI__ !== undefined)
  );
}

/**
 * Get the current platform type.
 */
export function getPlatformType(): "tauri" | "web" {
  return isTauriEnvironment() ? "tauri" : "web";
}

// ============================================================================
// Singleton Platform Instance
// ============================================================================

let platformInstance: IPlatformApi | null = null;

/**
 * Get the platform API singleton.
 *
 * This lazily creates the appropriate platform implementation based on
 * the runtime environment (Tauri or Web).
 */
export function getPlatform(): IPlatformApi {
  if (!platformInstance) {
    const platformType = getPlatformType();

    if (platformType === "tauri") {
      platformInstance = new TauriPlatform();
      console.log("[Platform] Initialized Tauri platform");
    } else {
      platformInstance = new WebPlatform();
      console.log("[Platform] Initialized Web platform");
    }
  }

  return platformInstance;
}

/**
 * Reset the platform instance (for testing).
 */
export function resetPlatform(): void {
  platformInstance = null;
}

// ============================================================================
// React Context
// ============================================================================

/**
 * React context for the platform API.
 *
 * While `getPlatform()` works anywhere, this context is useful for:
 * - Dependency injection in tests
 * - Server-side rendering (if needed in future)
 * - Explicit platform switching
 */
export const PlatformContext = createContext<IPlatformApi | null>(null);

/**
 * React hook to get the platform API.
 *
 * Uses the context if available, otherwise falls back to `getPlatform()`.
 */
export function usePlatform(): IPlatformApi {
  const contextPlatform = useContext(PlatformContext);
  return contextPlatform ?? getPlatform();
}

/**
 * Check if a feature is supported on the current platform.
 */
export function isFeatureSupported(feature: PlatformFeature): boolean {
  return getPlatform().isSupported(feature);
}

// ============================================================================
// Convenience Accessors
// ============================================================================

/**
 * Get the game API directly.
 */
export function getGameApi() {
  return getPlatform().game;
}

/**
 * Get the storage API directly.
 */
export function getStorageApi() {
  return getPlatform().storage;
}

/**
 * Get the event bus directly.
 */
export function getEventBus() {
  return getPlatform().events;
}

/**
 * Get the server API (only available on Tauri).
 * Returns undefined on Web platform.
 */
export function getServerApi() {
  return getPlatform().server;
}
