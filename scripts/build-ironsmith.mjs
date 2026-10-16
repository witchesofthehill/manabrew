import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = path.join(root, "packages/ironsmith-wasm");
const cache = path.join(root, "node_modules/.cache/ironsmith");
const output = path.join(packageRoot, "dist");
const manifest = await readFile(path.join(packageRoot, "upstream.json"));
const upstream = JSON.parse(manifest);
const exists = (file) => access(file).then(() => true, () => false);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const patches = await Promise.all(upstream.patches.map(async (name) => ({
  name,
  bytes: await readFile(path.join(packageRoot, name)),
})));
const buildHash = createHash("sha256").update(manifest)
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(path.join(packageRoot, "package.json")));
for (const patch of patches) buildHash.update(patch.name).update(patch.bytes);
const key = buildHash.digest("hex");
const completed = await readFile(path.join(output, "provenance.json"), "utf8").then(JSON.parse, () => null);
const required = ["ironsmith.js", "ironsmith_bg.wasm", "ironsmith.d.ts", "ironsmith_bg.wasm.d.ts"];
if (completed?.buildHash === key && completed.files?.length &&
    (await Promise.all([...required, ...completed.files].map((file) => exists(path.join(output, file))))).every(Boolean)) {
  process.exit(0);
}

await mkdir(cache, { recursive: true });
const archive = path.join(cache, `${upstream.commit}.tar.gz`);
if (!await exists(archive)) {
  const response = await fetch(upstream.archiveUrl);
  if (!response.ok) throw new Error(`Ironsmith source download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== upstream.archiveSha256) throw new Error("Ironsmith source archive checksum mismatch");
  await writeFile(archive, bytes);
}
if (hash(await readFile(archive)) !== upstream.archiveSha256) {
  throw new Error(`Ironsmith cached source checksum mismatch: ${archive}`);
}
const source = path.join(cache, `source-${key}`);
await rm(source, { recursive: true, force: true });
await mkdir(source, { recursive: true });
const run = (command, args, env = process.env) => execFileSync(command, args, {
  cwd: source,
  env,
  stdio: "inherit",
});
run("tar", ["-xzf", archive, "--strip-components=1", "-C", source]);
for (const patch of patches) {
  run("git", ["apply", "--no-index", path.join(packageRoot, patch.name)], {
    ...process.env,
    GIT_CEILING_DIRECTORIES: cache,
  });
}
run("rustup", ["toolchain", "install", upstream.rust, "--profile", "minimal", "--target", "wasm32-unknown-unknown"]);
const toolRoot = path.join(cache, "tools", `${upstream.rust}-${upstream.wasmPack}`);
const wasmPack = path.join(toolRoot, "bin", process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack");
const env = {
  ...process.env,
  RUSTUP_TOOLCHAIN: upstream.rust,
  CARGO_TARGET_DIR: path.join(cache, "cargo-target"),
  PATH: `${path.join(toolRoot, "bin")}${path.delimiter}${process.env.PATH}`,
};
if (!await exists(wasmPack)) {
  run("cargo", ["install", "wasm-pack", "--version", upstream.wasmPack, "--locked", "--root", toolRoot], env);
}
if (process.platform === "darwin") {
  const capture = (args) => execFileSync("rustc", args, { cwd: source, env, encoding: "utf8" }).trim();
  const sysroot = capture(["--print", "sysroot"]);
  const host = capture(["-vV"]).match(/^host: (.+)$/m)[1];
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const linker = path.join(cache, "wasm-linker.sh");
  await writeFile(linker, `#!/bin/sh\nexport DYLD_LIBRARY_PATH=${quote(path.join(sysroot, "lib"))}\nexec ${quote(path.join(sysroot, "lib/rustlib", host, "bin/rust-lld"))} "$@"\n`);
  await chmod(linker, 0o755);
  env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER = linker;
}
const staged = path.join(packageRoot, ".dist-staging");
run(process.execPath, ["scripts/build-npm-package.mjs", "--out-dir", staged, "--expected-version", upstream.npmVersion], env);
for (const file of required) {
  if (!await exists(path.join(staged, file))) throw new Error(`Ironsmith build missing ${file}`);
}
const files = (await readdir(staged, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(staged, path.join(entry.parentPath, entry.name)))
  .sort();
await writeFile(path.join(staged, "provenance.json"), JSON.stringify({
  ...upstream,
  buildHash: key,
  files,
  patches: patches.map(({ name, bytes }) => ({ name, sha256: hash(bytes) })),
}, null, 2) + "\n");
await rm(output, { recursive: true, force: true });
await rename(staged, output);
console.log(`[ironsmith] Ready: ${upstream.commit}`);
