import { execFileSync } from "node:child_process";

const metadata = JSON.parse(process.env.DOCKER_METADATA || "{}");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const variant = process.env.APP_BUILD_TARGET;
if (!/^[a-f0-9]{40}$/.test(commit) || !["web", "staging-web"].includes(variant))
  throw new Error("Invalid web build identity");
const args = { APP_BUILD_COMMIT: commit, APP_BUILD_TARGET: variant };
for (const line of (process.env.WEB_BUILD_ARGS || "").split("\n")) {
  const index = line.indexOf("=");
  if (index > 0) args[line.slice(0, index)] = line.slice(index + 1);
}
const cacheFrom = (process.env.WEB_CACHE_FROM || "")
  .split("\n")
  .filter(Boolean)
  .map((ref) => ({ type: "registry", ref }));
const shared = {
  context: ".",
  dockerfile: "Dockerfile.web",
  platforms: ["linux/amd64"],
  args,
  "cache-from": cacheFrom,
};
const runtime = {
  ...shared,
  target: "runtime",
  tags: metadata.tags,
  labels: metadata.labels,
  output: [{ type: "registry" }],
};
if (process.env.WEB_CACHE_TO)
  runtime["cache-to"] = [
    {
      type: "registry",
      ref: process.env.WEB_CACHE_TO,
      mode: "min",
      "image-manifest": true,
      "oci-mediatypes": true,
      "ignore-error": true,
    },
  ];
const bake = {
  group: { default: { targets: ["runtime", "maps"] } },
  target: {
    runtime,
    maps: {
      ...shared,
      target: "sourcemaps",
      output: [{ type: "local", dest: "target/faro-sourcemaps" }],
    },
  },
};
execFileSync("docker", ["buildx", "bake", "--file", "-"], {
  input: JSON.stringify(bake),
  stdio: ["pipe", "inherit", "inherit"],
});
