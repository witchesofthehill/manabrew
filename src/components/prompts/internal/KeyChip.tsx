import { comboSymbols, type KeyCombo } from "@/lib/keybindings";

export function KeyChip({ combo }: { combo: KeyCombo }) {
  return (
    <kbd
      className="rounded-[4px] bg-black/25 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-normal text-white/85 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.35)]"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      {comboSymbols(combo)}
    </kbd>
  );
}
