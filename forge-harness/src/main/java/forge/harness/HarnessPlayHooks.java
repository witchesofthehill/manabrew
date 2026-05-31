package forge.harness;

import forge.game.card.Card;

/**
 * Controller-specific hooks {@link HarnessPlayPlumbing} needs while casting.
 * The deterministic bot and the interactive controller answer these differently
 * (RNG / parity bookkeeping vs. live prompts), so the shared plumbing routes
 * them out instead of depending on a concrete controller.
 */
interface HarnessPlayHooks {
    void markFailedPaymentCard(Card card);

    boolean confirmPlayEffectOptional();
}
