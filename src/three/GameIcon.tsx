import paths from "@/three/assets/ui-icons.json";

export function GameIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="duel-game-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
