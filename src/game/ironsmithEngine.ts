import { workerError } from "@/lib/workerError";
import type {
  IronsmithEngineMethods,
  IronsmithEngineRequest,
  IronsmithEngineResponse,
} from "./ironsmithEngine.types";

export class IronsmithEngine {
  private readonly worker: Worker;
  private sequence = 0;
  private failure: Error | null = null;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  constructor(onFailure: (error: Error) => void) {
    this.worker = new Worker(new URL("../workers/ironsmith.worker.ts", import.meta.url), {
      type: "module",
      name: "ironsmith-engine",
    });
    this.worker.onmessage = (event: MessageEvent<IronsmithEngineResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.value);
      } else {
        const error = new Error(response.error.message);
        error.name = response.error.name;
        error.stack = response.error.stack ?? "";
        pending.reject(error);
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      if (this.failure) return;
      const error = workerError(event);
      this.dispose(error);
      onFailure(error);
    };
    this.worker.onmessageerror = () => {
      if (this.failure) return;
      const error = new Error("Ironsmith worker message could not be decoded");
      this.dispose(error);
      onFailure(error);
    };
  }

  async call<K extends keyof IronsmithEngineMethods>(
    method: K,
    ...args: Parameters<IronsmithEngineMethods[K]>
  ): Promise<Awaited<ReturnType<IronsmithEngineMethods[K]>>> {
    if (this.failure) throw this.failure;
    const id = ++this.sequence;
    const value = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, method, args } as IronsmithEngineRequest);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
    if (this.failure) throw this.failure;
    return value as Awaited<ReturnType<IronsmithEngineMethods[K]>>;
  }

  dispose(error: Error = new DOMException("Ironsmith game ended", "AbortError")): void {
    if (this.failure) return;
    this.failure = error;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
