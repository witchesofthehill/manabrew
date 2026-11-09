export function workerError(event: ErrorEvent): Error {
  if (event.error instanceof Error) return event.error;
  const error = new Error(event.message || "Worker failed");
  error.stack = "";
  if (event.filename) {
    error.stack = `${error.name}: ${error.message}\n    at ${event.filename}:${event.lineno}:${event.colno}`;
  }
  return error;
}
