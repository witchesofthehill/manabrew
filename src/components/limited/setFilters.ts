// Pure constants shared by the `SetPicker` component and the lobby's
// draft-launch dialog. Lives outside `SetPicker.tsx` so Vite's
// react-refresh plugin can fast-refresh the component without
// invalidating consumers that just import these constants.

/** Set types worth drafting/sealed-ing. Other Scryfall set types
 *  (commander, archenemy, planechase, …) get filtered out by the
 *  caller before handing the list to `SetPicker`. */
export const DRAFTABLE_SET_TYPES = new Set([
  "expansion",
  "core",
  "masters",
  "draft_innovation",
  "starter",
]);

export const SET_TYPE_LABELS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "expansion", label: "Expansion" },
  { key: "core", label: "Core" },
  { key: "masters", label: "Masters" },
  { key: "draft_innovation", label: "Draft Innovation" },
  { key: "starter", label: "Starter" },
];
