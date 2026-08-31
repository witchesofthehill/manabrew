/**
 * Which card names a deck needs out of the cardset archive.
 *
 * The archive selector takes names and returns only those scripts, because
 * Forge reads its whole cardsfolder at init and all 33k scripts cost seconds
 * of boot for cards no game will touch. Getting a name wrong here fails
 * silently: Forge substitutes a placeholder saying the card is unsupported and
 * the game plays on around it, so both rules below are load-bearing.
 *
 * This is the one implementation. Manabrew's own client imports it rather than
 * keeping a second copy that can drift from the published package.
 */

/**
 * Every card that can enter the game, not just the main deck. A commander left
 * out of the bundle reaches the command zone as an unsupported placeholder,
 * and the same goes for the rest of these zones.
 *
 * Not the maybeboard: it never enters a game. Not tokens either — the selector
 * ships every token script whatever the filter says, because Forge resolves
 * `TokenScript$` references by name at runtime.
 */
function playableCards(deck) {
  return [
    ...(deck.cards ?? []),
    ...(deck.commanders ?? []),
    ...(deck.sideboard ?? []),
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.companion ? [deck.companion] : []),
  ];
}

/**
 * The card names in these decks, deduplicated, ready for the archive selector.
 * Undefined decks are skipped so a caller can pass a partly-filled seat list.
 */
export function deckCardNames(decks) {
  const names = new Set();
  for (const deck of decks) {
    if (!deck) continue;
    for (const card of playableCards(deck)) {
      const name = card?.identity?.name ?? card?.name;
      if (!name) continue;
      names.add(name);
      // The archive may key a double-faced card under either the joined name
      // or the front face alone, so ask for both and let the selector match
      // whichever it holds.
      const cut = name.indexOf(" // ");
      if (cut >= 0) names.add(name.slice(0, cut));
    }
  }
  return [...names];
}
