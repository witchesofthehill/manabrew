import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";

type RpcResponse = { ok: true; result: string } | { ok: false; error: string };

type LineWaiter = {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type HostedPrompt = {
  kind: string;
  [key: string]: unknown;
};

export type PromptResult<TPrompt extends HostedPrompt = HostedPrompt> = {
  raw: string;
  prompt: TPrompt;
};

export type HostedAction = {
  index: number;
  label?: string;
  kind?: string;
  cardId?: string;
  cost?: string;
};

export type HostedStartGameRequest = {
  gameId: string;
  startingLife: number;
  seed: number;
  players: Array<{
    name: string;
    ai?: boolean;
    commanderName?: string | null;
    deck: Array<{ name: string; setCode?: string | null }>;
  }>;
};

export type HostedSessionHandle = {
  sessionId: string;
  playerIndexes: number[];
};

export type HostedSnapshotPlayer = {
  life?: number;
  hand?: unknown[];
  graveyard?: unknown[];
  [key: string]: unknown;
};

export type HostedSnapshot = {
  players?: HostedSnapshotPlayer[];
  stack?: unknown[];
  [key: string]: unknown;
};

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const jarPath = path.join(
  root,
  "forge-harness",
  "target",
  "forge-harness-jar-with-dependencies.jar",
);
const forgeHome = path.join(root, "forge", "forge-gui");

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrompt(raw: string): HostedPrompt {
  return JSON.parse(raw) as HostedPrompt;
}

export class HostedHarness {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdout: Interface;
  private readonly lines: string[] = [];
  private readonly waiters: LineWaiter[] = [];
  private stderrTail = "";
  private exited = false;
  private exitStatus = "";

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.stdout = createInterface({ input: child.stdout });
    this.stdout.on("line", (line) => this.pushLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-8000);
    });
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitStatus = `java exited code=${code ?? "null"} signal=${signal ?? "null"}`;
      const error = new Error(`${this.exitStatus}\n${this.stderrTail}`);
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  }

  static launch() {
    const child = spawn(
      "java",
      ["-jar", jarPath, "--interactive-server", "--forge-home", forgeHome],
      {
        cwd: root,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return new HostedHarness(child);
  }

  async close() {
    if (!this.exited) {
      try {
        await this.request("quit", {}, 5_000);
      } catch (_error) {
        this.child.kill("SIGKILL");
      }
    }
    this.stdout.close();
  }

  async reset() {
    await this.request("reset");
  }

  async startGame(request: HostedStartGameRequest) {
    const raw = await this.request("startGame", { payload: JSON.stringify(request) }, 120_000);
    return JSON.parse(raw) as HostedSessionHandle;
  }

  async abortGame(sessionId: string) {
    await this.request("abortGame", { sessionId }, 30_000);
  }

  async submitAction(sessionId: string, action: Record<string, unknown>) {
    await this.request("submitAction", { sessionId, payload: JSON.stringify(action) }, 30_000);
  }

  async getPromptRaw(sessionId: string, playerIndex = 0) {
    return this.request("getPrompt", { sessionId, playerIndex }, 30_000);
  }

  async getGameOver(sessionId: string) {
    return (await this.request("getGameOver", { sessionId }, 30_000)) === "true";
  }

  async getSnapshot(sessionId: string) {
    const raw = await this.request("getSnapshot", { sessionId }, 30_000);
    return JSON.parse(raw) as HostedSnapshot;
  }

  async waitForPrompt<TPrompt extends HostedPrompt>(
    sessionId: string,
    options: { kind?: string; afterRaw?: string; timeoutMs?: number } = {},
  ): Promise<PromptResult<TPrompt>> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    let lastKind = "<none>";
    while (Date.now() < deadline) {
      const raw = await this.getPromptRaw(sessionId);
      if (raw && raw !== options.afterRaw) {
        const prompt = parsePrompt(raw);
        lastKind = prompt.kind;
        if (!options.kind || prompt.kind === options.kind) {
          return { raw, prompt: prompt as TPrompt };
        }
      }
      await delay(25);
    }
    throw new Error(
      `timed out waiting for prompt ${options.kind ?? "<any>"}; last kind=${lastKind}\n${this.stderrTail}`,
    );
  }

  private async request(command: string, fields: Record<string, unknown> = {}, timeoutMs = 60_000) {
    if (this.exited) {
      throw new Error(`${this.exitStatus}\n${this.stderrTail}`);
    }
    this.child.stdin.write(`${JSON.stringify({ command, ...fields })}\n`);
    const line = await this.readLine(timeoutMs);
    let response: RpcResponse;
    try {
      response = JSON.parse(line) as RpcResponse;
    } catch (error) {
      throw new Error(`malformed harness response: ${line}\n${String(error)}\n${this.stderrTail}`);
    }
    if (!response.ok) {
      throw new Error(`harness command ${command} failed: ${response.error}\n${this.stderrTail}`);
    }
    return response.result;
  }

  private readLine(timeoutMs: number) {
    const line = this.lines.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }
    if (this.exited) {
      return Promise.reject(new Error(`${this.exitStatus}\n${this.stderrTail}`));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error(`timed out waiting for harness response\n${this.stderrTail}`));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  private pushLine(line: string) {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(line);
    } else {
      this.lines.push(line);
    }
  }
}

export function card(name: string) {
  return { name };
}

export function findAction(prompt: HostedPrompt, cardName: string, kind = "spell") {
  const actions = Array.isArray(prompt.actions) ? prompt.actions : [];
  for (const action of actions) {
    if (!action || typeof action !== "object") {
      continue;
    }
    const candidate = action as HostedAction;
    if (candidate.kind === kind && candidate.label?.includes(cardName)) {
      return candidate;
    }
  }
  throw new Error(`no ${kind} action found for ${cardName}: ${JSON.stringify(actions)}`);
}
