// Immutable compatibility corpus and reference implementation. Updating either
// revision requires rerunning mse-audit; metadata/script parsing is not proof
// of runtime or visual parity.
export default Object.freeze({
  repository: 'MagicSetEditorPacks/Full-Magic-Pack',
  revision: '16f1d13bb7f5924613fc1ddc25da582beccfefb6',
  referenceImplementation: Object.freeze({
    repository: 'CajunAvenger/MagicSetEditor2',
    revision: '05ea3bfb372cfa8bdac6c8de48a4920d9991c996',
    version: '2.6.4',
  }),
  legacyReferenceImplementation: Object.freeze({
    repository: 'twanvl/MagicSetEditor2',
    revision: 'f9d9356d51f28210ccf0c0dda508502f222e1def',
  }),
});
