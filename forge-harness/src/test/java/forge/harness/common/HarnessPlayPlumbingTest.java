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
        final WrappedAbility wrapper = new WrappedAbility(trigger, template, null);

        HarnessPlayPlumbing.detachTriggerTemplate(wrapper);

        if (wrapper.getWrappedAbility() != template) {
            throw new AssertionError("live wrapped ability changed");
        }
        if (trigger.getOverridingAbility() == template) {
            throw new AssertionError("trigger template was not detached");
        }
        if (trigger.getOverridingAbility().getTargets() == template.getTargets()) {
            throw new AssertionError("trigger template shares target choices");
        }
    }
}
