# Publishing @manabrew/forge-wasm

Releases are built from the Manabrew repository by `.github/workflows/publish-forge-wasm.yml`.

## npm setup

Configure an npm trusted publisher for `@manabrew/forge-wasm` with:

- organisation or user: `witchesofthehill`
- repository: `manabrew`
- workflow: `publish-forge-wasm.yml`
- environment: none

The first publication may require a maintainer to create the package manually before the trusted publisher can be attached.

## Release

1. Update the version in `package.json`. It is the only place the version is
   written by hand; the build stamps `VERSION` in `forge.js` from it and
   verification fails if the two disagree.
2. Build and verify locally with the Oracle GraalVM Web Image and Binaryen toolchains available:

   ```sh
   yarn build:forge-wasm-package
   yarn verify:forge-wasm-package
   ```

3. Merge the version change to `main`.
4. Tag that commit with the matching package version and push the tag:

   ```sh
   git tag forge-wasm-v0.1.0
   git push origin forge-wasm-v0.1.0
   ```

The workflow rejects a tag whose version differs from the package manifest. npm publication uses GitHub OIDC and provenance; no long-lived npm token is required.
