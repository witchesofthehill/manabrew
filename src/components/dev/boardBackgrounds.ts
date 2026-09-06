import defaultUrl from "@/assets/boardBackground.png";

export interface BoardBackgroundOption {
  label: string;
  url: string | null;
}

const jacoBackgrounds: BoardBackgroundOption[] = Object.entries(
  import.meta.glob<string>("/src/assets/boards/Jaco_*.png", {
    eager: true,
    query: "?url",
    import: "default",
  }),
).map(([path, url]) => ({
  label: path
    .split("/")
    .pop()!
    .replace(/^Jaco_/, "")
    .replace(/\.png$/, ""),
  url,
}));

export const BOARD_BACKGROUNDS: BoardBackgroundOption[] = [
  { label: "None", url: null },
  { label: "Slate", url: defaultUrl },
  ...jacoBackgrounds,
];
