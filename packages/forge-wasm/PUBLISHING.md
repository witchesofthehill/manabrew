# Publishing @manabrew/forge-wasm

Releases are built from the Manabrew repository by `.github/workflows/publish-forge-wasm.yml`.

## npm setup

Publication uses the repository's `NPM_TOKEN` secret, the same one that publishes
`@manabrew/protocol`. `@manabrew` is a user scope, so only its owner can create a
package in it; a collaborator's own token is rejected with a 404 on the first
publish.

Once the package exists, an npm trusted publisher can replace the token:
organisation `witchesofthehill`, repository `manabrew`, workflow
`publish-forge-wasm.yml`, no environment. Drop `NODE_AUTH_TOKEN` from the publish
step when that is configured.

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

The workflow rejects a tag whose version differs from the package manifest, and skips a version already on npm. Publication is signed with GitHub OIDC provenance.
