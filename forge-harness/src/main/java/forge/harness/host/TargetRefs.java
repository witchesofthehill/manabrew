package forge.harness.host;

import com.google.gson.Gson;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.harness.protocol.TargetKind;
import forge.harness.protocol.TargetRef;
import forge.harness.protocol.TargetingIntent;

import java.util.LinkedHashMap;
import java.util.Map;

final class TargetRefs {
    private static final Gson GSON = new Gson();

    private TargetRefs() {}

    static TargetRef ref(final String kind, final String id, final String intent) {
        return ref(kind, id, intent, null, null);
    }

    static TargetRef ref(
            final String kind,
            final String id,
            final String intent,
            final Integer nodeIndex,
            final Integer targetIndex
    ) {
        return new TargetRef(
                enumFromWire(kind, TargetKind.class),
                id,
                enumFromWire(intent, TargetingIntent.class),
                nodeIndex,
                targetIndex);
    }

    static Map<String, Object> map(
            final String kind,
            final String id,
            final String intent,
            final int nodeIndex,
            final int targetIndex
    ) {
        final Map<String, Object> target = new LinkedHashMap<>();
        target.put("kind", kind);
        target.put("id", id);
        target.put("intent", intent);
        target.put("nodeIndex", nodeIndex);
        target.put("targetIndex", targetIndex);
        return target;
    }

    static String intent(final SpellAbility ability, final GameObject object) {
        if (ability == null || ability.getApi() == null) {
            return "hostile";
        }
        final String destination = ability.hasParam("Destination") ? ability.getParam("Destination") : null;
        final String counterType = ability.hasParam("CounterType") ? ability.getParam("CounterType") : null;
        final String origin = object instanceof Card card && card.getZone() != null
                ? card.getZone().getZoneType().name()
                : null;
        return intentFromApi(ability.getApi().name(), destination, counterType, origin);
    }

    static String intentFromApi(
            final String api,
            final String destination,
            final String counterType,
            final String origin
    ) {
        if (api == null) {
            return "hostile";
        }
        switch (api) {
            case "DealDamage": case "DamageAll": case "EachDamage": return "damage";
            case "Destroy": case "DestroyAll": return "destroy";
            case "Sacrifice": case "SacrificeAll": return "sacrifice";
            case "ChangeZone": case "ChangeZoneAll": {
                final boolean fromDead = ZoneType.Graveyard.name().equals(origin)
                        || ZoneType.Exile.name().equals(origin);
                if (fromDead && ("Hand".equals(destination)
                        || "Library".equals(destination) || "Battlefield".equals(destination))) {
                    return "friendly";
                }
                if ("Exile".equals(destination)) {
                    return "exile";
                }
                if ("Hand".equals(destination) || "Library".equals(destination)) {
                    return "bounce";
                }
                if ("Graveyard".equals(destination)) {
                    return "destroy";
                }
                if ("Battlefield".equals(destination)) {
                    return "friendly";
                }
                return "hostile";
            }
            case "Mill": return "mill";
            case "Discard": return "discard";
            case "Counter": return "counter";
            case "ControlSpell": return "gainControl";
            case "Tap": case "TapAll": case "TapOrUntap": case "TapOrUntapAll": return "tap";
            case "Untap": case "UntapAll": return "untap";
            case "CopyPermanent": case "CopySpellAbility": case "Clone": return "copy";
            case "Pump": case "PumpAll": case "Animate": case "AnimateAll":
            case "Protection": case "ProtectionAll": return "buff";
            case "PutCounter": case "PutCounterAll":
                return counterType != null && (counterType.startsWith("M1M1") || counterType.contains("-1/-1"))
                        ? "debuff" : "buff";
            case "RemoveCounter": case "RemoveCounterAll": case "Debuff": return "debuff";
            case "GainLife": return "heal";
            case "LoseLife": return "loseLife";
            case "Draw": return "draw";
            case "Reveal": case "RevealHand": case "LookAt": case "PeekAndReveal": return "reveal";
            case "GainControl": case "GainControlVariant":
            case "ExchangeControl": case "ExchangeControlVariant": return "gainControl";
            case "Fight": return "fight";
            case "Attach": case "Unattach": return "attach";
            default: return "hostile";
        }
    }

    static String label(final String intent) {
        switch (intent) {
            case "loseLife": return "LoseLife";
            case "gainControl": return "GainControl";
            default: return Character.toUpperCase(intent.charAt(0)) + intent.substring(1);
        }
    }

    private static <T> T enumFromWire(final String wire, final Class<T> type) {
        return wire == null ? null : GSON.fromJson("\"" + wire + "\"", type);
    }
}
