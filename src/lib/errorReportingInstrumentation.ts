import { ErrorsInstrumentation } from "@grafana/faro-web-sdk";
import type { ExceptionStackFrame } from "@grafana/faro-web-sdk";

export class ClientErrorsInstrumentation extends ErrorsInstrumentation {
  private restoreHandlers?: () => void;
  private readonly report: (error: unknown, stackFrames?: ExceptionStackFrame[]) => void;

  constructor(report: (error: unknown, stackFrames?: ExceptionStackFrame[]) => void) {
    super();
    this.report = report;
  }

  initialize(): void {
    const previousOnerror = window.onerror;
    const addListener = window.addEventListener;
    let rejectionListener: EventListener | undefined;
    let original: unknown;
    let handling = false;
    this.api = {
      ...this.api,
      pushError: (error, options) => this.report(handling ? original : error, options?.stackFrames),
    };
    // Faro discards rejection identity and has no error-handler teardown in 2.13.0.
    window.addEventListener = ((type: string, listener: EventListener) => {
      if (type !== "unhandledrejection") {
        addListener.call(window, type, listener);
        return;
      }
      rejectionListener = (event) => {
        try {
          original = (event as PromiseRejectionEvent).reason;
          if (!(original instanceof Error) || !original.message) {
            this.report(original);
            return;
          }
          handling = true;
          listener({ reason: original } as unknown as Event);
        } catch {
          this.report(undefined);
        } finally {
          original = undefined;
          handling = false;
        }
      };
      addListener.call(window, type, rejectionListener);
    }) as typeof window.addEventListener;
    try {
      super.initialize();
    } finally {
      window.addEventListener = addListener;
    }
    const sdkOnerror = window.onerror;
    const onerror: OnErrorEventHandler = (...args) => {
      try {
        original = args[4] ?? args[0];
        if (original instanceof Error && !original.message) {
          this.report(original, [
            {
              filename: args[1] ?? "",
              function: "?",
              lineno: args[2],
              colno: args[3],
            },
          ]);
        }
        handling = true;
        return sdkOnerror?.apply(window, args);
      } catch {
        return undefined;
      } finally {
        original = undefined;
        handling = false;
      }
    };
    window.onerror = onerror;
    this.restoreHandlers = () => {
      if (window.onerror === onerror) window.onerror = previousOnerror;
      if (rejectionListener) window.removeEventListener("unhandledrejection", rejectionListener);
    };
  }

  destroy(): void {
    this.restoreHandlers?.();
    this.restoreHandlers = undefined;
  }
}
