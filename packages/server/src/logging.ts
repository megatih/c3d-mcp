// Logs go to stderr (stdout is reserved for the MCP protocol) and to a size-rotated file. Secrets are never written.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  dir?: string;
  level?: LogLevel;
  stderr?: boolean;
  maxBytes?: number;
  keep?: number;
  /** Values that must never appear in logs (e.g. the bridge secret). */
  redact?: () => string[];
  write?: (line: string) => void;
}

const SECRET_KEYS = /secret|token|password|authorization/i;

export function redactText(text: string, extra: string[] = []): string {
  let out = text.replace(/\b[0-9a-f]{48,}\b/gi, '[redacted]');
  for (const s of extra) if (s.length >= 8) out = out.split(s).join('[redacted]');
  return out;
}

function scrub(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : v]));
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const envLevel = process.env.C3D_MCP_LOG_LEVEL;
  const min = ORDER[opts.level ?? (envLevel !== undefined && envLevel in ORDER ? (envLevel as LogLevel) : 'info')];
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const keep = opts.keep ?? 3;
  const file = opts.dir ? join(opts.dir, 'c3d-mcp.log') : undefined;
  let fileOk = false;
  let writes = 0;

  const rotate = (): void => {
    if (!file) return;
    try {
      if (statSync(file).size < maxBytes) return;
      rmSync(`${file}.${keep}`, { force: true });
      for (let i = keep - 1; i >= 1; i--) {
        try {
          renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        } catch {
          // missing generation
        }
      }
      renameSync(file, `${file}.1`);
    } catch {
      // nothing to rotate yet
    }
  };

  if (opts.dir) {
    try {
      mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
      fileOk = true;
      rotate();
    } catch {
      fileOk = false;
    }
  }

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[level] < min) return;
    const line = redactText(`${new Date().toISOString()} ${level.toUpperCase()} ${msg}${fields ? ` ${JSON.stringify(scrub(fields))}` : ''}`, opts.redact?.());
    if (opts.write) opts.write(line);
    else if (opts.stderr !== false) process.stderr.write(`${line}\n`);
    if (fileOk && file) {
      try {
        appendFileSync(file, `${line}\n`, { mode: 0o600 });
        if (++writes % 200 === 0) rotate();
      } catch {
        fileOk = false;
      }
    }
  };

  return { debug: (m, f) => emit('debug', m, f), info: (m, f) => emit('info', m, f), warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f) };
}
