export const manaCells: Record<string, [number, number]> = {};
for (let n = 0; n < 20; n++) manaCells[String(n)] = [n % 10, Math.floor(n / 10)];
["20", "X", "Y", "Z", "W", "U", "B", "R", "G", "S"].forEach((s, i) => {
  manaCells[s] = [i, 2];
});
["W/U", "W/B", "U/B", "U/R", "B/R", "B/G", "R/W", "R/G", "G/W", "G/U"].forEach((s, i) => {
  manaCells[s] = [i, 3];
  manaCells[s.split("/").reverse().join("/")] = [i, 3];
});
["2/W", "2/U", "2/B", "2/R", "2/G", "W/P", "U/P", "B/P", "R/P", "G/P"].forEach((s, i) => {
  manaCells[s] = [i, 4];
});
["T", "Q", "INF", "HALF", "TAP", "UNTAP", "C"].forEach((s, i) => {
  manaCells[s] = [i, 5];
});
