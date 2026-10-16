import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, chmod, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = path.join(root, "packages/card-glint");
const cache = path.join(root, "node_modules/.cache/card-glint");
const output = path.join(packageRoot, "dist");
const manifest = await readFile(path.join(packageRoot, "upstream.json"));
const upstream = JSON.parse(manifest);
const exists = (file) => access(file).then(() => true, () => false);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const patches = [];
for (const name of (await readdir(path.join(packageRoot, "patches"))).filter((name) => name.endsWith(".patch")).sort()) {
  patches.push({ name, bytes: await readFile(path.join(packageRoot, "patches", name)) });
}
const buildHash = createHash("sha256").update(manifest)
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(path.join(root, "scripts/bundle-card-glint.mjs")))
  .update(await readFile(path.join(packageRoot, "package.json")));
for (const patch of patches) buildHash.update(patch.name).update(patch.bytes);
const key = buildHash.digest("hex");
const completed = await readFile(path.join(output, "provenance.json"), "utf8").then(JSON.parse, () => null);
const required = [
  "lib/browser.js", "lib/magic.js", "lib/magic-presentation.js", "lib/magic.css",
  "lib/finish.js", "lib/kernels.js", "lib/renderer_bg.wasm", "lib/pixels_bg.wasm",
  "types/games/magic/src/presentation.d.ts", "types/packages/browser/src/finish.d.ts",
  "types/packages/browser/src/kernels.d.ts", "types/packages/browser/src/index.d.ts",
  "types/games/magic/src/index.d.ts",
  "types/packages/browser/generated/renderer.d.ts",
  "types/packages/browser/generated/pixels.d.ts",
];
if (completed?.buildHash === key && completed.files?.length &&
    (await Promise.all([...required, ...completed.files].map((file) => exists(path.join(output, file))))).every(Boolean)) {
  process.exit(0);
}

await mkdir(cache, { recursive: true });
const archive = path.join(cache, `${upstream.revision}.tar.gz`);
if (!await exists(archive)) {
  const response = await fetch(upstream.archive);
  if (!response.ok) throw new Error(`Card Glint download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== upstream.sha256) throw new Error("Card Glint source archive checksum mismatch");
  await writeFile(archive, bytes);
}
if (hash(await readFile(archive)) !== upstream.sha256) throw new Error(`Card Glint cached source checksum mismatch: ${archive}`);
const source = path.join(cache, `source-${key}`);
await rm(source, { recursive: true, force: true });
await mkdir(source, { recursive: true });
const run = (command, args, env = process.env) => execFileSync(command, args, {
  cwd: source,
  env,
  stdio: "inherit",
  shell: process.platform === "win32" && command.endsWith(".cmd"),
});
run("tar", ["-xzf", archive, "--strip-components=1", "-C", source]);
for (const patch of patches) {
  run("git", ["apply", "--no-index", path.join(packageRoot, "patches", patch.name)], {
    ...process.env,
    GIT_CEILING_DIRECTORIES: cache,
  });
}
const cargoLock = await readFile(path.join(source, "Cargo.lock"), "utf8");
if (!cargoLock.includes(`name = "wasm-bindgen"\nversion = "${upstream.wasmBindgen}"`)) {
  throw new Error("Card Glint wasm-bindgen pin does not match Cargo.lock");
}
run("rustup", ["toolchain", "install", upstream.rust, "--profile", "minimal", "--target", "wasm32-unknown-unknown"]);
const toolRoot = path.join(cache, "tools", `${upstream.rust}-${upstream.wasmBindgen}`);
const bindgen = path.join(toolRoot, "bin", process.platform === "win32" ? "wasm-bindgen.exe" : "wasm-bindgen");
const env = { ...process.env, RUSTUP_TOOLCHAIN: upstream.rust, PATH: `${path.join(toolRoot, "bin")}${path.delimiter}${process.env.PATH}` };
if (!await exists(bindgen)) {
  run("cargo", ["install", "wasm-bindgen-cli", "--version", upstream.wasmBindgen, "--locked", "--root", toolRoot], env);
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
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], env);
run(process.execPath, ["scripts/build-wasm.mjs"], env);
run(process.execPath, [path.join(root, "scripts/bundle-card-glint.mjs")], env);
const staged = path.join(packageRoot, ".dist-staging");
await rm(staged, { recursive: true, force: true });
await cp(path.join(source, "dist"), staged, { recursive: true });
for (const file of required) {
  if (!await exists(path.join(staged, file))) throw new Error(`Card Glint build missing ${file}`);
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
console.log(`[card-glint] Ready: ${upstream.revision}`);
