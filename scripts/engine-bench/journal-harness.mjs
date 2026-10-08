import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

export function harness({ java = "java", jar, forgeHome, sessionId }) {
  const child = spawn(
    java,
    ["-Xmx1g", "-cp", jar, "forge.harness.Main", "--interactive-server", "--forge-home", forgeHome],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let pending,
    stderr = "";
  child.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(-8192);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!pending) return;
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof response.ok !== "boolean") return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (response.ok) current.resolve(response.result);
    else current.reject(new Error(response.error));
  });
  child.on("error", (error) => pending?.reject(error));
  child.on("exit", (code) => pending?.reject(new Error(`harness exited ${code}: ${stderr}`)));
  return {
    call(command, extra = {}) {
      assert(!pending, "serialize harness calls");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout in ${command}: ${stderr}`)),
          60_000,
        );
        pending = { resolve, reject, timer };
        child.stdin.write(JSON.stringify({ command, sessionId, ...extra }) + "\n");
      });
    },
    async prompt(after) {
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        const raw = await this.call("getPrompt", { playerIndex: 0 });
        if (raw) {
          const prompt = JSON.parse(raw);
          if (prompt.promptId !== after) return prompt;
        }
        await this.call("getGameOver");
        await pause();
      }
      throw new Error("next prompt did not arrive");
    },
    async consumed() {
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const batch = await this.drain();
        if (batch) return batch;
        await pause();
      }
      throw new Error("consumed decision did not arrive");
    },
    async drain() {
      const raw = await this.call("drainDecisionJournal");
      return raw ? JSON.parse(raw) : null;
    },
    close() {
      if (pending) clearTimeout(pending.timer);
      child.kill("SIGKILL");
      lines.close();
    },
  };
}
