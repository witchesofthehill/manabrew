import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const buildPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?-[a-f0-9]{40}-[a-z][a-z0-9-]{0,63}$/;
const store = path.resolve("target/faro-sourcemaps");
const run = (program, args, options = {}) =>
  execFileSync(program, args, { stdio: "inherit", ...options });
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const buildVariant = (buildId) => buildId.match(/-[a-f0-9]{40}-(.+)$/)?.[1];
const archiveMagic = Buffer.from("FAROMAPS1");
const mapPattern = /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.map$/;
const validMapName = (name) =>
  mapPattern.test(name) && !name.split("/").some((part) => part === "." || part === "..");

function artifactKey() {
  const material = process.env.FARO_MAPS_KEY;
  if (!material?.trim()) throw new Error("Missing FARO_MAPS_KEY");
  return createHash("sha256")
    .update("manabrew/faro-maps/aes-256-gcm/v1\0")
    .update(material)
    .digest();
}

function ensureDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink()))
      throw new Error(`Unsafe artifact directory: ${current}`);
    if (!entry) mkdirSync(current);
  }
}

function seal(output) {
  const key = artifactKey();
  ensureDirectory(store);
  const builds = readdirSync(store);
  if (!builds.length) throw new Error("No source maps to seal");
  for (const buildId of builds) validate(path.join(store, buildId), buildId);
  const contents = files(store).map((name) => ({
    name,
    data: readFileSync(path.join(store, name)),
  }));
  const index = Buffer.from(JSON.stringify(contents.map(({ name, data }) => [name, data.length])));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(index.length);
  const archive = gzipSync(Buffer.concat([length, index, ...contents.map(({ data }) => data)]));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(archiveMagic);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  ensureDirectory(path.dirname(output));
  writeFileSync(output, Buffer.concat([archiveMagic, iv, cipher.getAuthTag(), ciphertext]), {
    mode: 0o600,
    flag: "wx",
  });
}

function unseal(input) {
  const key = artifactKey();
  const encrypted = readFileSync(input);
  const headerLength = archiveMagic.length + 12 + 16;
  if (
    encrypted.length <= headerLength ||
    !encrypted.subarray(0, archiveMagic.length).equals(archiveMagic)
  )
    throw new Error("Invalid encrypted source map artifact");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    encrypted.subarray(archiveMagic.length, archiveMagic.length + 12),
  );
  decipher.setAAD(archiveMagic);
  decipher.setAuthTag(encrypted.subarray(archiveMagic.length + 12, headerLength));
  const compressed = Buffer.concat([
    decipher.update(encrypted.subarray(headerLength)),
    decipher.final(),
  ]);
  const archive = gunzipSync(compressed);
  if (archive.length < 4) throw new Error("Invalid source map archive");
  const indexEnd = 4 + archive.readUInt32BE(0);
  if (indexEnd > archive.length) throw new Error("Invalid source map archive index");
  const index = JSON.parse(archive.subarray(4, indexEnd).toString("utf8"));
  if (!Array.isArray(index) || !index.length) throw new Error("Empty source map archive");
  const names = new Set();
  const builds = new Set();
  let offset = indexEnd;
  const entries = index.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid archive entry");
    const [name, size] = entry;
    if (typeof name !== "string" || !Number.isSafeInteger(size) || size < 0)
      throw new Error("Invalid archive entry");
    const slash = name.indexOf("/");
    const buildId = name.slice(0, slash);
    const relative = name.slice(slash + 1);
    if (
      slash < 0 ||
      !buildPattern.test(buildId) ||
      (relative !== "manifest.json" && !validMapName(relative)) ||
      names.has(name.toLowerCase()) ||
      size > archive.length - offset
    )
      throw new Error(`Invalid archive path or size: ${name}`);
    names.add(name.toLowerCase());
    builds.add(buildId);
    const data = archive.subarray(offset, offset + size);
    offset += size;
    return { name, data };
  });
  if (offset !== archive.length) throw new Error("Unexpected source map archive data");
  ensureDirectory(store);
  const temporary = path.join(store, `.incoming-${randomUUID()}`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    for (const { name, data } of entries) {
      const destination = path.join(temporary, name);
      ensureDirectory(path.dirname(destination));
      writeFileSync(destination, data, { flag: "wx", mode: 0o600 });
    }
    for (const buildId of builds) {
      validate(path.join(temporary, buildId), buildId);
      const destination = path.join(store, buildId);
      if (!lstatSync(destination, { throwIfNoEntry: false })) continue;
      validate(destination, buildId);
      if (
        !readFileSync(path.join(destination, "manifest.json")).equals(
          readFileSync(path.join(temporary, buildId, "manifest.json")),
        )
      )
        throw new Error(`Immutable build changed: ${buildId}`);
    }
    for (const buildId of builds) {
      const destination = path.join(store, buildId);
      if (!lstatSync(destination, { throwIfNoEntry: false }))
        renameSync(path.join(temporary, buildId), destination);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function files(directory, relative = "") {
  const result = [];
  for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden: ${name}`);
    if (entry.isDirectory()) result.push(...files(directory, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unsupported map entry: ${name}`);
  }
  return result.sort();
}

function validate(directory, buildId) {
  if (
    !buildPattern.test(buildId) ||
    lstatSync(directory).isSymbolicLink() ||
    !lstatSync(directory).isDirectory()
  )
    throw new Error("Invalid build directory");
  const names = files(directory).filter((name) => name !== "manifest.json");
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  if (
    manifest.buildId !== buildId ||
    !manifest.maps ||
    typeof manifest.maps !== "object" ||
    Array.isArray(manifest.maps) ||
    !names.length ||
    JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.maps).sort())
  ) {
    throw new Error(`Invalid source map manifest: ${buildId}`);
  }
  for (const name of names) {
    if (!validMapName(name) || hash(path.join(directory, name)) !== manifest.maps[name]) {
      throw new Error(`Invalid source map: ${name}`);
    }
  }
}

function extract(output, buildId) {
  if (!buildPattern.test(buildId)) throw new Error("Invalid build ID");
  const maps = files(output).filter((name) => name.endsWith(".map"));
  if (!maps.some((name) => name.endsWith(".js.map")))
    throw new Error("No JavaScript source maps emitted");
  mkdirSync(store, { recursive: true });
  const temporary = path.join(store, `.incoming-${randomUUID()}`);
  mkdirSync(temporary);
  const manifest = { buildId, maps: {} };
  try {
    for (const name of maps) {
      const destination = path.join(temporary, name);
      mkdirSync(path.dirname(destination), { recursive: true });
      manifest.maps[name] = hash(path.join(output, name));
      renameSync(path.join(output, name), destination);
    }
    writeFileSync(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    validate(temporary, buildId);
    const destination = path.join(store, buildId);
    if (buildId.endsWith("-local-development"))
      rmSync(destination, { recursive: true, force: true });
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      validate(destination, buildId);
      if (
        readFileSync(path.join(destination, "manifest.json"), "utf8") !==
        readFileSync(path.join(temporary, "manifest.json"), "utf8")
      )
        throw new Error(`Immutable build changed: ${buildId}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function fetchWeb(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid source commit");
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "")) throw new Error("Missing GITHUB_REPOSITORY");
  for (let attempt = 0; attempt < 120; attempt++) {
    const runs = JSON.parse(
      run(
        "gh",
        [
          "api",
          `repos/${repository}/actions/workflows/docker-images.yml/runs?head_sha=${commit}&event=push&per_page=20`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      ),
    ).workflow_runs;
    for (const workflow of runs) {
      const artifacts = JSON.parse(
        run("gh", ["api", `repos/${repository}/actions/runs/${workflow.id}/artifacts`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        }),
      ).artifacts;
      const artifact = artifacts.find(
        (entry) => entry.name === `faro-maps-web-${commit}` && !entry.expired,
      );
      if (artifact) {
        const download = path.resolve("target/faro-artifacts", `web-${randomUUID()}`);
        ensureDirectory(download);
        try {
          run("gh", [
            "run",
            "download",
            String(workflow.id),
            "--repo",
            repository,
            "--name",
            artifact.name,
            "--dir",
            download,
          ]);
          if (JSON.stringify(files(download)) !== JSON.stringify(["maps.enc"]))
            throw new Error("Unexpected web map artifact contents");
          unseal(path.join(download, "maps.enc"));
          return;
        } finally {
          rmSync(download, { recursive: true, force: true });
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  throw new Error("Exact web build maps were not published within 60 minutes");
}

function publish(host, root, variants) {
  if (
    !/^[a-zA-Z0-9_.@-]+$/.test(host || "") ||
    !/^\/[a-zA-Z0-9_./-]+$/.test(root || "") ||
    root.split("/").includes("..")
  )
    throw new Error("Invalid map destination");
  const directories = readdirSync(store).filter(
    (name) => buildPattern.test(name) && variants.includes(buildVariant(name)),
  );
  for (const variant of variants) {
    if (!directories.some((name) => buildVariant(name) === variant))
      throw new Error(`Missing maps for ${variant}`);
  }
  for (const buildId of directories) validate(path.join(store, buildId), buildId);
  const incoming = `.incoming-${randomUUID()}`;
  run("ssh", [
    host,
    `python3 -c 'import os,pathlib,sys; root=pathlib.Path(sys.argv[1]); root.resolve()==root or sys.exit("Symlink map store"); os.umask(0o022); root.mkdir(parents=True,exist_ok=True); (root/sys.argv[2]).mkdir()' '${root}' '${incoming}'`,
  ]);
  for (const buildId of directories) {
    run("rsync", [
      "-rzt",
      "--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r",
      `${path.join(store, buildId)}/`,
      `${host}:${root}/${incoming}/${buildId}/`,
    ]);
  }
  const script = `import hashlib,json,os,pathlib,shutil,sys
root = pathlib.Path(sys.argv[1])
stage = root / sys.argv[2]
if root.resolve() != root or stage.is_symlink():
    raise ValueError("Symlink map store")
for src in stage.iterdir():
    if src.is_symlink() or not src.is_dir():
        raise ValueError("Invalid build directory")
    manifest = json.loads((src / "manifest.json").read_text())
    if manifest["buildId"] != src.name:
        raise ValueError("Mismatched release")
    actual = {}
    for file in src.rglob("*"):
        if file.is_symlink():
            raise ValueError("Symlink map")
        if file.is_file() and file.name != "manifest.json":
            relative = file.relative_to(src).as_posix()
            if not relative.endswith(".map"):
                raise ValueError("Not a map")
            actual[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
    if not actual or actual != manifest["maps"]:
        raise ValueError("Map checksum mismatch")
    dst = root / src.name
    if dst.exists() or dst.is_symlink():
        if dst.is_symlink() or (dst / "manifest.json").read_bytes() != (src / "manifest.json").read_bytes():
            raise ValueError("Immutable release changed")
        for relative, digest in actual.items():
            file = dst / relative
            if any(part.is_symlink() for part in [file, *file.parents]) or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                raise ValueError("Existing release changed")
        shutil.rmtree(src)
    else:
        os.rename(src, dst)
stage.rmdir()
`;
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  run("ssh", [host, `python3 -c ${quote(script)} ${quote(root)} ${quote(incoming)}`]);
}

const [command, ...args] = process.argv.slice(2);
if (command === "extract") extract(args[0], args[1]);
else if (command === "seal") seal(args[0]);
else if (command === "unseal") unseal(args[0]);
else if (command === "fetch-web") await fetchWeb(args[0]);
else if (command === "publish") publish(args[0], args[1], args.slice(2));
else
  throw new Error(
    "Usage: faro-sourcemaps.mjs extract <dist> <build-id> | seal <artifact-file> | unseal <artifact-file> | fetch-web <commit> | publish <ssh-host> <private-store> <variant...>",
  );
