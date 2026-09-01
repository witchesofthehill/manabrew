/**
 * The direct data plane's wasm module, declared rather than imported from its
 * generated `.d.ts`: the module is optional, so a checkout that has not built
 * it must still type-check. `vite.config.ts` resolves the specifier to the real
 * module when it exists and to a stub when it does not.
 */
declare module "@/wasm-net/net" {
  export default function init(input?: unknown): Promise<unknown>;

  export class WasmSeat {
    static bindSeat(
      username: string,
      relayUrl?: string | null,
      relayToken?: string | null,
    ): Promise<WasmSeat>;
    adoptRelay(relayUrl: string, relayToken?: string | null): Promise<void>;
    localEndpoint(): Promise<unknown>;
    endpointId(): string;
    connectToHost(roomId: string, topicSecret: string, members: unknown): Promise<unknown>;
    send(envelope: unknown): boolean;
    recv(): Promise<unknown>;
    isConnected(): boolean;
  }
}
