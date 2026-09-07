const entries = [
  [
    "Vigilance",
    "Attacking does not cause this creature to tap.",
    "M2 12Q12 1 22 12Q12 23 2 12ZM12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8",
  ],
  [
    "Flying",
    "Can be blocked only by creatures with flying or reach.",
    "M4 21Q4 8 21 3L17 11L11 13L16 14L10 18L4 21ZM4 21L15 9",
  ],
  ["Reach", "Can block creatures with flying.", "M5 21L18 4M10 4H19V13M5 6Q14 10 18 19M7 4L20 17"],
  [
    "Haste",
    "Can attack and use tap or untap abilities without waiting a turn.",
    "M14 2L4 14H11L9 22L21 9H13Z",
  ],
  [
    "First strike",
    "Deals combat damage in the first combat damage step.",
    "M4 20L18 3L21 3L20 6L7 19M3 15L9 21M3 21L6 18",
  ],
  [
    "Double strike",
    "Deals combat damage in both the first and regular damage steps.",
    "M2 18L14 3L17 3L16 6L5 20M9 19L20 6L23 6L22 9L12 22M1 15L7 21M8 16L14 22",
  ],
  [
    "Deathtouch",
    "Any positive damage this deals to a creature is lethal damage.",
    "M6 16C-1 3 25 3 18 16L16 17V21H8V17ZM8 10L10 12M16 10L14 12M11 16H13M11 18V21M14 18V21",
  ],
  [
    "Lifelink",
    "Its controller gains life equal to the damage it deals.",
    "M12 21L3 12C-3 3 9 0 12 7C15 0 27 3 21 12ZM9 11H15M12 8V14",
  ],
  [
    "Trample",
    "After assigning lethal damage to blockers, excess can hit the attack target.",
    "M2 16H16L12 12M16 16L12 20M3 11L7 5L11 9L15 3L21 8L20 18M20 11L23 10",
  ],
  [
    "Hexproof",
    "Cannot be targeted by spells or abilities your opponents control.",
    "M12 2L21 6V13Q20 20 12 23Q4 20 3 13V6ZM7 12L10 15L17 8",
  ],
  [
    "Ward",
    "When an opponent targets this, counter that spell or ability unless they pay its ward cost.",
    "M12 2L21 6V13Q20 20 12 23Q4 20 3 13V6ZM8 11H16V17H8ZM10 11V8Q12 4 14 8V11",
  ],
  [
    "Indestructible",
    "Cannot be destroyed by lethal damage or destroy effects. Exile and other ways of leaving still work.",
    "M12 2L22 9L12 22L2 9ZM2 9H22M7 5L12 22L17 5",
  ],
  [
    "Menace",
    "Cannot be blocked except by two or more creatures.",
    "M3 4L10 7V18L3 15ZM14 7L21 4V15L14 18ZM5 9L8 10M16 10L19 9",
  ],
  ["Defender", "Cannot attack.", "M3 21V7H7V3H11V7H15V3H19V7H21V21ZM9 21V14H15V21"],
  [
    "Flash",
    "Can be cast whenever you could cast an instant.",
    "M12 2L14 8L22 10L15 13L13 22L10 15L2 13L9 10Z",
  ],
] as const;

export function keywordDetails(raw: string) {
  const normalized = raw.toLowerCase().replace(/[_-]/g, " ");
  const entry = entries.find(
    ([name]) =>
      normalized === name.toLowerCase() ||
      normalized.startsWith(`${name.toLowerCase()}:`) ||
      normalized.startsWith(`${name.toLowerCase()} `),
  );
  return entry
    ? { name: entry[0], description: entry[1], path: entry[2], label: raw.replace(/:/g, " ") }
    : undefined;
}

export function counterLabel(raw: string) {
  return (
    ({ P1P1: "+1/+1", M1M1: "−1/−1" } as Record<string, string>)[raw] ??
    raw.replace(/_/g, " ").toLowerCase()
  );
}
