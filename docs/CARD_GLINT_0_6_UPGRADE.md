# Card Glint 0.6.0 integration

## Release

Manabrew pins the official [0.6.0 release](https://github.com/vishvananda/card-glint/releases/tag/v0.6.0), replacing 0.5.2. [Battle PR #8](https://github.com/vishvananda/card-glint/pull/8) is included. This integration does not track subsequent upstream `main` commits or assume an npm-registry publication.

```text
https://github.com/vishvananda/card-glint/releases/download/v0.6.0/card-glint-0.6.0.tgz
SHA-256: ee095fa330c36eefaf1ccc0eaab6a5ae5efad979fb7cfb9d45229bf950302830
```

`package.json`, `yarn.lock`, the finish-resource revision and offline asset-cache namespace use this version. Public SDK entry points remain the integration boundary; no local SDK patches or source build are required.

## Implemented changes

| Area                      | Integration                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Battle geometry           | `cardRenderGeometry.ts` consumes `battleReverseStatsLayout` as a separate reminder region. Rules clipping, scrolling, exclusions and hit targets protect it. Native ink supplies reverse-creature P/T; the host does not repaint it or treat it as current defense.                                    |
| Historical printings      | Card Mock includes exact Alpha/Beta fixtures for Cyclopean Tomb, Orcish Artillery, Orcish Oriflamme and Drain Life, with Original/Oracle wording selection. Gameplay retains Oracle characteristics. Experimental calibration is not enabled by default.                                               |
| Saved print-dot exclusion | `printDots.artwork: false` survives canonical Rust/Java/TypeScript cosmetics, editor drafts, grouping, previews and structured deck data. Customizer and Card Mock controls pass selected artwork windows to native, DOM and Pixi preparation.                                                         |
| Native R8 masks           | `cardFinishResources.ts` uploads owned `documentMaskData` bytes as linear `r8unorm`, using red-channel sampling, bottom-up orientation and unpack alignment 1. There is no mask Canvas snapshot or JavaScript row flip. Finish coverage remains separate.                                              |
| Raster ownership          | `CardRaster` accepts Canvas or ImageBitmap. Cache, visible textures, DOM metadata copies and live-ink consumers hold independent references. Eviction cannot close a visible bitmap; the final release closes it.                                                                                      |
| Size tiers                | Table/native/inspect composition uses 244/488/732px widths, tier-aware keys and matching optical/live-ink dimensions. Projected size and device density select the tier with hysteresis; flipping cannot trigger a temporary demotion. Base-face mipmaps are generated once per static upload.         |
| Worker painting           | One lazily started bounded worker paints native and host-semantic faces, including live-ink resources. Immutable inputs and worker-local fonts replace DOM dependencies. Eligible Pixi faces arrive as transferable bitmaps without a full-face main-thread Canvas copy.                               |
| Lighting                  | Card Mock exposes pointer-compatible/studio lighting and yaw/pitch. Native and Pixi share world-Y-up pose normals. Pointer-compatible remains the product default; lighting is transient renderer state, not saved cosmetics or raster identity.                                                       |
| Material batching         | Public host sampling supplies ordered texture-array batches. Compatible native material inputs are shared uniforms; transforms, UVs, normals, wear, clipping and layer IDs remain instance data. Different shared state creates boundaries. Singleton instructions use the existing per-card path.     |
| Profiling                 | The existing Card Mock profiler reports composition, queueing, raster ownership/copies, resource residency, static versus Pool uploads, native submissions, Pixi batches, DOM copies and session long tasks. Optional bounded elapsed queries report valid GPU samples separately from CPU submission. |

### Printing semantics

Omission includes artwork; explicit `true` canonicalizes to omission; explicit `false` is retained. Zero amount removes the dots object. Manabrew still requires an amount and keeps omitted period 5, rather than adopting the SDK's empty-profile amount/period defaults.

Periods are fixed **732px reference pixels**. Keep the configured value unchanged across tiers; the SDK converts to face texels. Original low-resolution scans can therefore differ from the old source-pixel-period behavior. No per-resolution saved-data migration is added.

Exclusion follows known recipe artwork windows, including Room/split windows and host-semantic layouts. An original scan without separate frame/printing provenance cannot promise the same selective treatment as a generated recipe; the integration does not guess an aperture from pixels.

### Worker and resource boundaries

- `cardComposition.ts` captures the worker-safe composition contract. `cardCompositionWorker.ts` owns dispatch, cancellation and fatal-worker recovery; `workers/cardRender.worker.ts` owns painting and transferred outputs.
- Queue priority and deduplication remain shared across callers. Removing the final consumer cancels the work. Late or stale outputs close before publication. A fatal worker error rejects the current request; the next independent request can initialize a new worker without an automatic retry.
- The existing platform/offline resolver supplies raw assets. The SDK's SVG and historical-symbol decoders need DOM facilities, so the main thread performs those public image hooks and transfers owned bitmap clones. Raw SVG responses stay unchanged. Ordinary artwork decoding and full-face composition remain worker-side.
- Worker decoded-image and host scratch caches are bounded. Unsupported Worker/Canvas/font capabilities select the main-thread backend. Real asset/composition errors are not converted into success.
- DOM presentation or native image-document encoding may need a real Canvas copy. Those copies are counted; the original raster stays leased while copied optical/live-ink metadata depends on it.
- Native inspector document preparation and finish-resource derivation remain distinct from worker color-face composition. A zero main-thread color-composition counter does not mean the browser performs no main-thread preparation.

### Material residency and GPU state

Prepared printing has a **32 MiB** budget including mipmaps. Referenced entries stay resident, idle entries may be evicted, and unchanged overflow decisions use the public procedural shader rather than repeatedly rebuilding a map. Ordinary/cached and procedural programs remain separate. Overflow never silently drops dots or artwork exclusion.

Texture-array pages have a separate **64 MiB** allocated-page budget including unused layers and mip levels. Pages are keyed by dimensions, format, alpha and sampling policy. Native masks remain R8. Shader capability limits and unsupported sources retain the per-card fallback.

The batcher does not sort cards or cross rules, live-ink, focus, target or other Pixi instruction boundaries. Shared material state, including finish, pointer and artwork bounds, must match before cards share a draw. Separate DOM output canvases remain separate renders/copies; they are not advertised as a single board batch.

WebGL array uploads require premultiplication to be disabled. Sources needing upload-time premultiplication first use Pixi's correct 2D upload, then a GPU framebuffer copy into the array. Raw bitmap/R8/prepared data uploads retain their explicit conventions. The uploader restores Pixi's texture-state cache, alignment/alpha assumptions and read-framebuffer binding. Cached batch shaders detach transient resources after drawing, before those resources can be destroyed.

GPU profiling is opt-in while the Card Mock profiler is mounted. Each owned timer reuses at most eight queries, polls only available results asynchronously, discards disjoint/cancelled samples and releases queries on context loss or teardown. Ordinary gameplay does not poll timer queries. GPU elapsed pass time, CPU submission, browser presentation latency and FPS are different measurements.

## Compatibility and rollout

This cosmetic field is a **breaking wire change**, despite being optional. Old Rust readers use `deny_unknown_fields`; old Java hosts have a closed key allowlist. Old frontend normalizers also cannot preserve exclusion. Do not strip the field or promise mixed-version deck editing.

Use a breaking Conventional Commit/merge title for release. `xtask/src/workspace.rs` now includes the canonical foundation cosmetics source in both `manabrew-protocol` and `manabrew-relay-protocol` release inputs, rather than relying on dependency patch cascades. The relay compatibility number follows its crate major; do not hand-maintain another constant or hand-bump release manifests.

Ship the updated Hub/relay/node/desktop readers, generated bindings, Rust WASM, harness and Forge Web Image together before using the new writers. New readers accept legacy decks without migration. Unreleased worktrees still carry the current release's compatibility number and must not exchange exclusion-bearing data with installed old readers. A relay-major boundary does not make old account-deck editors preserve an unknown cosmetic field; update those clients too.

Structured local/account/publication/game payloads use the same canonical cosmetics type. Plain-text Arena/MTGO/printing exports do not carry cosmetics. Wear seeds, physical-copy IDs and hidden-card disclosure rules are unchanged.

Regenerated TypeScript/Java/protocol documentation and rebuilt Rust WASM, harness and Forge Web Image accompany the schema change. This is no longer a JavaScript-only dependency upgrade. Restart an already-running development web container after the lockfile change so its separate dependency volume installs 0.6.0. Rebuild/restart backend consumers after the foundation wire change as well.

## Runtime verification

Verification did not take screenshots, inspect pixel buffers or compare images. Generated fixture artwork exercised real production modules and external SDK fonts/frame/symbol resources.

Nonvisual Chromium scenarios ran against both Vite modules and the built production entry, including an Apple M4 Pro Metal WebGL2 context and SwiftShader coverage:

- Normal, Room, Battle front/reverse, Prototype, planar, scheme and Vanguard across all three tiers; matching optical dimensions, live ink, face ownership and separate Battle reminder/defense geometry.
- Default/custom physical print periods; artwork exclusion/inclusion normalization; editor drafts, physical-copy repair, grouping, preview conversion and structured deck snapshots. Text exports retained their existing non-cosmetic contract.
- Shared in-flight composition, queued/dispatched cancellation, recovery after cancellation, cache pressure from 128 additional faces, visible raster/texture survival through eviction, and final release to zero live rasters.
- Cached/procedural printing under held-lease pressure, all ten finish modes, actual dirty instance-row uploads, odd-width R8 arrays, premultiplied Pixi uploads after raw arrays, explicit overlay boundaries and GPU-state checks.
- Distinct finish/pointer profiles retained their actual GPU uniforms; singleton fallback retained its card transform. These checks did not inspect pixels.
- Pixi and native inspector context loss/restoration resumed real draws. DOM output/source-upload counters remained separate; cleanup returned material leases, texture-array pages, DOM outputs and pending timer queries to zero.
- Native gloss/rain/heat/pool studio and pointer pose changes produced six submissions each with zero document upserts, document preparations or static texture uploads during the measured pose phase.
- A real one-time worker script failure rejected the first request. Without a cache clear or retry between requests, the second independent render created another worker and returned a 244×340 bitmap.
- Production requests loaded the emitted hashed worker, worker pixel WASM and co-located SDK renderer WASM rather than relying on development URLs.
- Disabling the profiling lease produced zero `beginQuery`, `endQuery`, `getQuery` and `getQueryParameter` calls while the full material scenario still passed. Browsers without Worker capability completed the same inspection-size workload through the main-thread backend.

### Comparable footprint and draw counts

The eight-card workload keeps the same 244×340 projected card slots. Initial integration composed inspection-size sources; the adaptive table path paints at its requested size.

| Metric                        | Initial integration | Adaptive/compatible batch path |
| ----------------------------- | ------------------: | -----------------------------: |
| Raster width                  |               732px |                          244px |
| Eight retained color rasters  |    23,892,480 bytes |                2,654,720 bytes |
| Material draws per frame      |                   8 |                              2 |
| Warm static uploads           |                   0 |                              0 |
| Warm shader compilations      |                   0 |                              0 |
| Warm uniform-location lookups |                   0 |                              0 |

These are raster payload and controlled material-pass counts, not whole-process memory or a live-game FPS result. Prepared printing pressure retained approximately 31.85 MB below its 33,554,432-byte cap, with unchanged overflow faces remaining procedural. A 244×340 native R8 mask accounted for exactly 82,960 bytes.

### Warm hardware sample

The final production bundle ran the same eight-card table workload on Chromium/ANGLE Metal, Apple M4 Pro. The comparison deliberately selected the existing capability fallback for the per-card run, without changing material inputs or projected size. Both runs collected ten valid, non-disjoint warm GPU samples.

| Measurement                    | Per-card fallback | Compatible instancing |
| ------------------------------ | ----------------: | --------------------: |
| Median CPU submission          |          0.335 ms |              0.233 ms |
| Mean elapsed GPU material pass |          0.605 ms |              0.596 ms |

This is one short controlled sample, not a statistical FPS result. The GPU times are effectively comparable at this scale; the reproducible gains are the lower draw count and adaptive raster footprint.

Fewer draws do not guarantee faster GPU execution. Profiling found a higher cost in the first all-varying batch implementation; common native material state was moved to uniforms, per-instance rows were reduced and singleton passes now bypass instancing. Hardware timings must retain their device, workload, valid-sample count and CPU/GPU distinction. Visual fidelity, animation smoothness, authenticated Hub flows and a live mixed-version network rollout were not verified by these scenarios.

## Build and regression checks

- `yarn tsc -b`: passed.
- Scoped ESLint over changed non-generated TypeScript/TSX and Prettier checks: passed.
- Production Vite build using the real app configuration plus a throwaway runtime entry: passed. The build retained existing large-chunk, mixed static/dynamic import and Node module-registration warnings.
- Rust checks passed for `forge-foundation`, `manabrew-protocol`, `manabrew-relay-protocol`, `manabrew-server`, `manabrew-hub` and `xtask`.
- `yarn ensure:wasm` and `yarn build:forge-wasm`: passed, including the harness build and Web Image staging. Existing Rust unused-import warnings were not changed.
- Throwaway Rust and Java runtime codecs passed legacy/default/explicit-exclusion/zero-amount/invalid-type normalization and round trips.
- The 197 existing frontend regressions passed without adding permanent tests or changing test expectations. On local Node 26, `--no-experimental-webstorage` avoids an unrelated jsdom/global-storage collision; `useCards.locale.test.ts` needs its browser environment selected explicitly because the existing file lacks an environment annotation. The reproducible stock-runner commands are:

```sh
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --exclude src/hooks/useCards.locale.test.ts
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/hooks/useCards.locale.test.ts --environment jsdom
```

Temporary scenario sources, the extra build entry and owned verification servers are removed after measurement. Scoped agent guides document the permanent ownership, worker, material and release contracts.

## Sources

- [0.5.3: print-dot defaults, artwork exclusion and Alpha typography](https://github.com/vishvananda/card-glint/blob/v0.5.3/docs/releases/0.5.3.md)
- [0.5.4: Alpha/Beta review and historical costs](https://github.com/vishvananda/card-glint/blob/v0.5.4/docs/releases/0.5.4.md)
- [0.5.5: Alpha printed-cost corrections](https://github.com/vishvananda/card-glint/blob/v0.5.5/docs/releases/0.5.5.md)
- [0.6.0 release notes](https://github.com/vishvananda/card-glint/blob/v0.6.0/docs/releases/0.6.0.md)
- [0.6.0 host integration guide](https://github.com/vishvananda/card-glint/blob/v0.6.0/docs/host-integration.md)
- [0.6.0 performance guide and measurement limits](https://github.com/vishvananda/card-glint/blob/v0.6.0/docs/performance.md)
- [Full comparison: 0.5.2 to 0.6.0](https://github.com/vishvananda/card-glint/compare/v0.5.2...v0.6.0)
