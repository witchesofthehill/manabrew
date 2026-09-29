package design.manabrew.xmage;

import com.google.gson.*;
import java.util.*;
import java.util.function.BiConsumer;
import java.util.function.Predicate;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackType;
import mage.constants.ManaType;
import mage.remote.SessionImpl;
import mage.view.*;

import static design.manabrew.xmage.Main.*;

final class PromptBridge {
    private final SessionImpl session;
    private final BiConsumer<String, JsonObject> emit;
    private long sequence;
    private int lastSynchronizedMessage;
    private Pending pending;
    private UUID selectedAbility;
    private GameView latestView;

    private record Pending(long id, String family, Predicate<JsonObject> answer) {}

    PromptBridge(SessionImpl session, BiConsumer<String, JsonObject> emit) {
        this.session = session;
        this.emit = emit;
    }

    synchronized void invalidate() { pending = null; selectedAbility = null; }

    synchronized void accept(ClientCallback callback) {
        ClientCallbackType type = callback.getMethod().getType();
        if (type != ClientCallbackType.CLIENT_SIDE_EVENT) {
            if (callback.getMessageId() < lastSynchronizedMessage && type.mustIgnoreOnOutdated()) return;
            if (!type.canComeInAnyOrder()) lastSynchronizedMessage = Math.max(lastSynchronizedMessage, callback.getMessageId());
        }
        String method = callback.getMethod().name();
        Object data = callback.getData();
        GameView snapshot = data instanceof GameView ? (GameView) data
                : data instanceof GameClientMessage ? ((GameClientMessage) data).getGameView()
                : data instanceof AbilityPickerView ? ((AbilityPickerView) data).getGameView() : null;
        if (snapshot != null) {
            latestView = snapshot;
            emit.accept("state", StateProjection.project(callback.getObjectId(), snapshot));
        }
        JsonObject evidence = object("callback", method);
        evidence.addProperty("messageId", callback.getMessageId());
        evidence.addProperty("objectId", String.valueOf(callback.getObjectId()));
        if (data instanceof GameClientMessage) {
            GameClientMessage message = (GameClientMessage) data;
            evidence.addProperty("message", message.getMessage());
            evidence.add("options", JSON.toJsonTree(message.getOptions()));
            evidence.add("targets", JSON.toJsonTree(message.getTargets()));
            evidence.add("amounts", JSON.toJsonTree(message.getMessages()));
            evidence.add("choice", JSON.toJsonTree(message.getChoice()));
            evidence.addProperty("min", message.getMin());
            evidence.addProperty("max", message.getMax());
            evidence.addProperty("required", message.isFlag());
            if (message.getGameView() != null) {
                evidence.add("playableObjects", JSON.toJsonTree(message.getGameView().getCanPlayObjects()));
                evidence.addProperty("step", String.valueOf(message.getGameView().getStep()));
            }
        }
        if (data instanceof AbilityPickerView) {
            AbilityPickerView picker = (AbilityPickerView) data;
            evidence.addProperty("message", picker.getMessage());
            evidence.add("choices", JSON.toJsonTree(picker.getChoices()));
        }
        emit.accept("callback", evidence);
        if (data instanceof GameEndView) {
            GameEndView end = (GameEndView) data;
            JsonObject result = object("gameId", callback.getObjectId().toString());
            result.addProperty("won", end.hasWon());
            result.addProperty("gameInfo", end.getGameInfo());
            result.addProperty("playerId", end.getClientPlayer().getPlayerId().toString());
            result.add("players", JSON.toJsonTree(end.getPlayers().stream().map(player -> {
                JsonObject out = object("id", player.getPlayerId().toString());
                out.addProperty("life", player.getLife());
                out.addProperty("libraryCount", player.getLibraryCount());
                return out;
            }).toList()));
            if (latestView != null) {
                JsonObject update = StateProjection.project(callback.getObjectId(), latestView);
                update.getAsJsonObject("gameView").addProperty("gameOver", true);
                if (end.hasWon()) update.getAsJsonObject("gameView").addProperty("winnerId", end.getClientPlayer().getPlayerId().toString());
                else update.getAsJsonArray("unavailableFields").add("gameView.winnerId");
                emit.accept("state", update);
            }
            emit.accept("gameEnded", result);
        }
        if (method.equals("GAME_OVER") || method.equals("END_GAME_INFO")) {
            invalidate();
            return;
        }
        if (callback.getMethod().getType() != ClientCallbackType.DIALOG) return;
        pending = null;
        UUID gameId = callback.getObjectId();
        if (data instanceof AbilityPickerView && method.equals("GAME_CHOOSE_ABILITY")) {
            AbilityPickerView picker = (AbilityPickerView) data;
            if (selectedAbility != null) {
                UUID ability = selectedAbility;
                selectedAbility = null;
                if (picker.getChoices().containsKey(ability)) {
                    require(session.sendPlayerUUID(gameId, ability), "Ability response failed");
                    return;
                }
            }
            List<UUID> ids = new ArrayList<>(picker.getChoices().keySet());
            selection(picker.getGameView(), picker.getMessage(), ids.stream().map(picker.getChoices()::get).toList(),
                    index -> session.sendPlayerUUID(gameId, ids.get(index)));
            return;
        }
        selectedAbility = null;
        if (!(data instanceof GameClientMessage)) {
            finding("adapterGap", "unimplemented-callback", evidence);
            return;
        }
        GameClientMessage message = (GameClientMessage) data;
        GameView view = message.getGameView();
        switch (method) {
            case "GAME_ASK": {
                if (message.getOptions() != null && message.getOptions().containsKey("specialButton")) {
                    finding("adapterGap", "boolean-special-button", evidence);
                    return;
                }
                JsonObject input = presented("chooseBoolean", message.getMessage());
                input.addProperty("confirmLabel", option(message, "UI.left.btn.text", "Yes"));
                input.addProperty("denyLabel", option(message, "UI.right.btn.text", "No"));
                prompt(view, input, output -> {
                    expect(output, "decision");
                    JsonElement value = output.get("value");
                    if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
                        throw new IllegalArgumentException("Expected boolean value");
                    }
                    return session.sendPlayerBoolean(gameId, value.getAsBoolean());
                });
                break;
            }
            case "GAME_CHOOSE_CHOICE": {
                mage.choices.Choice choice = message.getChoice();
                if (choice.isSpecialEnabled()) {
                    finding("adapterGap", "custom-text-choice", evidence);
                    break;
                }
                List<String> keys = new ArrayList<>(choice.isKeyChoice() ? choice.getKeyChoices().keySet() : choice.getChoices());
                List<String> labels = choice.isKeyChoice() ? keys.stream().map(choice.getKeyChoices()::get).toList() : keys;
                selection(view, choice.getMessage(), labels,
                        index -> session.sendPlayerString(gameId, keys.get(index)),
                        choice.isRequired() ? null : () -> session.sendPlayerBoolean(gameId, false));
                break;
            }
            case "GAME_GET_MULTI_AMOUNT": {
                amounts(view, message, gameId, new ArrayList<>());
                break;
            }
            case "GAME_GET_AMOUNT": {
                JsonObject input = presented("chooseNumber", message.getMessage());
                input.addProperty("min", message.getMin());
                input.addProperty("max", message.getMax());
                input.addProperty("cancellable", false);
                prompt(view, input, output -> {
                    expect(output, "numberDecision");
                    if (!output.has("chosenNumber") || output.get("chosenNumber").isJsonNull()) throw new IllegalArgumentException("CancelNotAllowed");
                    int amount = integer(output.get("chosenNumber"));
                    if (amount < message.getMin() || amount > message.getMax()) throw new IllegalArgumentException("Amount out of range");
                    return session.sendPlayerInteger(gameId, amount);
                });
                break;
            }
            case "GAME_PLAY_MANA": {
                CardView source = view.getStack().values().stream().filter(card -> !card.isPaid()).findFirst().orElse(null);
                JsonObject input = presented("payManaCost", message.getMessage());
                if (source != null) {
                    input.addProperty("cardId", source.getId().toString());
                    input.addProperty("cardName", source.getName());
                }
                input.addProperty("manaCost", message.getMessage().replaceFirst("^Pay ", "").split("<div", 2)[0]);
                input.addProperty("canConfirmFromPool", false);
                input.addProperty("autoPayAvailable", false);
                JsonArray actions = new JsonArray();
                Map<String, java.util.function.BooleanSupplier> answers = new HashMap<>();
                for (PlayerView player : view.getPlayers()) {
                    if (!player.getControlled()) continue;
                    ManaPoolView pool = player.getManaPool();
                    int[] amounts = {pool.getWhite(), pool.getBlue(), pool.getBlack(), pool.getRed(), pool.getGreen(), pool.getColorless()};
                    ManaType[] colors = {ManaType.WHITE, ManaType.BLUE, ManaType.BLACK, ManaType.RED, ManaType.GREEN, ManaType.COLORLESS};
                    String[] codes = {"W", "U", "B", "R", "G", "C"};
                    for (int index = 0; index < colors.length; index++) {
                        if (amounts[index] == 0) continue;
                        ManaType color = colors[index];
                        String id = "pool:" + player.getPlayerId() + ":" + codes[index];
                        JsonObject action = object("id", id);
                        action.addProperty("type", "spendMana");
                        action.addProperty("playerId", player.getPlayerId().toString());
                        action.addProperty("color", codes[index]);
                        actions.add(action);
                        answers.put(id, () -> session.sendPlayerManaType(gameId, player.getPlayerId(), color));
                    }
                }
                JsonObject offered = evidence.getAsJsonObject("playableObjects").getAsJsonObject("objects");
                for (String cardId : new TreeSet<>(offered.keySet())) {
                    JsonArray abilities = offered.getAsJsonObject(cardId).getAsJsonArray("basicManaAbilities");
                    for (int index = 0; index < abilities.size(); index++) {
                        JsonObject ability = abilities.get(index).getAsJsonObject();
                        UUID abilityId = uuid(ability, "id");
                        String id = "mana:" + cardId + ":" + abilityId;
                        JsonObject action = object("id", id);
                        action.addProperty("type", "activateManaAbility");
                        action.addProperty("cardId", cardId);
                        action.addProperty("abilityIndex", index);
                        action.addProperty("description", NativeText.plain(ability.get("value").getAsString()));
                        action.addProperty("isManaAbility", true);
                        actions.add(action);
                        answers.put(id, () -> {
                            selectedAbility = abilityId;
                            return session.sendPlayerUUID(gameId, UUID.fromString(cardId));
                        });
                    }
                }
                for (String cardId : new TreeSet<>(offered.keySet())) {
                    for (JsonElement entry : offered.getAsJsonObject(cardId).getAsJsonArray("other")) {
                        JsonObject ability = entry.getAsJsonObject();
                        UUID abilityId = uuid(ability, "id");
                        String id = "payment:" + cardId + ":" + abilityId;
                        JsonObject action = object("id", id);
                        action.addProperty("type", "unclassified");
                        action.addProperty("label", NativeText.plain(ability.get("value").getAsString()));
                        actions.add(action);
                        answers.put(id, () -> {
                            selectedAbility = abilityId;
                            return session.sendPlayerUUID(gameId, UUID.fromString(cardId));
                        });
                    }
                }
                if (view.getSpecial()) {
                    JsonObject action = object("id", "special");
                    action.addProperty("type", "unclassified");
                    action.addProperty("label", "Special payment action");
                    actions.add(action);
                    answers.put("special", () -> session.sendPlayerString(gameId, "special"));
                }
                input.add("actions", actions);
                prompt(view, input, output -> {
                    if ("cancel".equals(output.get("type").getAsString())) return session.sendPlayerBoolean(gameId, false);
                    if ("pay".equals(output.get("type").getAsString())) throw new IllegalArgumentException("PaymentNotAvailable");
                    expect(output, "act");
                    java.util.function.BooleanSupplier answer = answers.get(output.get("actionId").getAsString());
                    if (answer == null) throw new IllegalArgumentException("UnknownActionId");
                    return answer.getAsBoolean();
                });
                break;
            }
            case "GAME_TARGET": {
                Set<UUID> targets = message.getTargets();
                if (view != null && view.getStep() == null && targets != null && !targets.isEmpty()
                        && targets.stream().allMatch(id -> view.getPlayers().stream().anyMatch(p -> p.getPlayerId().equals(id)))) {
                    List<PlayerView> players = view.getPlayers().stream().filter(p -> targets.contains(p.getPlayerId())).toList();
                    selection(view, message.getMessage(), players.stream().map(PlayerView::getName).toList(),
                            index -> session.sendPlayerUUID(gameId, players.get(index).getPlayerId()));
                } else {
                    Set<UUID> chosen = new HashSet<>();
                    if (message.getOptions() != null && message.getOptions().get("chosenTargets") instanceof Collection<?>) {
                        for (Object id : (Collection<?>) message.getOptions().get("chosenTargets")) chosen.add((UUID) id);
                    }
                    boolean done = "Done".equals(option(message, "UI.right.btn.text", ""));
                    objects(view, message.getMessage(), targets == null ? Set.of() : targets, chosen, "unknown",
                            !message.isFlag() && done, !message.isFlag() && !done, gameId);
                }
                break;
            }
            case "GAME_SELECT": {
                Map<String, java.io.Serializable> options = message.getOptions();
                if (options != null && (options.containsKey("possibleAttackers") || options.containsKey("possibleBlockers"))) {
                    boolean attacking = options.containsKey("possibleAttackers");
                    Collection<?> offered = (Collection<?>) options.get(attacking ? "possibleAttackers" : "possibleBlockers");
                    Set<UUID> ids = new HashSet<>();
                    for (Object id : offered) ids.add((UUID) id);
                    Set<UUID> chosen = new HashSet<>();
                    for (CombatGroupView group : view.getCombat()) {
                        chosen.addAll((attacking ? group.getAttackers() : group.getBlockers()).keySet());
                    }
                    ids.addAll(chosen);
                    objects(view, message.getMessage(), ids, chosen, attacking ? "attack" : "block", true, false, gameId);
                } else if (view == null || view.getCanPlayObjects() == null) {
                    finding("adapterGap", "priority-without-playable-objects", evidence);
                } else if (view.getSpecial()) {
                    finding("adapterGap", "special-priority-actions-not-implemented", evidence);
                } else {
                    JsonObject input = object("type", "chooseAction");
                    JsonArray actions = new JsonArray();
                    Map<String, UUID[]> bindings = new HashMap<>();
                    JsonObject objects = evidence.getAsJsonObject("playableObjects").getAsJsonObject("objects");
                    for (String cardId : new TreeSet<>(objects.keySet())) {
                        JsonObject stats = objects.getAsJsonObject(cardId);
                        int abilityIndex = 0;
                        for (String category : List.of("basicManaAbilities", "basicPlayAbilities", "basicCastAbilities", "other")) {
                            for (JsonElement entry : stats.getAsJsonArray(category)) {
                                JsonObject record = entry.getAsJsonObject();
                                String abilityId = record.get("id").getAsString();
                                String actionId = cardId + ":" + abilityId;
                                JsonObject action = object("id", actionId);
                                action.addProperty("cardId", cardId);
                                if (category.equals("basicManaAbilities")) {
                                    action.addProperty("type", "activateAbility");
                                    action.addProperty("abilityIndex", abilityIndex);
                                    action.addProperty("description", NativeText.plain(record.get("value").getAsString()));
                                    action.addProperty("isManaAbility", true);
                                } else if (category.equals("other")) {
                                    action.addProperty("type", "unclassified");
                                    action.addProperty("label", NativeText.plain(record.get("value").getAsString()));
                                } else {
                                    action.addProperty("type", "cast");
                                    action.add("mode", object("type", "normal"));
                                    action.addProperty("label", NativeText.plain(record.get("value").getAsString()));
                                }
                                abilityIndex++;
                                actions.add(action);
                                bindings.put(actionId, new UUID[]{UUID.fromString(cardId), UUID.fromString(abilityId)});
                            }
                        }
                    }
                    input.add("actions", actions);
                    prompt(view, input, output -> {
                        if ("act".equals(output.get("type").getAsString())) {
                            UUID[] binding = bindings.get(output.get("actionId").getAsString());
                            if (binding == null) throw new IllegalArgumentException("UnknownActionId");
                            selectedAbility = binding[1];
                            return session.sendPlayerUUID(gameId, binding[0]);
                        }
                        expect(output, "pass");
                        if ((output.has("until") && !output.get("until").isJsonNull())
                                || (output.has("exhaustStack") && output.get("exhaustStack").getAsBoolean())) {
                            throw new IllegalArgumentException("Only a single priority pass is implemented");
                        }
                        return session.sendPlayerBoolean(gameId, false);
                    });
                }
                break;
            }
            default:
                finding("adapterGap", "unimplemented-callback", evidence);
        }
    }

    private void amounts(GameView view, GameClientMessage message, UUID gameId, List<Integer> chosen) {
        List<mage.util.MultiAmountMessage> entries = message.getMessages();
        int index = chosen.size();
        mage.util.MultiAmountMessage entry = entries.get(index);
        long sum = chosen.stream().mapToLong(Integer::longValue).sum();
        long remainingMin = entries.subList(index + 1, entries.size()).stream().mapToLong(item -> item.min).sum();
        long remainingMax = entries.subList(index + 1, entries.size()).stream().mapToLong(item -> item.max).sum();
        int min = (int) Math.max(entry.min, (long) message.getMin() - sum - remainingMax);
        int max = (int) Math.min(entry.max, (long) message.getMax() - sum - remainingMin);
        require(min <= max, "Infeasible amount bounds");
        JsonObject input = presented("chooseNumber", option(message, "header", "Allocate amounts"));
        input.getAsJsonObject("presentation").addProperty("description", NativeText.plain(entry.message));
        input.addProperty("min", min);
        input.addProperty("max", max);
        boolean cancellable = message.getOptions() != null && Boolean.TRUE.equals(message.getOptions().get("canCancel"));
        input.addProperty("cancellable", cancellable);
        prompt(view, input, output -> {
            expect(output, "numberDecision");
            if (!output.has("chosenNumber") || output.get("chosenNumber").isJsonNull()) {
                if (!cancellable) throw new IllegalArgumentException("CancelNotAllowed");
                return session.sendPlayerBoolean(gameId, false);
            }
            int value = integer(output.get("chosenNumber"));
            if (value < min || value > max) throw new IllegalArgumentException("Amount out of range");
            chosen.add(value);
            if (chosen.size() == entries.size()) {
                return session.sendPlayerString(gameId, String.join(" ", chosen.stream().map(Object::toString).toList()));
            }
            amounts(view, message, gameId, chosen);
            return true;
        });
    }

    private void objects(GameView view, String title, Collection<UUID> ids, Set<UUID> selected,
                         String intent, boolean canFinish, boolean cancellable, UUID gameId) {
        JsonObject input = presented("chooseObject", title);
        Map<String, JsonObject> bindings = new LinkedHashMap<>();
        JsonArray candidates = new JsonArray();
        JsonArray chosen = new JsonArray();
        for (UUID id : ids.stream().sorted(Comparator.comparing(UUID::toString)).toList()) {
            JsonObject target = object("id", id.toString());
            boolean player = view.getPlayers().stream().anyMatch(p -> p.getPlayerId().equals(id));
            target.addProperty("kind", player ? "player" : view.getStack().containsKey(id) ? "spell" : "card");
            candidates.add(target);
            bindings.put(id.toString(), target);
            if (selected.contains(id)) chosen.add(target);
        }
        input.add("candidates", candidates);
        input.add("selected", chosen);
        input.addProperty("intent", intent);
        input.addProperty("canFinish", canFinish);
        input.addProperty("cancellable", cancellable);
        prompt(view, input, output -> {
            switch (output.get("type").getAsString()) {
                case "select": {
                    JsonObject target = output.getAsJsonObject("target");
                    JsonObject offered = bindings.get(target.get("id").getAsString());
                    if (offered == null || !offered.get("kind").equals(target.get("kind"))) throw new IllegalArgumentException("UnknownObjectId");
                    return session.sendPlayerUUID(gameId, uuid(target, "id"));
                }
                case "finish":
                    if (!canFinish) throw new IllegalArgumentException("FinishNotAllowed");
                    return session.sendPlayerBoolean(gameId, true);
                case "cancel":
                    if (!cancellable) throw new IllegalArgumentException("CancelNotAllowed");
                    return session.sendPlayerBoolean(gameId, false);
                default: throw new IllegalArgumentException("Invalid output variant");
            }
        });
    }

    private void selection(GameView view, String title, List<String> labels, java.util.function.IntPredicate answer) {
        selection(view, title, labels, answer, null);
    }

    private void selection(GameView view, String title, List<String> labels, java.util.function.IntPredicate answer,
                           java.util.function.BooleanSupplier cancel) {
        if (labels.isEmpty()) throw new IllegalArgumentException("Empty selection");
        JsonObject input = presented("chooseFromSelection", title);
        JsonArray options = new JsonArray();
        for (String label : labels) {
            JsonObject option = object("label", NativeText.plain(label));
            option.addProperty("weight", 1);
            option.addProperty("canRepeat", false);
            options.add(option);
        }
        input.add("options", options);
        input.addProperty("minTotal", cancel == null ? 1 : 0);
        input.addProperty("maxTotal", 1);
        prompt(view, input, output -> {
            expect(output, "selectionDecision");
            JsonArray indices = output.getAsJsonArray("chosenIndices");
            if (indices.isEmpty() && cancel != null) return cancel.getAsBoolean();
            if (indices.size() != 1) throw new IllegalArgumentException("Expected exactly one selection");
            int index = integer(indices.get(0));
            if (index < 0 || index >= labels.size()) throw new IllegalArgumentException("Unknown selection");
            return answer.test(index);
        });
    }

    private void prompt(GameView view, JsonObject input, Predicate<JsonObject> answer) {
        long id = ++sequence;
        if (id > 0xffffffffL) throw new IllegalStateException("Prompt id space exhausted");
        JsonObject prompt = new JsonObject();
        prompt.addProperty("promptId", id);
        if (view != null && view.getMyPlayer() != null) prompt.addProperty("decidingPlayerId", view.getMyPlayer().getPlayerId().toString());
        prompt.add("input", input);
        pending = new Pending(id, input.get("type").getAsString(), answer);
        emit.accept("prompt", prompt);
    }

    synchronized void respond(JsonObject response) {
        expectKind(response, "response");
        long id = number(response.get("promptId")).longValueExact();
        if (id < 0 || id > 0xffffffffL) throw new IllegalArgumentException("Prompt id out of range");
        if (pending == null || pending.id() != id) throw new IllegalArgumentException("StalePrompt");
        JsonObject action = response.getAsJsonObject("action");
        if (!pending.family().equals(action.get("type").getAsString())) throw new IllegalArgumentException("WrongPromptType");
        Pending current = pending;
        boolean sent = current.answer().test(action.getAsJsonObject("output"));
        if (pending == current) pending = null;
        require(sent, "XMage response failed; reconnect before retrying");
    }

    private void finding(String classification, String code, JsonObject evidence) {
        JsonObject finding = object("classification", classification);
        finding.addProperty("code", code);
        finding.add("evidence", evidence);
        emit.accept("compatibilityFinding", finding);
    }

    private static JsonObject presented(String type, String title) {
        JsonObject input = object("type", type);
        JsonObject presentation = object("title", NativeText.plain(title));
        presentation.add("targets", new JsonArray());
        input.add("presentation", presentation);
        return input;
    }

    private static String option(GameClientMessage message, String key, String fallback) {
        return message.getOptions() != null && message.getOptions().get(key) instanceof String
                ? (String) message.getOptions().get(key) : fallback;
    }

    private static int integer(JsonElement value) {
        return number(value).intValueExact();
    }

    private static java.math.BigDecimal number(JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()
                || !value.toString().matches("-?[0-9]+")) throw new IllegalArgumentException("Expected integer");
        return value.getAsBigDecimal();
    }

    private static void expect(JsonObject output, String type) {
        if (!type.equals(output.get("type").getAsString())) throw new IllegalArgumentException("Invalid output variant");
    }

    private static void expectKind(JsonObject output, String kind) {
        if (!kind.equals(output.get("kind").getAsString())) throw new IllegalArgumentException("Expected ClientToServerMessage::Response");
    }
}
