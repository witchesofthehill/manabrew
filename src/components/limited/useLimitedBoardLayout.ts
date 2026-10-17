import { useState } from "react";
import type { BuildZone } from "@/components/limited/useLimitedBuildStore";

export function useLimitedBoardLayout() {
  const [mobileZone, setMobileZone] = useState<BuildZone>("pool");
  const [visibleZones, setVisibleZones] = useState<BuildZone[]>(["pool"]);
  const showZone = (zone: BuildZone) => {
    setVisibleZones((current) => (current.includes(zone) ? current : [...current, zone]));
    setMobileZone(zone);
  };
  const toggleZone = (zone: BuildZone) => {
    if (!visibleZones.includes(zone)) {
      setVisibleZones((current) => [...current, zone]);
      return;
    }
    if (visibleZones.length === 1) return;
    const remaining = visibleZones.filter((candidate) => candidate !== zone);
    setVisibleZones(remaining);
    if (mobileZone === zone) setMobileZone(remaining[0]);
  };
  return { mobileZone, visibleZones, showZone, toggleZone };
}
