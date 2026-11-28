export function readClockwiseSeats(board: HTMLElement | null, seats: readonly string[]): string[] {
  const positions = Array.from(
    board?.querySelectorAll<HTMLElement>("[data-companion-seat-id]") ?? [],
    (element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return { id: element.dataset.companionSeatId!, x: left + width / 2, y: top + height / 2 };
    },
  );
  if (positions.length < 2) return [...seats];

  const xs = positions.map(({ x }) => x);
  const ys = positions.map(({ y }) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (height < 1) {
    positions.sort((a, b) => a.x - b.x);
  } else if (width < 1) {
    positions.sort((a, b) => a.y - b.y);
  } else {
    const cx = xs.reduce((sum, x) => sum + x, 0) / positions.length;
    const cy = ys.reduce((sum, y) => sum + y, 0) / positions.length;
    const angle = ({ x, y }: { x: number; y: number }) => Math.atan2(y - cy, x - cx);
    positions.sort((a, b) => angle(a) - angle(b));
  }
  const clockwise = positions.map(({ id }) => id);
  return [...clockwise, ...seats.filter((id) => !clockwise.includes(id))];
}

export function turnOrderFrom<T>(seats: readonly T[], first: T, counterclockwise = false): T[] {
  const direction = counterclockwise ? [...seats].reverse() : seats;
  const index = direction.indexOf(first);
  return [...direction.slice(index), ...direction.slice(0, index)];
}

export function gridSeatOrder(
  seats: readonly string[],
  clockwise: readonly string[],
  turns: readonly string[],
  counterclockwise: boolean,
): string[] {
  const targets = turnOrderFrom(
    clockwise.filter((id) => turns.includes(id)),
    turns[0]!,
    counterclockwise,
  );
  const assigned = new Map(targets.map((id, index) => [id, turns[index]!]));
  return seats.map((id) => assigned.get(id) ?? id);
}
