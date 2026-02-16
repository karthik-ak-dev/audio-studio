/**
 * utils/logger.ts — Structured logging utility.
 *
 * Provides a lightweight, environment-aware logger that outputs:
 *   - Development: Human-readable format with timestamps, level prefixes,
 *     and optional request IDs for easy terminal reading
 *   - Production:  Single-line JSON per log entry for structured log
 *     ingestion (CloudWatch, ELK, Datadog, etc.)
 *
 * Request ID correlation:
 *   The requestIdMiddleware (middleware/requestId.ts) calls setRequestId()
 *   at the start of each HTTP request. All log entries during that request
 *   automatically include the requestId field, enabling log correlation
 *   across a single request's lifecycle.
 *
 * Log levels:
 *   - error: Unexpected failures, exceptions → console.error
 *   - warn:  Degraded conditions, fallbacks → console.log
 *   - info:  Normal operational events → console.log
 *   - debug: Verbose development details → console.log (dev only, suppressed in prod)
 *
 * Note: This uses a module-level variable for the request ID, which works
 * because Node.js processes requests sequentially within each event loop tick.
 * For truly concurrent async operations, consider AsyncLocalStorage instead.
 */
const isDevelopment = process.env.ENV === 'development' || !process.env.ENV;

/** Structure of a JSON log entry (used in production output) */
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  requestId?: string;
  data?: unknown;
}

// ─── Request ID Tracking ─────────────────────────────────────────
// Set per-request by requestIdMiddleware; included in all log entries
// during that request for correlation in log analysis.
let currentRequestId: string | undefined;

export function setRequestId(id: string | undefined): void {
  currentRequestId = id;
}

/**
 * Core log formatter — builds the entry and outputs it in the appropriate format.
 * Dev mode: pretty-printed with [timestamp] [LEVEL] [requestId] message data
 * Prod mode: single-line JSON for structured log ingestion
 */
function formatLog(level: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(currentRequestId && { requestId: currentRequestId }),
    ...(data !== undefined && { data }),
  };

  const output = level === 'ERROR' ? console.error : console.log;

  if (isDevelopment) {
    // Human-readable format for terminal debugging
    const prefix = `[${entry.timestamp}] [${level}]`;
    if (entry.requestId) {
      output(`${prefix} [${entry.requestId}]`, message, data ?? '');
    } else {
      output(prefix, message, data ?? '');
    }
  } else {
    // Structured JSON for production log aggregation
    output(JSON.stringify(entry));
  }
}

/** Application logger — import and use throughout the codebase */
export const logger = {
  error: (message: string, data?: unknown) => formatLog('ERROR', message, data),
  warn: (message: string, data?: unknown) => formatLog('WARN', message, data),
  info: (message: string, data?: unknown) => formatLog('INFO', message, data),
  debug: (message: string, data?: unknown) => {
    if (isDevelopment) formatLog('DEBUG', message, data);
  },
};
