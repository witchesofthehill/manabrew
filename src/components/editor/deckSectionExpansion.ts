import { useEffect, useState } from "react";

const SECTION_EXPANSION_EVENT = "manabrew:deck-section-expansion";

export function setAllDeckSectionsExpanded(expanded: boolean) {
  window.dispatchEvent(new CustomEvent(SECTION_EXPANSION_EVENT, { detail: { expanded } }));
}

export function useDeckSectionOpen(initialOpen = true) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    const handleExpansion = (event: Event) => {
      setOpen((event as CustomEvent<{ expanded: boolean }>).detail.expanded);
    };
    window.addEventListener(SECTION_EXPANSION_EVENT, handleExpansion);
    return () => window.removeEventListener(SECTION_EXPANSION_EVENT, handleExpansion);
  }, []);

  return [open, setOpen] as const;
}

export function useDeckSectionExpansionEffect(onExpand: (expanded: boolean) => void) {
  useEffect(() => {
    const handleExpansion = (event: Event) => {
      onExpand((event as CustomEvent<{ expanded: boolean }>).detail.expanded);
    };
    window.addEventListener(SECTION_EXPANSION_EVENT, handleExpansion);
    return () => window.removeEventListener(SECTION_EXPANSION_EVENT, handleExpansion);
  }, [onExpand]);
}
