const isDevelopment = process.env.ENV === 'development' || !process.env.ENV;

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  requestId?: string;
  data?: unknown;
}

// Thread-local-ish storage for request ID (set per request via middleware)
let currentRequestId: string | undefined;

export function setRequestId(id: string | undefined): void {
  currentRequestId = id;
}

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
    const prefix = `[${entry.timestamp}] [${level}]`;
    if (entry.requestId) {
      output(`${prefix} [${entry.requestId}]`, message, data ?? '');
    } else {
      output(prefix, message, data ?? '');
    }
  } else {
    output(JSON.stringify(entry));
  }
}

export const logger = {
  error: (message: string, data?: unknown) => formatLog('ERROR', message, data),
  warn: (message: string, data?: unknown) => formatLog('WARN', message, data),
  info: (message: string, data?: unknown) => formatLog('INFO', message, data),
  debug: (message: string, data?: unknown) => {
    if (isDevelopment) formatLog('DEBUG', message, data);
  },
};
