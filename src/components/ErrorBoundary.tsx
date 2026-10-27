import { Component, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

interface Props {
  children: ReactNode;
  context?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props & { onReset: () => void }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-full overflow-y-auto gap-4 p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-semibold text-destructive">{`Something went wrong`}</h2>
          {this.props.context && (
            <p className="text-ui-meta text-muted-foreground">{`in ${this.props.context}`}</p>
          )}
          <p className="break-words text-ui-body text-muted-foreground max-w-md">
            {this.state.error?.message ?? `An unexpected error occurred.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
              }}
              className="px-4 py-2 text-ui-label rounded-md bg-muted hover:bg-accent text-foreground touch:min-h-11 touch:min-w-11 whitespace-normal"
            >
              {`Try Again`}
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onReset();
              }}
              className="px-4 py-2 text-ui-label rounded-md bg-muted hover:bg-accent text-foreground touch:min-h-11 touch:min-w-11 whitespace-normal"
            >
              {`Go Home`}
            </button>
          </div>
          {this.state.error?.stack && (
            <details className="mt-4 text-left w-full max-w-lg">
              <summary className="text-ui-label text-muted-foreground cursor-pointer touch:min-h-11 touch:min-w-11">
                {`Stack trace`}
              </summary>
              <pre className="mt-2 text-ui-meta bg-card p-3 rounded overflow-auto max-h-48 text-muted-foreground">
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children, context }: Props) {
  const navigate = useNavigate();
  return (
    <ErrorBoundaryInner context={context} onReset={() => navigate("/")}>
      {children}
    </ErrorBoundaryInner>
  );
}
