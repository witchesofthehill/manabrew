package forge.harness.common;

import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.spellability.SpellAbility;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerHandler;
import forge.game.trigger.WrappedAbility;
import forge.util.Lang;
import forge.util.Localizer;

public final class HarnessPlayPlumbingTest {
    private HarnessPlayPlumbingTest() {}

    public static void main(final String[] args) {
        Lang.createInstance("en-US");
        Localizer.getInstance().initialize("en-US", "forge/forge-gui/res/languages");
        final Card host = new Card(1, null);
        final Trigger trigger = TriggerHandler.parseTrigger("Mode$ Always", host, true);
        final SpellAbility template = AbilityFactory.getAbility("DB$ Destroy | ValidTgts$ Artifact", host);
        trigger.setOverridingAbility(template);
        final WrappedAbility firstFiring = new WrappedAbility(trigger, template, null);

        HarnessPlayPlumbing.detachTriggerTemplate(firstFiring);

        if (firstFiring.getWrappedAbility() != template) {
            throw new AssertionError("live wrapped ability changed");
        }
        final Card firstTarget = new Card(2, null);
        firstFiring.getTargets().add(firstTarget);

        final SpellAbility secondAbility = trigger.getOverridingAbility().copy(host, null, false, true);
        final WrappedAbility secondFiring = new WrappedAbility(trigger, secondAbility, null);
        if (!secondFiring.getTargets().isEmpty()) {
            throw new AssertionError("second firing inherited the first firing's target");
        }

        final Card secondTarget = new Card(3, null);
        secondFiring.getTargets().add(secondTarget);
        if (firstFiring.getTargets().getFirstTargetedCard() != firstTarget) {
            throw new AssertionError("first firing target changed");
        }
        if (secondFiring.getTargets().getFirstTargetedCard() != secondTarget) {
            throw new AssertionError("second firing target was not independent");
        }
    }
}
