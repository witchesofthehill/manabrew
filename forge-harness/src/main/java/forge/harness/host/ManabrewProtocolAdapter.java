package forge.harness.host;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.Map;

/** manabrew-protocol wire marshaling: the AgentPrompt envelope, shared prompt presentation, and PromptOutput-to-internal action decoding. */
final class ManabrewProtocolAdapter {
    private ManabrewProtocolAdapter() {}

    static String agentPrompt(
            final long promptId,
            final String decidingPlayerId,
            final String sourceCardId,
            final JsonObject input
    ) {
        final JsonObject prompt = new JsonObject();
        prompt.addProperty("promptId", promptId);
        if (decidingPlayerId != null && !decidingPlayerId.isEmpty()) {
            prompt.addProperty("decidingPlayerId", decidingPlayerId);
        }
        if (sourceCardId != null) {
            prompt.addProperty("sourceCardId", sourceCardId);
        }
        prompt.add("input", input);
        return prompt.toString();
    }

    static JsonObject decodeAction(final JsonObject canonical) {
        if (!canonical.has("type")) {
            // Already a flat action (close()/internal auto-pass); pass through.
            return canonical;
        }
        final String type = canonical.get("type").getAsString();
        final JsonObject output = canonical.has("output") && canonical.get("output").isJsonObject()
                ? canonical.getAsJsonObject("output")
                : new JsonObject();
        final JsonObject flat = new JsonObject();
        switch (type) {
            case "mulligan":
                flat.addProperty("kind", "mulligan_decision");
                flat.addProperty("keep", output.has("keep") && output.get("keep").getAsBoolean());
                return flat;
            case "mulliganPutBack":
                flat.addProperty("kind", "choose_cards");
                flat.add("card_ids", copyStringArray(output, "cardIds"));
                return flat;
            case "chooseCards":
                flat.addProperty("kind", "choose_cards");
                flat.add("card_ids", copyStringArray(output, "chosenCardIds"));
                return flat;
            case "chooseAction":
                return translateChooseAction(output);
            case "payManaCost":
                return translateManaSource(output);
            case "chooseAttackers": {
                flat.addProperty("kind", "declare_attackers");
                final com.google.gson.JsonArray assignments = new com.google.gson.JsonArray();
                for (final JsonElement element : arrayOrEmpty(output, "assignments")) {
                    final JsonObject in = element.getAsJsonObject();
                    final JsonObject out = new JsonObject();
                    out.addProperty("attackerId", asString(in, "attackerId"));
                    out.addProperty("defenderId", asString(in, "targetId"));
                    assignments.add(out);
                }
                flat.add("assignments", assignments);
                return flat;
            }
            case "chooseBlockers": {
                flat.addProperty("kind", "declare_blockers");
                final com.google.gson.JsonArray assignments = new com.google.gson.JsonArray();
                for (final JsonElement element : arrayOrEmpty(output, "assignments")) {
                    final JsonObject in = element.getAsJsonObject();
                    final JsonObject out = new JsonObject();
                    out.addProperty("blockerId", asString(in, "blockerId"));
                    out.addProperty("attackerId", asString(in, "attackerId"));
                    assignments.add(out);
                }
                flat.add("assignments", assignments);
                return flat;
            }
            case "chooseBoardTargets": {
                flat.addProperty("kind", "target_choice");
                final JsonObject target = new JsonObject();
                final com.google.gson.JsonArray chosen = arrayOrEmpty(output, "chosen");
                if (chosen.size() > 0 && chosen.get(0).isJsonObject()) {
                    final JsonObject first = chosen.get(0).getAsJsonObject();
                    target.addProperty("kind", asString(first, "kind"));
                    target.addProperty("id", asString(first, "id"));
                } else {
                    target.addProperty("kind", "card");
                    target.addProperty("id", "");
                }
                flat.add("target", target);
                return flat;
            }
            case "chooseBoolean":
                flat.addProperty("kind", "boolean_decision");
                flat.addProperty("accept", output.has("value") && output.get("value").getAsBoolean());
                return flat;
            case "chooseFromSelection": {
                flat.addProperty("kind", "mode_decision");
                final com.google.gson.JsonArray indices = new com.google.gson.JsonArray();
                for (final JsonElement element : arrayOrEmpty(output, "chosenIndices")) {
                    indices.add(element.getAsInt());
                }
                flat.add("indices", indices);
                return flat;
            }
            case "revealCards":
                flat.addProperty("kind", "reveal_cards_acknowledged");
                return flat;
            case "diceRolled":
                flat.addProperty("kind", "first_player_roll_acknowledged");
                return flat;
            case "scry": {
                flat.addProperty("kind", "scry_decision");
                final com.google.gson.JsonArray zones = new com.google.gson.JsonArray();
                for (final JsonElement element : arrayOrEmpty(output, "zoneCardIds")) {
                    final com.google.gson.JsonArray pile = new com.google.gson.JsonArray();
                    if (element.isJsonArray()) {
                        for (final JsonElement id : element.getAsJsonArray()) {
                            pile.add(id.getAsString());
                        }
                    }
                    zones.add(pile);
                }
                flat.add("zone_card_ids", zones);
                return flat;
            }
            case "chooseColor":
                return translateColorDecision(output);
            case "chooseType":
                flat.addProperty("kind", "string_decision");
                flat.addProperty("value", asString(output, "chosenType"));
                return flat;
            case "chooseCardName":
                flat.addProperty("kind", "string_decision");
                flat.addProperty("value", asString(output, "chosenName"));
                return flat;
            case "chooseNumber":
                flat.addProperty("kind", "number_decision");
                flat.addProperty("number", output.has("chosenNumber") && !output.get("chosenNumber").isJsonNull()
                        ? output.get("chosenNumber").getAsInt() : 0);
                return flat;
            case "chooseDamageAssignmentOrder":
                flat.addProperty("kind", "damage_assignment_order_decision");
                flat.add("ordered_card_ids", copyStringArray(output, "orderedBlockerIds"));
                return flat;
            case "reorderCards":
                flat.addProperty("kind", "reorder_library_decision");
                flat.add("ordered_card_ids", copyStringArray(output, "orderedCardIds"));
                return flat;
            case "chooseCombatDamageAssignment": {
                flat.addProperty("kind", "combat_damage_assignment_decision");
                final com.google.gson.JsonArray assignments = new com.google.gson.JsonArray();
                for (final JsonElement element : arrayOrEmpty(output, "assignments")) {
                    final JsonObject in = element.getAsJsonObject();
                    final JsonObject out = new JsonObject();
                    out.addProperty("assigneeId", asString(in, "assigneeId"));
                    out.addProperty("damage", in.has("damage") ? in.get("damage").getAsInt() : 0);
                    assignments.add(out);
                }
                flat.add("assignments", assignments);
                return flat;
            }
            case "divideAmount":
                flat.addProperty("kind", "divide_amount");
                flat.add("allocation", output.has("allocation") && output.get("allocation").isJsonObject()
                        ? output.getAsJsonObject("allocation") : new JsonObject());
                return flat;
            default:
                throw new UnsupportedOperationException("unsupported canonical action type: " + type);
        }
    }

    private static JsonObject translateChooseAction(final JsonObject output) {
        final String kind = output.has("type") ? output.get("type").getAsString() : "";
        final JsonObject flat = new JsonObject();
        switch (kind) {
            case "act":
                return parseActionId(asString(output, "actionId"));
            case "pass":
                flat.addProperty("kind", "pass");
                if (output.has("untilPhase") && !output.get("untilPhase").isJsonNull()) {
                    flat.addProperty("until", output.get("untilPhase").getAsString());
                }
                return flat;
            case "concede":
                flat.addProperty("kind", "pass");
                return flat;
            case "restoreSnapshot":
                throw new UnsupportedOperationException("unsupported canonical action type: restoreSnapshot");
            default:
                throw new UnsupportedOperationException("unsupported chooseAction output: " + kind);
        }
    }

    private static JsonObject translateManaSource(final JsonObject output) {
        final String kind = output.has("type") ? output.get("type").getAsString() : "";
        final JsonObject flat = new JsonObject();
        switch (kind) {
            case "act":
                return parseActionId(asString(output, "actionId"));
            case "pay":
                flat.addProperty("kind", "pay_mana");
                flat.addProperty("auto", output.has("auto") && output.get("auto").getAsBoolean());
                return flat;
            case "payLife":
                flat.addProperty("kind", "pay_life");
                return flat;
            case "cancel":
                flat.addProperty("kind", "cancel_mana");
                return flat;
            default:
                throw new UnsupportedOperationException("unsupported payManaCost output: " + kind);
        }
    }

    private static JsonObject translateColorDecision(final JsonObject output) {
        final JsonObject map = output.has("chosenColors") && output.get("chosenColors").isJsonObject()
                ? output.getAsJsonObject("chosenColors") : new JsonObject();
        int total = 0;
        for (final Map.Entry<String, JsonElement> entry : map.entrySet()) {
            total += entry.getValue().getAsInt();
        }
        final JsonObject flat = new JsonObject();
        if (total <= 1) {
            flat.addProperty("kind", "string_decision");
            final String value = map.entrySet().isEmpty() ? "" : map.entrySet().iterator().next().getKey();
            flat.addProperty("value", value);
            return flat;
        }
        flat.addProperty("kind", "mana_combo_decision");
        final com.google.gson.JsonArray chosen = new com.google.gson.JsonArray();
        for (final Map.Entry<String, JsonElement> entry : map.entrySet()) {
            for (int i = 0; i < entry.getValue().getAsInt(); i++) {
                chosen.add(entry.getKey());
            }
        }
        flat.add("chosenColors", chosen);
        return flat;
    }

    private static JsonObject parseActionId(final String actionId) {
        final JsonObject flat = new JsonObject();
        if (actionId.startsWith("prompt-action-")) {
            flat.addProperty("kind", "choose_action");
            flat.addProperty("index", Integer.parseInt(actionId.substring("prompt-action-".length())));
            return flat;
        }
        if (actionId.startsWith("untap:")) {
            flat.addProperty("kind", "untap_land");
            flat.addProperty("cardId", actionId.substring("untap:".length()));
            return flat;
        }
        if (actionId.startsWith("delve:")) {
            flat.addProperty("kind", "delve");
            flat.addProperty("cardId", actionId.substring("delve:".length()));
            return flat;
        }
        if (actionId.startsWith("undelve:")) {
            flat.addProperty("kind", "undelve");
            flat.addProperty("cardId", actionId.substring("undelve:".length()));
            return flat;
        }
        if (actionId.startsWith("tap:")) {
            return parseTapActionId(actionId.substring("tap:".length()));
        }
        throw new UnsupportedOperationException("unsupported action id: " + actionId);
    }

    private static JsonObject parseTapActionId(final String rest) {
        final JsonObject flat = new JsonObject();
        flat.addProperty("kind", "tap_land");
        final int lastColon = rest.lastIndexOf(':');
        if (lastColon >= 0) {
            final String maybeColor = rest.substring(lastColon + 1);
            if (isManaLetter(maybeColor)) {
                final String before = rest.substring(0, lastColon);
                final int idxColon = before.lastIndexOf(':');
                if (idxColon >= 0) {
                    final Integer index = parseIntOrNull(before.substring(idxColon + 1));
                    if (index != null) {
                        flat.addProperty("cardId", before.substring(0, idxColon));
                        flat.addProperty("manaAbilityIndex", index);
                        flat.addProperty("color", maybeColor);
                        return flat;
                    }
                }
            }
            final Integer index = parseIntOrNull(maybeColor);
            if (index != null) {
                flat.addProperty("cardId", rest.substring(0, lastColon));
                flat.addProperty("manaAbilityIndex", index);
                return flat;
            }
        }
        flat.addProperty("cardId", rest);
        return flat;
    }

    private static Integer parseIntOrNull(final String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static boolean isManaLetter(final String token) {
        return "W".equals(token) || "U".equals(token) || "B".equals(token)
                || "R".equals(token) || "G".equals(token) || "C".equals(token);
    }

    private static String asString(final JsonObject object, final String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : "";
    }

    private static com.google.gson.JsonArray arrayOrEmpty(final JsonObject object, final String key) {
        return object.has(key) && object.get(key).isJsonArray()
                ? object.getAsJsonArray(key) : new com.google.gson.JsonArray();
    }

    private static com.google.gson.JsonArray copyStringArray(final JsonObject object, final String key) {
        final com.google.gson.JsonArray out = new com.google.gson.JsonArray();
        for (final JsonElement element : arrayOrEmpty(object, key)) {
            out.add(element.getAsString());
        }
        return out;
    }
}
