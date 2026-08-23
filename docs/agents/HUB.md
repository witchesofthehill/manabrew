# The hub (`manabrew-rs/crates/manabrew-hub`)

Standalone axum+rusqlite HTTP service (port 9500) behind `api.manabrew.app`. Owns authentication, canonical account decks, immutable deck versions and card rows, public DeckHub entries, tags, favorites, and dated Top Deck ranking snapshots in `hub.db`; the legacy publication and telemetry endpoints remain available for rolling-client compatibility. Never touches the relay or engine.

## Auth

OAuth 2.0: `POST /api/auth/token` is the token endpoint (`grant_type=refresh_token`, RFC 8707 `resource` selecting the audience), sign-in grants return an access/refresh pair, and `POST /api/auth/logout` is RFC 7009 revocation taking the refresh token in the body. Access tokens are 10-minute EdDSA JWTs signed by `HUB_JWT_KEY_PATH` and verified by signature (`auth/token.rs`), so `SessionAccount` no longer touches the `sessions` table — that table now stores refresh-token hashes only, presented to the token endpoint and nowhere else.

**Every audience gets its own token and they are never interchangeable** (RFC 9068 §5 requires a distinct `aud` per resource, and RFC 9700 warns about replay at a different resource server): `manabrew-hub` for this API, `manabrew-relay` for relay identity attestation, which is what keeps a self-hosted relay operator from acting on the Hub as the players who connect to them. Revoking a refresh token stops new access tokens but leaves issued ones valid for up to their 10 minutes; account deletion is immediate because verification still resolves `sub` against `accounts`.

Guests have no account row: `POST /api/auth/guest-token` mints a relay-audience token for a guest's chosen display name, refusing (409) when the base name (minus the `@NNNN` tag) matches a claimed account handle, case-insensitively. The guest `sub` is derived from the browser's device secret. No reservation is written — guest names stay ephemeral.

## Account deletion vs publications

`DELETE /api/auth/me` (`Storage::delete_account`) erases the account and hard-deletes its decks, but a deck backing a Community publication survives with `account_id` set to NULL, which `15_orphan_decks.sql` allows by relaxing the `decks` CHECK. An ownerless deck is normal: queries that read `decks.account_id` into a non-optional value must filter `account_id IS NOT NULL`, and the entry `author` is `None` on the wire so the client can distinguish a deleted owner from a real handle.

## Player assets

Avatars and playmats are objects in an S3-compatible bucket, not bytes on the wire. `HUB_S3_*` plus `HUB_ASSET_QUOTA_BYTES` configure `assets.rs`; unset any required one and `HubCapabilities.assets` is absent and every asset route answers 503. Keys are `<account_id>/<avatar|playmats>/<uuid>.webp`, derived by `assets::object_key` and never stored — the account id is immutable, so nothing has to be rewritten when a handle changes. The bucket is public and the hub never signs a read, so the unguessable uuid is the entire read-control story.

`POST /api/assets` reserves quota **before** issuing the presigned PUT, because the URL is handed out before any byte exists and a check at upload time would be checking something already paid for. The presign signs `content-length`, so a body of any other size fails the signature at the endpoint instead of landing in the bucket; `assets.rs` has a test asserting `content-length` survives into `X-Amz-SignedHeaders`, which is the only thing making the reservation equal to reality. Both `pending` and `active` rows count against the quota, per-account via `accounts.asset_quota_bytes` falling back to the configured default.

Nothing asks the client to confirm its own upload. A reservation outlives the presigned URL, and the sweeper (`sweep_expired_assets`, every 5 min) HEADs each expired `pending` row: object present → promote and correct `byte_size` from the real length, absent → drop the row and release the reservation. Referencing an asset — as an account avatar or a deck playmat — promotes it on a DB ownership check alone. The reservation TTL is hours, not minutes, because a playmat sits unattached while a deck is still being edited.

Deleting always removes the object first and the row second. The reverse order strands bytes in the bucket that nothing can name, while a failed row delete just leaves the asset owned and retryable. `delete_account_handler` follows the same order for the same reason: dropping the account cascades `account_assets` away and takes the keys with it.

Ids are what the hub stores; URLs are what it returns. `decks.playmat_asset_id` and `accounts.avatar_asset_id` are real columns with `ON DELETE SET NULL`, so deleting an asset clears every reference without a scan, while `Deck.playmat_url`, `AuthAccount.avatar_url`, `AccountAsset.url` and `AssetUpload.public_url` are all joined from `ObjectStore::public_url` on the way out. Clients never build an asset URL — `with_playmat_url` and `auth::asset_url` fill them in, and a write's `playmat_url` is ignored and re-derived. `AccountExportProfile.provider_avatar_url` is the OAuth provider's picture and was renamed to keep it from colliding with the flattened `avatarUrl`. That forces the playmat out of `snapshot_json` — a foreign key cannot reach into a JSON blob — which is why `save_account_deck` writes the column _before_ the content-hash short circuit: changing only the playmat produces an identical snapshot and no new version.

## Migrations

Schema lives in `migrations/N_*.sql`; `build.rs` scans that directory, orders files numerically, rejects duplicate versions, embeds their SQL, and generates versioned migration tuples. `Storage::migrate` reads `schema_version`, runs only newer migrations in order, and advances the version in the same transaction; migration-specific Rust backfills run inside that transaction when SQL alone cannot preserve legacy data. Never edit an applied migration or add an unguarded migration with a reused version. A migration that rebuilds a table other rows point at (`DROP TABLE x; ALTER TABLE x_new RENAME TO x`) must be listed in `rebuilds_decks` so the runner turns `PRAGMA foreign_keys` off around it; with enforcement on, the drop cascades into a `FOREIGN KEY constraint failed` as soon as the table has children, which an empty test database never shows. A DB created before `schema_version` existed maps to version 0 and still runs `1_schema.sql`, whose baseline `CREATE TABLE IF NOT EXISTS` cannot add columns to a pre-existing `hub_decks`; `Storage::upgrade_legacy_schema` adds `account_id` in Rust before the runner (skipping it crashed the v3.2.0 deploy).

## DTOs and misc

The crate owns its REST DTOs in `src/dto.rs`, exported to `src/api/hubTypes.ts` + `src/api/authTypes.ts` by `cargo xtask gen-types` (`yarn gen:types`). It also owns the daily Scryfall `default_cards` JSONL bulk index used by collection verification and the process-wide throttled relay for permitted interactive Scryfall API routes.

## Deck Hub flag

Publication writes require `SessionAccount`. The Hub service's `DECK_HUB` flag defaults off and blocks publication creation, publication updates, and favorite mutations when disabled; public reads and authenticated removal of existing publications remain available. Wire the same value into the web and Hub containers so UI exposure and server enforcement cannot drift.
