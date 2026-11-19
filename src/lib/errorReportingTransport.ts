import { FetchTransport, initializeFaro } from "@grafana/faro-web-sdk";
import type { BrowserConfig } from "@grafana/faro-web-sdk";

export function createClientErrorTransport(collectorUrl: string) {
  const controller = new AbortController();
  const listeners: { type: string; listener: EventListener }[] = [];
  const documentListeners: { type: string; listener: EventListener }[] = [];
  const addListener = window.addEventListener;
  window.addEventListener = ((type: string, listener: EventListener) => {
    listeners.push({ type, listener });
    addListener.call(window, type, listener);
  }) as typeof window.addEventListener;
  try {
    const transport = new FetchTransport({
      url: collectorUrl,
      bufferSize: 20,
      concurrency: 1,
      requestTimeoutMs: 5000,
      retry: { maxAttempts: 2, initialBackoffMs: 1000, maxBackoffMs: 5000 },
      requestOptions: {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      },
      requestCompression: false,
    });
    return {
      transport,
      initialize: (config: BrowserConfig) => {
        const addDocumentListener = document.addEventListener;
        document.addEventListener = ((type: string, listener: EventListener) => {
          documentListeners.push({ type, listener });
          addDocumentListener.call(document, type, listener);
        }) as typeof document.addEventListener;
        try {
          return initializeFaro(config);
        } finally {
          document.addEventListener = addDocumentListener;
        }
      },
      dispose: () => {
        controller.abort();
        for (const { type, listener } of listeners) window.removeEventListener(type, listener);
        for (const { type, listener } of documentListeners)
          document.removeEventListener(type, listener);
      },
    };
  } catch (error) {
    for (const { type, listener } of listeners) window.removeEventListener(type, listener);
    throw error;
  } finally {
    window.addEventListener = addListener;
  }
}
