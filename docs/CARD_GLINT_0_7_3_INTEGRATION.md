# Card Glint 0.7.3 integration report

## Scope

Audited the released changes from 0.6.12 through 0.7.3 and integrated the missing calibration controls, saved data, compatibility checks and reporting. The application still installs the official 0.7.3 release tarball. No fork, private SDK import or unpublished API is required.

UI acceptance is manual. No application UI was launched, interacted with, captured or visually verified for this change.

## Released change coverage

| Release area                                       | Application support                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.7.0 ordinary Eighth-family baseline              | The installed SDK supplies `8ed-eighth`, separate white/black surrounds, exact-component precedence, corrected geometry, headings, mana, land materials, credits and text fitting. Customize now exposes the compatible named profile and reports inherited defaults. |
| 0.7.0 recipient identity and dedicated layouts     | Preset resolution keeps printing content separate from calibration. The UI queries the resolved face, not just its set code. Dedicated and incompatible layouts do not silently become Eighth frames.                                                                 |
| 0.7.0 lazy donor loading                           | This is SDK behavior for lazy-entry consumers. Manabrew currently imports the eager Magic entry, including through its composition dependencies, so it does not need another preparation layer or donor downloader.                                                   |
| 0.7.1 Alpha/Beta/Unlimited corrections             | SDK painters and reviewed printing data supply fractional Original-text fitting, row guards, dual-land perimeter/paper/art corrections and reviewed wording/artist fixes. The existing Original/Oracle adapter remains the integration point.                         |
| 0.7.2 explicit Eighth profile selection            | Saved `8ed-eighth` selections now reach the released preset resolver. Compatibility uses the selected frame family; modern, retro, colorshifted and dedicated-layout rejections remain visible.                                                                       |
| 0.7.3 Matrix heading baseline                      | Native SDK composition supplies the alphabetic-baseline correction for title/type text. There is no host offset or font-size workaround.                                                                                                                              |
| Audit tools, calibration studies and documentation | No application runtime integration is needed. The application does not expose the SDK's calibration-authoring laboratory or certify a printing from an audit score.                                                                                                   |

The three policy choices and M21 reporting APIs already existed in 0.6.12. This change exposes them in Manabrew alongside the newly released Eighth profile rather than claiming they are new SDK APIs.

Upstream references: [release comparison](https://github.com/vishvananda/card-glint/compare/v0.6.12...v0.7.3), [0.7.0](https://github.com/vishvananda/card-glint/blob/v0.7.3/docs/releases/0.7.0.md), [0.7.1](https://github.com/vishvananda/card-glint/blob/v0.7.3/docs/releases/0.7.1.md), [0.7.2](https://github.com/vishvananda/card-glint/blob/v0.7.3/docs/releases/0.7.2.md), [0.7.3](https://github.com/vishvananda/card-glint/blob/v0.7.3/docs/releases/0.7.3.md).

## Application changes

### Customize

The existing card customizer now includes Printing calibration:

- Existing/default behavior removes the card-level calibration override. It does not opt existing cards into Automatic.
- Automatic allows compatible material defaults to fill gaps.
- Exact printing uses exact-set calibration profiles only.
- Source colors keeps the selected layout and typography while retaining source colors.
- Modern · M21 defaults and Eighth · 8ED defaults are enabled only where the SDK reports compatibility.
- Face controls inherit the card setting or retain an explicit independent choice. Clearing a face choice reveals the parent choice.

The customizer prepares the selected native face without composing pixels. SDK coverage lists frame, text box, border, interior ink and mana-symbol status, available profile/revision information, inherited defaults and notices. Measured, source, fallback and mixed statuses are descriptive SDK results, not physical-color certification.

An exact 8ED fit can report `printing:8ed` without inherited defaults; that is expected. A compatible donor-backed printing can instead report inherited `8ed-eighth` defaults. The installed named profiles report M21 revision 16 and Eighth revision 1; the UI displays SDK results rather than assigning an accuracy percentage.

An incompatible current choice remains editable. Changing frame or physical printing can invalidate a named profile; Save stays disabled until the explicit calibration is compatible or cleared. Loading and stale asynchronous results are keyed by the card and locale. An unavailable report with no explicit calibration does not prevent existing finish/wear edits.

Host-semantic and scan-backed compositors retain their existing limitations. They cannot accept explicit calibration overrides. Dedicated native layouts use the SDK's own compatibility result.

### Saved data and rendering

`CardPrintingOverrides.calibration` is a closed application wire enum:

```ts
type CardPrintingCalibration = "auto" | "printing" | "source" | "m21-modern" | "8ed-eighth";
```

For example, a saved cosmetic selection can use:

```json
{
  "printing": {
    "version": 1,
    "preset": "8ed",
    "overrides": { "calibration": "8ed-eighth" },
    "faces": [{}, { "overrides": { "calibration": "source" } }]
  }
}
```

The application stores named profiles as strings. Its SDK adapter converts them to `{ "profile": "8ed-eighth" }` or `{ "profile": "m21-modern" }`. Application JSON should use the wire enum, not the SDK object shape.

Frontend normalization, Rust serde/ts-rs types and the Java cosmetics validator preserve the field. Rust and Java reject unknown values. Explicit per-face choices are not normalized away. Existing selections without the field retain legacy behavior and selection version 1.

The selected calibration reaches the shared native-face adapter used by the inspector and production composition. Captured input and resolved-face cache identities already serialize the full appearance, so calibration changes separate cached work without a second renderer-specific field. Workers receive the resolved face through the existing composition contract. DOM/Pixi hosts and exports continue to consume that shared result; their visual output is part of the manual checklist below.

The SDK upgrade also changes the offline asset-cache and finish-cache revisions to 0.7.3. Matching SDK JavaScript/WASM and license notices are emitted by Vite. Both browser engine artifacts were rebuilt after the closed cosmetic schema changed.

### Multiplayer compatibility

Relays built from this source advertise `card_cosmetics_v3` alongside earlier capabilities. The web transport requires v3 for any normalized global or per-face calibration choice in Main, Sideboard, Maybeboard, commanders, companion, tokens, planes, schemes, attractions or contraptions.

Older relays are rejected locally with an update-server error. Saved customization is not stripped to make a deck compatible. Decks without explicit calibration keep their previous capability requirements.

This extends closed Rust/Java objects. Release it through the existing breaking protocol release process and update relay, node/Tauri runtime, harness and browser clients together. This work does not change release versions or complete the user's pending merge. A newer relay alone cannot upgrade an older engine codec.

At final environment inspection, the running development stack belonged to `/Users/fede/Documents/Projects/manabrew2`, not this checkout. It was left untouched. Test this checkout's build or switch stack ownership deliberately before expecting these changes at the shared development URL.

## Verification performed

| Check                                           | Result                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn gen:types` and `yarn gen:protocol-docs`   | Passed; generated TypeScript, Java dependency inputs and committed protocol documentation include the enum/field.                                      |
| `yarn tsc -b`                                   | Passed.                                                                                                                                                |
| ESLint on the changed TypeScript/React files    | Passed.                                                                                                                                                |
| `yarn vite build`                               | Passed; includes rebuilt Rust/Forge browser engines and matching Card Glint renderer WASM.                                                             |
| `yarn build:harness`                            | Passed; rebuilt and staged the Java consumer/runtime.                                                                                                  |
| `yarn ensure:wasm`                              | Passed; rebuilt the Rust browser engine and refreshed its build stamp.                                                                                 |
| `yarn build:forge-wasm`                         | Passed; rebuilt and staged the actual GraalVM Web Image, not a stub.                                                                                   |
| `bash forge-harness/build-native.sh`            | Passed; rebuilt and signed the macOS arm64 Forge library with the generated enum's reflection metadata.                                                |
| Rebuilt native-library C ABI diagnostic         | Passed five valid game-start cosmetic decodes, six invalid-value rejections and legacy omission before the initialization guard. No game was launched. |
| Native-input diagnostic                         | Passed all five choices, legacy omission, explicit face precedence, split-panel policies, named-profile rejection and host-compositor rejection.       |
| Rust and Java codec executables                 | Each passed five global/per-face round trips, six invalid-value rejections and the legacy omission case.                                               |
| Draft/preparation diagnostic                    | Passed draft isolation, named profile selection, per-face inheritance/clearing, captured-input separation and recovery after a frame change.           |
| Client capability diagnostic                    | Passed 20 global/per-face paths across all 10 deck sections, v2 rejection, v3 wire preservation, saved-deck immutability and legacy compatibility.     |
| Markdown formatting and `yarn check:docs-drift` | Passed; protocol documentation matches source.                                                                                                         |

The draft and client diagnostics ran in Node with static asset URLs and unused interface catalogs substituted for bundler dependencies. They exercised the application data paths without DOM, Canvas or GPU rendering. The capability diagnostic captured the transport boundary; it was not a live multiplayer game. Temporary diagnostic sources and outputs are removed after verification. No permanent unit tests were added.

Build warnings remain for mixed static/dynamic imports and large chunks. The Rust browser build also reports the existing unused `SystemTime`/`UNIX_EPOCH` imports in `game_log_event.rs`. Maven/GraalVM emit dependency/toolchain warnings but completed successfully.

## Manual acceptance checklist

### 1. Eighth and modern profiles

- [ ] Open a normal Eighth Edition printing in the deck editor and choose Customize. Keep the printing frame, select Eighth · 8ED defaults, and inspect the SDK coverage details.
- [ ] Check both black and white surrounds, a colored spell, a basic land, City of Brass and a two-color land. Confirm title/type placement, mana, collector line and artist text remain inside their native regions.
- [ ] Choose an ordinary Eighth-family receiving set such as Ninth Edition. Check the inherited-default notice and confirm the recipient's expansion symbol and printing metadata do not become Eighth Edition's.
- [ ] Repeat with a compatible modern printing and Modern · M21 defaults. Switch between Automatic, Exact printing and Source colors. Source colors must not change the selected frame layout, text or card identity.
- [ ] Check Matrix titles/type lines on macOS and Linux, and Windows if available. Compare equivalent cards and wording; no platform-specific downward heading shift should remain.

### 2. Inheritance and invalid combinations

- [ ] Set a card policy, then override its face policy. Changing the card policy must not replace the explicit face choice. Inherit card setting must restore the parent policy.
- [ ] Repeat with both physical sides of a double-faced card and both panels of a split card, using the policies the SDK permits. Verify front/back controls and panels keep their independent choices.
- [ ] Select Eighth defaults, then switch to a modern or retro frame/printing. The incompatible state must explain the problem and prevent Save until cleared or replaced.
- [ ] Check colorshifted Planar Chaos, Futureshifted and dedicated layouts. Incompatible named profiles must remain disabled, not silently choose a different frame.
- [ ] Check a host-semantic or scan-backed card. Explicit calibration must be unavailable, but Existing/default behavior must still allow the previously supported finish/wear customization.
- [ ] With no explicit calibration, check a card whose coverage metadata is unavailable, for example while offline. Reporting failure must not newly block otherwise valid finish/wear edits.
- [ ] Switch printings and locale quickly while compatibility loads. A late report from the previous printing must not enable an invalid Save.

### 3. Save, reset and exact-copy behavior

- [ ] Customize one of two identical physical copies. Save and reopen; only that occurrence should carry the new setting.
- [ ] Make several calibration changes and Cancel. No saved appearance should change.
- [ ] Use Reset to printing. Calibration and other appearance overrides should clear while the selected physical printing remains.
- [ ] Save, fully reload the application, and reopen the card. Check global and per-face values, finish/foil, border and wear.
- [ ] Undo and redo a saved calibration edit. Each step must restore its global/per-face choices together with the corresponding appearance.
- [ ] Export and reimport the application's structured deck JSON, and round-trip an account-backed deck if used. Plain-text deck formats do not carry cosmetics.
- [ ] Check a deck-specific token appearance. Other token types and other copies must remain unchanged.

### 4. Rendering and historical text

- [ ] Compare the customizer's generated preview with deck thumbnails, DOM previews and the Pixi game board/hover preview. Switch calibration back and forth to catch stale face/finish caches.
- [ ] Check a PNG/export path with calibration and a foil or animated finish. Layout and protected lettering should match the generated preview.
- [ ] For an Original-wording fixture, compare Alpha/Beta/Unlimited examples such as Word of Command, Howl from Beyond, Stasis, Pearled Unicorn and Alpha Tropical Island. Check reviewed wording, attribution breaks and artist credit separately from Oracle rendering.
- [ ] Original wording is `cosmetics.wording: "original"` in saved data. The inspector's Original/generated button selects a source scan, not the wording policy. Gameplay must retain its existing Oracle/live-characteristic behavior.
- [ ] Test long Eighth names/type lines, dense rules text and basic-land glyphs at small and large display sizes.
- [ ] Populate generated-card offline resources for a customized saved deck, then repeat rendering with the permitted resources available offline. Verify no stale pre-upgrade cache is used.

### 5. Multiplayer and supported devices

- [ ] On an updated v3-capable relay and matching engine host, launch a game with calibrated cards and a token override. Check visible hand, battlefield and stack-source appearance, then reconnect/resync.
- [ ] Select a calibrated deck against a v2-only relay. Expect a local update-server error before submission; the saved deck must keep its calibration. An otherwise compatible uncalibrated deck should still work.
- [ ] Verify hidden cards do not reveal their cosmetic identity to other players. Check both browser-hosted Forge and the native/hosted engine paths used in deployment.
- [ ] Check keyboard selection, disabled-option explanations and per-face controls on a narrow/touch layout. Read-only decks must not become editable through the new controls.

## Limits retained upstream

Inherited calibration does not certify the receiving printing, and SDK reports do not calibrate a physical display. The release notes retain text-wrap, source-bevel/texture and land-symbol residuals. Experimental reconstructed Alpha frames and calibration-authoring tools are not imported into the application.

[Upstream GPU PR #12](https://github.com/vishvananda/card-glint/pull/12) remains separate from released 0.7.3. Native asynchronous mask readback, `FinishTextures.ready()` and context-local `FinishTextures.caustics(time)` are not consumed through private imports or casts. The previously implemented host graphics changes remain in place, but this report does not present them as newly released SDK features.
