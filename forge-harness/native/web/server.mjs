import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".tar": "application/x-tar", ".txt": "text/plain; charset=utf-8" };

createServer(async (req, res) => {
  console.log(new Date().toISOString().slice(11,19), req.method, req.url);
  const path = normalize(decodeURIComponent(req.url.split("?")[0]));
  const file = join(ROOT, path === "/" ? "index.html" : path);
  // SharedArrayBuffer needs cross-origin isolation, same as the Rust engine.
  const headers = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  };
  try {
    await stat(file);
  } catch {
    res.writeHead(404, headers); res.end("not found"); return;
  }
  // The tar goes over the wire compressed; the browser inflates it natively,
  // so the Java side never needs java.util.zip.
  if ((req.headers["accept-encoding"] || "").includes("gzip") && [".tar", ".txt"].includes(extname(file))) {
    headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers);
    createReadStream(file).pipe(createGzip({ level: 6 })).pipe(res);
    return;
  }
  res.writeHead(200, headers);
  res.end(await readFile(file));
}).listen(8099, () => console.log("serving on http://localhost:8099"));
