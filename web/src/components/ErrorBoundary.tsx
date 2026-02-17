/**
 * ErrorBoundary.tsx — React error boundary for graceful crash recovery.
 *
 * Wraps the entire app (in App.tsx) to catch unhandled React rendering errors.
 * Without this, a crash in any component would result in a blank white screen.
 *
 * ## What it catches
 *
 * - Errors thrown during React render phase
 * - Errors thrown in lifecycle methods (componentDidMount, etc.)
 * - Errors thrown in constructors of child components
 *
 * ## What it does NOT catch
 *
 * - Errors in event handlers (use try/catch in those)
 * - Errors in async code (Promise rejections)
 * - Errors in the error boundary itself
 *
 * ## Behavior
 *
 * On error:
 * 1. `getDerivedStateFromError()` sets hasError=true to trigger fallback UI
 * 2. `componentDidCatch()` logs the error + component stack to console
 * 3. Fallback UI shows the error message and a "Refresh Page" button
 *
 * Note: This is a class component because React error boundaries require
 * getDerivedStateFromError/componentDidCatch, which are class-only APIs.
 * There is no hook equivalent as of React 18.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /** Called during render phase — updates state to show fallback UI */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /** Called after render — logs error details for debugging */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  /** Full page reload — simplest recovery for a crashed React tree */
  handleRefresh = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4 bg-surface-950">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold text-surface-50">Something went wrong</h1>
            <p className="text-surface-400">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={this.handleRefresh}
              className="px-6 py-3 font-semibold transition-colors bg-accent-400 rounded-lg hover:bg-accent-500 text-surface-950"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
