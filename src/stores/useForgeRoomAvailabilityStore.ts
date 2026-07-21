import { create } from "zustand";
import { getPlatform, getPlatformType } from "@/platform";

interface ForgeRoomAvailabilityState {
  available: boolean;
}

export const useForgeRoomAvailabilityStore = create<ForgeRoomAvailabilityState>(() => ({
  available: false,
}));

let availabilityPromise: Promise<void> | null = null;

export function initializeForgeRoomAvailability(): Promise<void> {
  if (availabilityPromise) return availabilityPromise;
  if (getPlatformType() !== "tauri") {
    availabilityPromise = Promise.resolve();
    return availabilityPromise;
  }
  availabilityPromise = getPlatform()
    .invoke<boolean>("forge_room_available")
    .then((available) => useForgeRoomAvailabilityStore.setState({ available }))
    .catch(() => useForgeRoomAvailabilityStore.setState({ available: false }));
  return availabilityPromise;
}

export function isTauriForgeRoomAvailable(): boolean {
  return useForgeRoomAvailabilityStore.getState().available;
}
