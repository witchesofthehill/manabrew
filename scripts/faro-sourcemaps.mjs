import { createHash, randomUUID } from "node:crypto";
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

const buildPattern =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?-[a-f0-9]{40}-[a-z][a-z0-9-]{0,63}$/;
const store = path.resolve("target/faro-sourcemaps");
const run = (program, args, options = {}) =>
  execFileSync(program, args, { stdio: "inherit", ...options });
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const buildVariant = (buildId) => buildId.match(/-[a-f0-9]{40}-(.+)$/)?.[1];

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
  if (!buildPattern.test(buildId) || lstatSync(directory).isSymbolicLink())
    throw new Error("Invalid build directory");
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const names = files(directory).filter((name) => name !== "manifest.json");
  if (
    manifest.buildId !== buildId ||
    !names.length ||
    JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.maps).sort())
  ) {
    throw new Error(`Invalid source map manifest: ${buildId}`);
  }
  for (const name of names) {
    if (
      !/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.map$/.test(name) ||
      name.split("/").some((part) => part === "." || part === "..") ||
      hash(path.join(directory, name)) !== manifest.maps[name]
    ) {
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
        mkdirSync(store, { recursive: true });
        run("gh", [
          "run",
          "download",
          String(workflow.id),
          "--repo",
          repository,
          "--name",
          artifact.name,
          "--dir",
          store,
        ]);
        return;
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
else if (command === "fetch-web") await fetchWeb(args[0]);
else if (command === "publish") publish(args[0], args[1], args.slice(2));
else
  throw new Error(
    "Usage: faro-sourcemaps.mjs extract <dist> <build-id> | fetch-web <commit> | publish <ssh-host> <private-store> <variant...>",
  );
