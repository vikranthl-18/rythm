import { Component, type ReactNode } from "react";
import { captureError, clearLastError, getLastError } from "../lib/errors";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Crash shield — catches render errors so the app never white-screens.
 * Shows a friendly recovery screen with the error message, a retry, and a
 * "reset app data" escape hatch (data lives in the browser; sometimes a
 * corrupted localStorage value is the culprit).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    captureError(error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const err = getLastError();
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <div className="crash-logo">◢</div>
          <h1>Something went wrong</h1>
          <p>
            rythm hit an unexpected error. Your data is safe — it lives in this
            browser, not on a server.
          </p>
          {err && (
            <code className="crash-code">
              {err.message}
              {err.at ? ` — ${new Date(err.at).toLocaleString()}` : ""}
            </code>
          )}
          <div className="crash-actions">
            <button
              className="btn-start"
              onClick={() => {
                clearLastError();
                this.setState({ hasError: false });
              }}
            >
              Try again
            </button>
            <button className="btn-ghost" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
          <button
            className="crash-reset"
            onClick={() => {
              try {
                const keys: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (k && k.startsWith("rythm-")) keys.push(k);
                }
                keys.forEach((k) => localStorage.removeItem(k));
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
          >
            Reset app data (last resort)
          </button>
        </div>
      </div>
    );
  }
}
