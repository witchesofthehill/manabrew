package forge.harness.host;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import forge.harness.protocol.CardCosmetics;

import java.util.HashSet;
import java.util.Set;

final class CardCosmeticsCodec {
    private static final Gson GSON = new Gson();
    private static final Set<String> PRESETS = Set.of("match", "lea", "leb", "2ed", "3ed", "4ed", "leg", "mir",
            "7ed", "8ed", "plc", "plc-colorshifted", "fut-regular", "fut", "m15", "m21");

    static CardCosmetics parse(final JsonElement value) {
        if (value == null || value.isJsonNull()) {
            return null;
        }
        final JsonObject object = object(value, Set.of("finish", "frame", "border", "wear", "wearAmount", "wearSeed",
                "rainFog", "wording", "printing"));
        enumeration(object, "finish", Set.of("regular", "gloss", "etched", "prismatic", "holofoil", "cold", "opal", "rain", "heat", "pool"));
        enumeration(object, "frame", Set.of("printing", "modern", "retro"));
        enumeration(object, "border", Set.of("printing", "black", "white", "silver"));
        enumeration(object, "wear", Set.of("fresh", "light", "played", "heavy"));
        enumeration(object, "wording", Set.of("original", "oracle"));
        numeric(object, "wearSeed", 0, 0xffffffffL, true);
        numeric(object, "wearAmount", 0, 1, false);
        numeric(object, "rainFog", 0, 2, false);
        if (object.has("printing")) {
            final JsonObject printing = printing(object.get("printing"));
            if (printing == null) {
                object.remove("printing");
            } else {
                object.add("printing", printing);
                if (!printing.get("preset").getAsString().equals("match")) {
                    object.remove("frame");
                }
            }
        }
        removeDefault(object, "frame", "printing");
        removeDefault(object, "border", "printing");
        removeDefault(object, "wear", "fresh");
        if (object.has("wearAmount")) {
            object.remove("wear");
            removeNumberDefault(object, "wearAmount", 0);
        }
        removeDefault(object, "wording", "oracle");
        removeNumberDefault(object, "rainFog", 1);
        removeNumberDefault(object, "wearSeed", 0);
        if (!object.has("wear") && !object.has("wearAmount")) {
            object.remove("wearSeed");
        }
        return object.isEmpty() ? null : GSON.fromJson(object, CardCosmetics.class);
    }

    private static JsonObject printing(final JsonElement value) {
        final JsonObject object = object(value, Set.of("version", "preset", "overrides", "art", "faces"));
        if (!object.has("version") || !object.has("preset")) {
            throw new IllegalArgumentException("printing version and preset are required");
        }
        numeric(object, "version", 1, 1, true);
        enumeration(object, "preset", PRESETS);
        layer(object, false);
        if (object.has("faces")) {
            if (!object.get("faces").isJsonArray() || object.getAsJsonArray("faces").size() > 2) {
                throw new IllegalArgumentException("printing supports at most two faces");
            }
            final JsonArray faces = object.getAsJsonArray("faces");
            for (int i = 0; i < faces.size(); i++) {
                final JsonObject face = object(faces.get(i), Set.of("preset", "overrides", "art"));
                enumeration(face, "preset", PRESETS);
                layer(face, true);
                faces.set(i, face);
            }
            while (!faces.isEmpty() && faces.get(faces.size() - 1).getAsJsonObject().isEmpty()) {
                faces.remove(faces.size() - 1);
            }
            if (faces.isEmpty()) {
                object.remove("faces");
            }
        }
        return object.get("preset").getAsString().equals("match") && object.size() == 2 ? null : object;
    }

    private static void layer(final JsonObject object, final boolean inherited) {
        if (object.has("overrides")) {
            final JsonObject overrides = overrides(object.get("overrides"), inherited);
            if (overrides.isEmpty()) {
                object.remove("overrides");
            } else {
                object.add("overrides", overrides);
            }
        }
        if (object.has("art")) {
            final JsonObject art = object(object.get("art"), Set.of("mode", "focalPoint", "zoom", "paperOpacity"));
            if (!art.has("mode")) {
                throw new IllegalArgumentException("art mode is required");
            }
            enumeration(art, "mode", Set.of("window", "behind-text"));
            pair(art, "focalPoint", 0, 1, inherited ? Double.NaN : 0.5);
            numeric(art, "zoom", 1, 8, false);
            numeric(art, "paperOpacity", 0, 1, false);
            if (art.has("paperOpacity") && !art.get("mode").getAsString().equals("behind-text")) {
                throw new IllegalArgumentException("paperOpacity requires behind-text artwork");
            }
            if (!inherited) {
                removeNumberDefault(art, "zoom", 1);
                removeNumberDefault(art, "paperOpacity", 0.8);
            }
            object.add("art", art);
        }
    }

    private static JsonObject overrides(final JsonElement value, final boolean inherited) {
        final JsonObject object = object(value, Set.of("artist", "legalText", "collectorNumber", "collectorTotal",
                "collectorFormat", "collectorLanguage", "collectorSetCode", "styleSetCode", "frameColors",
                "futureTreatment", "setSymbolCode", "setSymbolMask", "symbolStyle", "borderColor", "securityStamp", "elements"));
        for (final String key : new String[] {"artist", "legalText", "collectorNumber"}) {
            text(object, key, 2048, null);
        }
        for (final String key : new String[] {"collectorSetCode", "styleSetCode", "setSymbolCode"}) {
            text(object, key, 16, "[A-Za-z0-9_-]{1,16}");
        }
        text(object, "collectorLanguage", 5, "[A-Za-z]{2,5}");
        numeric(object, "collectorTotal", 1, 99999, true);
        enumeration(object, "collectorFormat", Set.of("number-first", "rarity-first"));
        enumeration(object, "futureTreatment", Set.of("regular", "full-art", "clear"));
        enumeration(object, "setSymbolMask", Set.of("auto", "alpha", "ink"));
        enumeration(object, "symbolStyle", Set.of("original", "modern"));
        enumeration(object, "borderColor", Set.of("black", "white", "silver"));
        enumeration(object, "securityStamp", Set.of("none", "oval", "triangle", "acorn", "circle", "arena", "heart"));
        if (object.has("frameColors")) {
            final JsonElement colorsValue = object.get("frameColors");
            if (!colorsValue.isJsonArray() || colorsValue.getAsJsonArray().size() > 5) {
                throw new IllegalArgumentException("invalid frame colors");
            }
            final Set<String> seen = new HashSet<>();
            for (final JsonElement color : colorsValue.getAsJsonArray()) {
                if (!color.isJsonPrimitive() || !color.getAsJsonPrimitive().isString()
                        || !Set.of("W", "U", "B", "R", "G").contains(color.getAsString()) || !seen.add(color.getAsString())) {
                    throw new IllegalArgumentException("invalid frame colors");
                }
            }
        }
        if (object.has("elements")) {
            final JsonObject elements = object(object.get("elements"), Set.of("artist", "legal", "collector", "manaCost", "setSymbol"));
            for (final String name : Set.copyOf(elements.keySet())) {
                final JsonObject element = object(elements.get(name), Set.of("hidden", "offset"));
                if (element.has("hidden") && (!element.get("hidden").isJsonPrimitive()
                        || !element.get("hidden").getAsJsonPrimitive().isBoolean())) {
                    throw new IllegalArgumentException("invalid element visibility");
                }
                pair(element, "offset", -100, 100, inherited ? Double.NaN : 0);
                if (element.isEmpty()) {
                    elements.remove(name);
                } else {
                    elements.add(name, element);
                }
            }
            if (elements.isEmpty()) {
                object.remove("elements");
            } else {
                object.add("elements", elements);
            }
        }
        return object;
    }

    private static JsonObject object(final JsonElement value, final Set<String> fields) {
        if (value == null || !value.isJsonObject()) {
            throw new IllegalArgumentException("cosmetic value must be an object");
        }
        final JsonObject object = new JsonObject();
        for (final var entry : value.getAsJsonObject().entrySet()) {
            if (!fields.contains(entry.getKey())) {
                throw new IllegalArgumentException("unknown cosmetic field: " + entry.getKey());
            }
            if (!entry.getValue().isJsonNull()) {
                object.add(entry.getKey(), entry.getValue());
            }
        }
        return object;
    }

    private static void enumeration(final JsonObject object, final String key, final Set<String> values) {
        if (object.has(key) && (!object.get(key).isJsonPrimitive() || !object.get(key).getAsJsonPrimitive().isString()
                || !values.contains(object.get(key).getAsString()))) {
            throw new IllegalArgumentException("invalid cosmetic " + key);
        }
    }

    private static void text(final JsonObject object, final String key, final int limit, final String pattern) {
        if (object.has(key) && (!object.get(key).isJsonPrimitive() || !object.get(key).getAsJsonPrimitive().isString()
                || object.get(key).getAsString().length() > limit
                || pattern != null && !object.get(key).getAsString().matches(pattern))) {
            throw new IllegalArgumentException("invalid cosmetic " + key);
        }
    }

    private static double numeric(final JsonObject object, final String key, final double min, final double max, final boolean integer) {
        if (!object.has(key)) {
            return Double.NaN;
        }
        final JsonElement value = object.get(key);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("invalid cosmetic " + key);
        }
        final double number = value.getAsDouble();
        if (!Double.isFinite(number) || number < min || number > max
                || integer && value.getAsBigDecimal().stripTrailingZeros().scale() > 0) {
            throw new IllegalArgumentException("invalid cosmetic " + key);
        }
        return number;
    }

    private static void pair(final JsonObject object, final String key, final double min, final double max, final double defaultValue) {
        if (!object.has(key)) {
            return;
        }
        final JsonElement value = object.get(key);
        if (!value.isJsonArray() || value.getAsJsonArray().size() != 2) {
            throw new IllegalArgumentException("invalid cosmetic " + key);
        }
        boolean defaults = true;
        for (final JsonElement coordinate : value.getAsJsonArray()) {
            final JsonObject component = new JsonObject();
            component.add(key, coordinate);
            final double number = numeric(component, key, min, max, false);
            defaults &= number == defaultValue;
        }
        if (defaults) {
            object.remove(key);
        }
    }

    private static void removeDefault(final JsonObject object, final String key, final String value) {
        if (object.has(key) && object.get(key).getAsString().equals(value)) {
            object.remove(key);
        }
    }

    private static void removeNumberDefault(final JsonObject object, final String key, final double value) {
        if (object.has(key) && object.get(key).getAsDouble() == value) {
            object.remove(key);
        }
    }
}
