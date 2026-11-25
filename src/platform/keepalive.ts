// Relay socket liveness. The client pings every few seconds and drops the socket
// when nothing has come back for a while, but a pong travels behind whatever the
// seat already queued on the same socket. A seat uploading a large payload (the
// Ironsmith host sending match state to several seats) hears nothing until the
// upload is read, which used to look like a dead socket.

/** A send buffer that shrank was drained by the network: the link is slow, not dead. */
export function sendBufferDrained(previous: number, current: number): boolean {
  return current < previous;
}

/** Whether a socket that has gone quiet should be treated as dead. */
export function socketIsStale(params: {
  now: number;
  lastInboundAt: number;
  lastDrainAt: number;
  silenceMs: number;
}): boolean {
  return params.now - Math.max(params.lastInboundAt, params.lastDrainAt) > params.silenceMs;
}
