/* tslint:disable */
/* eslint-disable */

export class WasmBot {
    free(): void;
    [Symbol.dispose](): void;
    failure(): string | undefined;
    constructor(config_json: string);
    on_open(): string[];
    on_server_message(text: string): string[];
}

/**
 * Verify WASM is working by echoing back a message.
 */
export function echo(msg: string): string;

/**
 * Get the number of cards in the database.
 */
export function get_card_count(): number;

/**
 * Get engine information.
 */
export function get_engine_info(): any;

export function get_token_count(): number;

/**
 * Look up a card by name to verify it exists.
 */
export function has_card(name: string): boolean;

/**
 * Check if the card database is loaded.
 */
export function is_card_db_loaded(): boolean;

export function is_token_db_loaded(): boolean;

export function limited_advance_gauntlet_round(gauntlet_id: string): any;

export function limited_cubecobra_url(cube_id_or_url: string): string;

export function limited_drop_session(kind: string, session_id: string): boolean;

export function limited_get_draft_state(session_id: string): any;

export function limited_get_edition_info(set_code: string): any;

export function limited_get_gauntlet_match_decks(gauntlet_id: string): any;

export function limited_get_gauntlet_state(gauntlet_id: string): any;

export function limited_get_sealed_pool(session_id: string): any;

/**
 * Return every card in a given set, formatted as a `DraftCardDto[]` —
 * the same shape `limited_start_sealed` / `limited_start_booster_draft`
 * expect for their `setup.pool` field.
 *
 * Replaces the React-side Scryfall round-trip: the archive's
 * `EditionsRegistry` already knows every card in every set, and the
 * engine's `CardDatabase` already knows each card's colors and
 * dual-faced-ness, so there's no need to call out to Scryfall just to
 * learn what's in a set. Card images remain a Scryfall concern.
 */
export function limited_get_set_pool(set_code: string): any;

export function limited_get_winston_state(session_id: string): any;

export function limited_import_cube(request_json: any, body: string): any;

export function limited_list_chaos_themes(): any;

export function limited_list_conspiracy_hooks(): any;

export function limited_list_sealed_templates(): any;

export function limited_pick_card(session_id: string, card_name: string): any;

export function limited_record_gauntlet_outcome(gauntlet_id: string, won_game: boolean, match_over: boolean, match_won: boolean): any;

export function limited_start_booster_draft(setup_json: any): any;

export function limited_start_gauntlet_from_sealed(session_id: string, rounds: number): any;

export function limited_start_sealed(setup_json: any): any;

export function limited_start_winston(setup_json: any): any;

export function limited_undo_pick(session_id: string): any;

export function limited_update_gauntlet_human_deck(update_json: any): any;

export function limited_winston_pass(session_id: string): any;

export function limited_winston_take(session_id: string): any;

/**
 * Load the card + token + edition database from a single rkyv archive.
 */
export function load_card_archive(bytes: Uint8Array): bigint;

/**
 * Log a message to the browser console (for debugging).
 */
export function log(msg: string): void;

/**
 * Parse a game config from JSON.
 */
export function parse_config(config_json: any): any;

/**
 * Parse a deck from JSON.
 *
 * Returns a summary of the parsed deck for verification.
 */
export function parse_deck(deck_json: any): any;

/**
 * Run an interactive game with a human player (blocking on Atomics.wait).
 *
 * This function blocks the worker thread until the game is complete.
 * The human player's prompts are written to the SharedArrayBuffer,
 * and the worker blocks until the main thread provides a response.
 *
 * Call this from a Web Worker — it will block the thread.
 */
export function run_interactive_game(human_deck_json: any, ai_deck_json: any, config_json: any, shared_buffer: any): any;

/**
 * Run an N-player multiplayer game using one SharedArrayBuffer per seat.
 *
 * `local_buffer` carries prompts for `local_player_index` — the seat
 * the worker is hosting from. `remote_buffers` is an array of length
 * `num_players - 1`, ordered by player index with the local seat
 * skipped: for a 4-player game with local=player-2 the array is
 * `[sab_for_p0, sab_for_p1, sab_for_p3]`. Each SAB is consumed by a
 * dedicated `WasmTransport`; the worker blocks on `Atomics.wait()` per
 * seat sequentially (never concurrently).
 *
 * `commander_names_json` is an array of `Option<String>` matching the
 * deck order; non-null entries pull the named card into the command
 * zone before the loop starts.
 */
export function run_multiplayer_game(decks_json: any, commander_names_json: any, config_json: any, local_buffer: any, remote_buffers: any, local_player_index: number): any;

/**
 * Test that forge-foundation types work.
 */
export function test_foundation(): any;

/**
 * Test that the RNG works in WASM.
 */
export function test_rng(): any;

/**
 * Initialize the WASM module. Call this once at startup.
 */
export function wasm_init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmbot_free: (a: number, b: number) => void;
    readonly wasmbot_new: (a: number, b: number) => [number, number, number];
    readonly wasmbot_on_open: (a: number) => [number, number];
    readonly wasmbot_on_server_message: (a: number, b: number, c: number) => [number, number];
    readonly wasmbot_failure: (a: number) => [number, number];
    readonly get_engine_info: () => any;
    readonly echo: (a: number, b: number) => [number, number];
    readonly parse_deck: (a: any) => [number, number, number];
    readonly parse_config: (a: any) => [number, number, number];
    readonly test_rng: () => any;
    readonly test_foundation: () => any;
    readonly run_interactive_game: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly run_multiplayer_game: (a: any, b: any, c: any, d: any, e: any, f: number) => [number, number, number];
    readonly load_card_archive: (a: number, b: number) => [bigint, number, number];
    readonly is_card_db_loaded: () => number;
    readonly get_card_count: () => number;
    readonly is_token_db_loaded: () => number;
    readonly get_token_count: () => number;
    readonly has_card: (a: number, b: number) => number;
    readonly log: (a: number, b: number) => void;
    readonly wasm_init: () => void;
    readonly limited_get_set_pool: (a: number, b: number) => [number, number, number];
    readonly limited_list_sealed_templates: () => [number, number, number];
    readonly limited_list_chaos_themes: () => [number, number, number];
    readonly limited_list_conspiracy_hooks: () => [number, number, number];
    readonly limited_start_sealed: (a: any) => [number, number, number];
    readonly limited_get_sealed_pool: (a: number, b: number) => [number, number, number];
    readonly limited_get_edition_info: (a: number, b: number) => [number, number, number];
    readonly limited_start_booster_draft: (a: any) => [number, number, number];
    readonly limited_pick_card: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly limited_get_draft_state: (a: number, b: number) => [number, number, number];
    readonly limited_undo_pick: (a: number, b: number) => [number, number, number];
    readonly limited_start_winston: (a: any) => [number, number, number];
    readonly limited_winston_take: (a: number, b: number) => [number, number, number];
    readonly limited_winston_pass: (a: number, b: number) => [number, number, number];
    readonly limited_get_winston_state: (a: number, b: number) => [number, number, number];
    readonly limited_start_gauntlet_from_sealed: (a: number, b: number, c: number) => [number, number, number];
    readonly limited_record_gauntlet_outcome: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly limited_advance_gauntlet_round: (a: number, b: number) => [number, number, number];
    readonly limited_get_gauntlet_state: (a: number, b: number) => [number, number, number];
    readonly limited_get_gauntlet_match_decks: (a: number, b: number) => [number, number, number];
    readonly limited_update_gauntlet_human_deck: (a: any) => [number, number, number];
    readonly limited_drop_session: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly limited_cubecobra_url: (a: number, b: number) => [number, number, number, number];
    readonly limited_import_cube: (a: any, b: number, c: number) => [number, number, number];
    readonly __wbindgen_malloc_command_export: (a: number, b: number) => number;
    readonly __wbindgen_realloc_command_export: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store_command_export: (a: number) => void;
    readonly __externref_table_alloc_command_export: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free_command_export: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc_command_export: (a: number) => void;
    readonly __externref_drop_slice_command_export: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
