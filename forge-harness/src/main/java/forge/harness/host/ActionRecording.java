package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.game.Game;
import forge.game.card.Card;
import forge.harness.common.ParityCardMap;
import forge.harness.common.SnapshotExtractor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

final class ActionRecording {

    private static final class Step {
        private final String promptType;
        private final JsonObject source;
        private final String sourceAbilityText;
        private final JsonObject answer;

        private Step(final String promptType, final JsonObject source, final String sourceAbilityText,
                final JsonObject answer) {
            this.promptType = promptType;
            this.source = source;
            this.sourceAbilityText = sourceAbilityText;
            this.answer = answer;
        }
    }

    private final Game game;
    private final List<Step> steps = new ArrayList<>();
    private final List<String> actions = new ArrayList<>();
    private Set<Integer> iterationStart = Set.of();
    private final Map<String, String> substitutes = new HashMap<>();
    private Map<String, Card> cards = Map.of();
    private List<Integer> created = List.of();

    static void log(final String message) {
        System.err.println("[repeat] " + message);
    }

    private static String brief(final JsonElement element) {
        final String text = String.valueOf(element);
        return text.length() > 400 ? text.substring(0, 400) + "..." : text;
    }

    ActionRecording(final Game game) {
        this.game = game;
        beginIteration();
    }

    void beginIteration() {
        final Set<Integer> ids = new HashSet<>();
        for (final Card card : game.getCardsInGame()) {
            ids.add(card.getId());
        }
        iterationStart = ids;
        substitutes.clear();
    }

    int size() {
        return steps.size();
    }

    List<String> actions() {
        return List.copyOf(actions);
    }

    boolean record(final JsonObject prompt, final JsonObject response) {
        index();
        final JsonObject input = prompt.getAsJsonObject("input");
        final String type = input.get("type").getAsString();
        final JsonObject answer = encode(type, input, response.getAsJsonObject("output"));
        if (answer == null) {
            log("cannot record " + type + " answer " + brief(response.get("output")));
            return false;
        }
        steps.add(new Step(type, source(prompt), text(prompt, "sourceAbilityText"), answer));
        log("recorded step " + (steps.size() - 1) + ": " + type + " source=" + brief(source(prompt))
                + " answer=" + brief(answer));
        if (answer.has("action") && "chooseAction".equals(type)) {
            final JsonObject action = answer.getAsJsonObject("action");
            actions.add("undoMana".equals(text(action, "type"))
                    ? "Untap " + text(action.getAsJsonObject("cardId"), "name")
                    : text(action, action.has("label") ? "label" : "description"));
        }
        return true;
    }

    JsonObject resolve(final int step, final JsonObject prompt) {
        index();
        final Step recorded = steps.get(step);
        final JsonObject input = prompt.getAsJsonObject("input");
        final String type = input.get("type").getAsString();
        if (!recorded.promptType.equals(type)) {
            log("step " + step + " mismatch: recorded " + recorded.promptType + ", prompt is " + type);
            return null;
        }
        if (!sourceMatches(recorded.source, prompt)) {
            log("step " + step + " mismatch: recorded source " + brief(recorded.source)
                    + ", prompt source " + brief(source(prompt)));
            return null;
        }
        if (!Objects.equals(recorded.sourceAbilityText, text(prompt, "sourceAbilityText"))) {
            log("step " + step + " mismatch: recorded ability text \"" + recorded.sourceAbilityText
                    + "\", prompt has \"" + text(prompt, "sourceAbilityText") + "\"");
            return null;
        }
        final JsonObject output = decode(type, input, recorded.answer);
        if (output == null) {
            log("step " + step + " mismatch: no " + type + " option matches " + brief(recorded.answer)
                    + " in " + brief(input));
            return null;
        }
        final JsonObject response = new JsonObject();
        response.addProperty("type", type);
        response.add("output", output);
        return response;
    }

    private JsonObject encode(final String type, final JsonObject input, final JsonObject output) {
        final String kind = text(output, "type");
        final JsonObject answer = output.deepCopy();
        switch (type) {
            case "chooseAction":
                return "act".equals(kind) ? encodeAction(input, output, true) : answer;
            case "payManaCost":
                return "act".equals(kind) ? encodeAction(input, output, false) : answer;
            case "chooseBoardTargets": {
                if (!output.has("chosen")) {
                    return answer;
                }
                final JsonArray chosen = new JsonArray();
                for (final JsonElement element : output.getAsJsonArray("chosen")) {
                    final JsonObject target = element.getAsJsonObject();
                    final JsonObject recorded = new JsonObject();
                    recorded.addProperty("kind", text(target, "kind"));
                    recorded.add("ref", ref(text(target, "id")));
                    chosen.add(recorded);
                }
                answer.add("chosen", chosen);
                return answer;
            }
            case "chooseCards": {
                final JsonArray refs = new JsonArray();
                for (final JsonElement id : output.getAsJsonArray("chosenCardIds")) {
                    refs.add(ref(id.getAsString()));
                }
                answer.add("chosenCardIds", refs);
                return answer;
            }
            case "reorder": {
                final JsonArray items = new JsonArray();
                for (final JsonElement id : output.getAsJsonArray("orderedIds")) {
                    final JsonObject item = item(input, id.getAsString());
                    if (item == null) {
                        return null;
                    }
                    items.add(describeItem(item));
                }
                answer.add("orderedIds", items);
                return answer;
            }
            case "chooseFromSelection": {
                final JsonArray options = input.getAsJsonArray("options");
                final JsonArray labels = new JsonArray();
                for (final JsonElement index : output.getAsJsonArray("chosenIndices")) {
                    labels.add(text(options.get(index.getAsInt()).getAsJsonObject(), "label"));
                }
                answer.add("chosenIndices", labels);
                return answer;
            }
            case "chooseBoolean":
            case "chooseNumber":
            case "chooseColor":
            case "revealCards":
                return answer;
            default:
                return null;
        }
    }

    private JsonObject decode(final String type, final JsonObject input, final JsonObject answer) {
        final String kind = text(answer, "type");
        final JsonObject output = answer.deepCopy();
        switch (type) {
            case "chooseAction":
                return "act".equals(kind) ? decodeAction(input, answer, true) : output;
            case "payManaCost":
                return "act".equals(kind) ? decodeAction(input, answer, false) : output;
            case "chooseBoardTargets": {
                if (!answer.has("chosen")) {
                    return input.get("cancellable").getAsBoolean() ? output : null;
                }
                final List<JsonObject> candidates = new ArrayList<>();
                for (final JsonElement element : input.getAsJsonArray("candidates")) {
                    candidates.add(element.getAsJsonObject());
                }
                final JsonArray chosen = new JsonArray();
                for (final JsonElement element : answer.getAsJsonArray("chosen")) {
                    final JsonObject recorded = element.getAsJsonObject();
                    final List<String> ids = new ArrayList<>();
                    for (final JsonObject candidate : candidates) {
                        if (text(candidate, "kind").equals(text(recorded, "kind"))) {
                            ids.add(text(candidate, "id"));
                        }
                    }
                    final String id = match(recorded.getAsJsonObject("ref"), ids);
                    if (id == null) {
                        return null;
                    }
                    final JsonObject target = candidates.stream()
                            .filter(candidate -> id.equals(text(candidate, "id")))
                            .findFirst().orElseThrow();
                    candidates.remove(target);
                    chosen.add(target);
                }
                output.add("chosen", chosen);
                return output;
            }
            case "chooseCards": {
                final List<String> ids = new ArrayList<>();
                for (final JsonElement card : input.getAsJsonArray("cards")) {
                    ids.add(text(card.getAsJsonObject(), "id"));
                }
                final JsonArray chosen = new JsonArray();
                for (final JsonElement ref : answer.getAsJsonArray("chosenCardIds")) {
                    final String id = match(ref.getAsJsonObject(), ids);
                    if (id == null) {
                        return null;
                    }
                    ids.remove(id);
                    chosen.add(id);
                }
                output.add("chosenCardIds", chosen);
                return output;
            }
            case "reorder": {
                final List<JsonObject> items = new ArrayList<>();
                for (final JsonElement element : input.getAsJsonArray("items")) {
                    items.add(element.getAsJsonObject());
                }
                final JsonArray ordered = new JsonArray();
                for (final JsonElement recorded : answer.getAsJsonArray("orderedIds")) {
                    final JsonObject item = items.stream()
                            .filter(candidate -> describeItem(candidate).equals(recorded))
                            .findFirst().orElse(null);
                    if (item == null) {
                        return null;
                    }
                    items.remove(item);
                    ordered.add(text(item, "id"));
                }
                output.add("orderedIds", ordered);
                return output;
            }
            case "chooseFromSelection": {
                final JsonArray options = input.getAsJsonArray("options");
                final JsonArray indices = new JsonArray();
                for (final JsonElement label : answer.getAsJsonArray("chosenIndices")) {
                    int found = -1;
                    for (int i = 0; i < options.size() && found < 0; i++) {
                        if (label.getAsString().equals(text(options.get(i).getAsJsonObject(), "label"))) {
                            found = i;
                        }
                    }
                    if (found < 0) {
                        return null;
                    }
                    indices.add(found);
                }
                output.add("chosenIndices", indices);
                return output;
            }
            case "chooseNumber": {
                if (!answer.has("chosenNumber") || answer.get("chosenNumber").isJsonNull()) {
                    return output;
                }
                final int number = answer.get("chosenNumber").getAsInt();
                return number >= input.get("min").getAsInt() && number <= input.get("max").getAsInt()
                        ? output : null;
            }
            case "chooseColor": {
                final Set<String> valid = new HashSet<>();
                for (final JsonElement color : input.getAsJsonArray("validColors")) {
                    valid.add(color.getAsString());
                }
                return valid.containsAll(answer.getAsJsonObject("chosenColors").keySet()) ? output : null;
            }
            default:
                return output;
        }
    }

    private JsonObject encodeAction(final JsonObject input, final JsonObject output, final boolean positional) {
        final String actionId = text(output, "actionId");
        for (final JsonElement element : input.getAsJsonArray("actions")) {
            final JsonObject action = element.getAsJsonObject();
            if (actionId.equals(text(action, "id"))) {
                final JsonObject answer = new JsonObject();
                answer.addProperty("type", "act");
                answer.add("action", describeAction(action, positional));
                return answer;
            }
        }
        return null;
    }

    private JsonObject decodeAction(final JsonObject input, final JsonObject answer, final boolean positional) {
        final JsonObject recorded = answer.getAsJsonObject("action");
        final List<JsonObject> actions = new ArrayList<>();
        for (final JsonElement element : input.getAsJsonArray("actions")) {
            actions.add(element.getAsJsonObject());
        }
        JsonObject found = null;
        if (recorded.has("cardId")) {
            final JsonObject withoutCard = recorded.deepCopy();
            withoutCard.remove("cardId");
            final Map<String, JsonObject> byCard = new java.util.LinkedHashMap<>();
            for (final JsonObject action : actions) {
                final JsonObject described = describeAction(action, positional);
                described.remove("cardId");
                if (described.equals(withoutCard) && action.has("cardId")) {
                    byCard.putIfAbsent(text(action, "cardId"), action);
                }
            }
            final String cardId = match(recorded.getAsJsonObject("cardId"), new ArrayList<>(byCard.keySet()));
            found = cardId == null ? null : byCard.get(cardId);
        } else {
            for (final JsonObject action : actions) {
                if (describeAction(action, positional).equals(recorded)) {
                    found = action;
                    break;
                }
            }
        }
        if (found == null) {
            return null;
        }
        final JsonObject output = new JsonObject();
        output.addProperty("type", "act");
        output.addProperty("actionId", text(found, "id"));
        return output;
    }

    private JsonObject describeAction(final JsonObject action, final boolean positional) {
        final JsonObject described = action.deepCopy();
        described.remove("id");
        if (positional) {
            described.remove("abilityIndex");
        }
        if (described.has("cardId")) {
            described.add("cardId", ref(text(described, "cardId")));
        }
        return described;
    }

    private JsonObject describeItem(final JsonObject item) {
        final JsonObject described = new JsonObject();
        described.add("card", ref(text(item.getAsJsonObject("card"), "id")));
        described.addProperty("oracle", text(item, "oracle"));
        return described;
    }

    private static JsonObject item(final JsonObject input, final String id) {
        for (final JsonElement element : input.getAsJsonArray("items")) {
            if (id.equals(text(element.getAsJsonObject(), "id"))) {
                return element.getAsJsonObject();
            }
        }
        return null;
    }

    private boolean sourceMatches(final JsonObject recorded, final JsonObject prompt) {
        if (!prompt.has("sourceCard")) {
            return recorded == null;
        }
        final String live = text(prompt.getAsJsonObject("sourceCard"), "id");
        return recorded != null && live.equals(match(recorded, List.of(live)));
    }

    private JsonObject source(final JsonObject prompt) {
        return prompt.has("sourceCard") ? ref(text(prompt.getAsJsonObject("sourceCard"), "id")) : null;
    }

    private String match(final JsonObject recorded, final List<String> candidates) {
        if (!recorded.has("id")) {
            for (final String candidate : candidates) {
                if (ref(candidate).equals(recorded)) {
                    return candidate;
                }
            }
            return null;
        }
        final String id = text(recorded, "id");
        final String mapped = substitutes.get(id);
        if (mapped != null && candidates.contains(mapped)) {
            return mapped;
        }
        final Set<String> taken = new HashSet<>(substitutes.values());
        for (final String candidate : candidates) {
            if (ref(candidate).equals(recorded) && !taken.contains(candidate)) {
                substitutes.put(id, candidate);
                return candidate;
            }
        }
        if (!recorded.has("name")) {
            return null;
        }
        for (final String candidate : candidates) {
            final Card card = cards.get(candidate);
            if (card != null && !taken.contains(candidate) && card.getName().equals(text(recorded, "name"))) {
                log("using " + candidate + " for recorded " + id + " (" + card.getName() + ")");
                substitutes.put(id, candidate);
                return candidate;
            }
        }
        return null;
    }

    private JsonObject ref(final String id) {
        final JsonObject ref = new JsonObject();
        final Card card = cards.get(id);
        final int rank = card == null ? -1 : created.indexOf(card.getId());
        if (rank >= 0) {
            ref.addProperty("created", rank);
        } else {
            ref.addProperty("id", id);
        }
        if (card != null) {
            ref.addProperty("name", card.getName());
        }
        return ref;
    }

    private void index() {
        final Map<String, Card> byId = new HashMap<>();
        final List<Integer> made = new ArrayList<>();
        ParityCardMap.beginSnapshot(game);
        try {
            for (final Card card : game.getCardsInGame()) {
                byId.put(SnapshotExtractor.javaCardId(card), card);
                if (!iterationStart.contains(card.getId())) {
                    made.add(card.getId());
                }
            }
        } finally {
            ParityCardMap.endSnapshot();
        }
        made.sort(Integer::compare);
        cards = byId;
        created = made;
    }

    private static String text(final JsonObject object, final String field) {
        return object.has(field) && !object.get(field).isJsonNull() ? object.get(field).getAsString() : null;
    }
}
