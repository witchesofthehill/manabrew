export declare const SAB_SIZE: number;
export declare const SIGNAL_IDLE: 0;
export declare const SIGNAL_PROMPT_READY: 1;
export declare const SIGNAL_RESPONSE_READY: 2;
export declare const SIGNAL_PROMPT_ACKNOWLEDGED: 3;

export interface ForgeSeat {
  readonly buffer: SharedArrayBuffer;
  readonly signal: Int32Array;
  readonly data: Uint8Array;
  /** Set to stop the poll loop; an already-queued frame short-circuits. */
  cancelled: boolean;
  /** A prompt was read off this seat and nothing was written back yet. */
  awaitingResponse: boolean;
  /** Held until the engine blocks on this seat. */
  pendingDirective: unknown;
}

export declare function createSeat(buffer: SharedArrayBuffer): ForgeSeat;
export declare function readSeatMessage(seat: ForgeSeat): string | null;
export declare function writeSeatMessage(seat: ForgeSeat, message: unknown): void;
export declare function deliverSeatDirective(seat: ForgeSeat, directive: unknown): void;
export declare function noteSeatMessage(seat: ForgeSeat, message: unknown): void;
export declare function pollSeat<T = unknown>(
  seat: ForgeSeat,
  onMessage: (message: T, json: string) => void,
  onError?: (error: unknown, json: string) => void,
): void;
