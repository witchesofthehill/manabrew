/**
 * Which card names a deck needs out of the cardset archive.
 *
 * The selector returns only the scripts asked for, because Forge reads its
 * whole cardsfolder at init and all 33k scripts cost seconds of boot for cards
 * no game will touch. Getting a name wrong fails silently: Forge substitutes a
 * placeholder saying the card is unsupported and the game plays on around it.
 */

/**
 * Every card that can enter the game, not just the main deck. Not the
 * maybeboard, which never enters one, and not tokens: the selector ships every
 * token script whatever the filter says.
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

/** Undefined decks are skipped, so a partly-filled seat list is fine. */
export function deckCardNames(decks) {
  const names = new Set();
  for (const deck of decks) {
    if (!deck) continue;
    for (const card of playableCards(deck)) {
      const name = card?.identity?.name ?? card?.name;
      if (!name) continue;
      names.add(name);
      // The archive may key a double-faced card either way, so ask for both.
      const cut = name.indexOf(" // ");
      if (cut >= 0) names.add(name.slice(0, cut));
    }
  }
  return [...names];
}
