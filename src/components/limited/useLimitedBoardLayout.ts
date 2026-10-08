import { useState } from "react";
import type { BuildZone } from "@/components/limited/useLimitedBuildStore";

export function useLimitedBoardLayout() {
  const [mobileZone, setMobileZone] = useState<BuildZone>("pool");
  const [visibleZones, setVisibleZones] = useState<BuildZone[]>([
    "pool",
    "main",
    "sideboard",
    "maybe",
  ]);
  const [expandedZone, setExpandedZone] = useState<BuildZone | null>("pool");
  const showZone = (zone: BuildZone) => {
    setVisibleZones((current) => (current.includes(zone) ? current : [...current, zone]));
    setMobileZone(zone);
    setExpandedZone((current) => (current ? zone : null));
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
    if (expandedZone === zone) setExpandedZone(null);
  };
  return { mobileZone, visibleZones, expandedZone, showZone, toggleZone };
}
