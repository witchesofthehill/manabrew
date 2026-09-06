import { useEffect } from "react";
import { useHubStore } from "@/stores/useHubStore";

/** Whether a hub answered its capabilities probe. Actions that need one hide until it has. */
export function useHubAvailable(): boolean {
  const capabilities = useHubStore((s) => s.capabilities);
  const loadCapabilities = useHubStore((s) => s.loadCapabilities);
  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);
  return capabilities != null;
}
