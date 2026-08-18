function combinationRatio(successes: number, population: number, draws: number): number {
  if (draws <= 0) return 1;
  if (successes < draws || population < draws) return 0;
  let ratio = 1;
  for (let index = 0; index < draws; index += 1) {
    ratio *= (successes - index) / (population - index);
  }
  return ratio;
}

export function probabilityAtLeastOne(
  population: number,
  successes: number,
  draws: number,
): number {
  if (population <= 0 || successes <= 0 || draws <= 0) return 0;
  if (draws >= population) return 1;
  return 1 - combinationRatio(population - successes, population, draws);
}

export function probabilityAtLeast(
  population: number,
  successes: number,
  draws: number,
  minimum: number,
): number {
  if (minimum <= 1) return probabilityAtLeastOne(population, successes, draws);
  if (successes < minimum || draws < minimum) return 0;
  let probability = 0;
  const maximum = Math.min(successes, draws);
  for (let hits = minimum; hits <= maximum; hits += 1) {
    let term = 1;
    for (let index = 0; index < hits; index += 1) {
      term *= (successes - index) / (index + 1);
    }
    for (let index = 0; index < draws - hits; index += 1) {
      term *= (population - successes - index) / (index + 1);
    }
    let denominator = 1;
    for (let index = 0; index < draws; index += 1) {
      denominator *= (population - index) / (index + 1);
    }
    probability += term / denominator;
  }
  return Math.min(1, probability);
}
