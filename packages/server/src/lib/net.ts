// HTTPS-only download helpers with size caps, used by the assets module. Uses the global fetch (stubbed in tests).
import { createHash } from 'node:crypto';
import { BridgeError } from '../toolkit.js';

export function assertHttps(url: string, hostSuffixes: string[]): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BridgeError('INVALID_ARGUMENT', `Invalid URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new BridgeError('INVALID_ARGUMENT', `Only https URLs are allowed (got ${u.protocol}).`, undefined, { url });
  if (!hostSuffixes.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw new BridgeError('INVALID_ARGUMENT', `Host ${u.hostname} is not allowed.`, `Allowed hosts: ${hostSuffixes.join(', ')}.`, { url });
  return u;
}

/** Reads a response body while counting bytes; aborts (cancels the stream) as soon as `maxBytes` is exceeded. */
export async function readCapped(res: Response, maxBytes: number, what: string): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    void res.body?.cancel().catch(() => undefined);
    throw new BridgeError('INVALID_ARGUMENT', `${what} is ${declared} bytes, over the ${maxBytes} byte cap.`);
  }
  if (!res.body) {
    const all = Buffer.from(await res.arrayBuffer());
    if (all.length > maxBytes) throw new BridgeError('INVALID_ARGUMENT', `${what} is ${all.length} bytes, over the ${maxBytes} byte cap.`);
    return all;
  }
  const reader = res.body.getReader();
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BridgeError('INVALID_ARGUMENT', `${what} exceeded the ${maxBytes} byte cap while downloading; aborted.`);
    }
    parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(parts, total);
}

export const MAX_JSON_BYTES = 8 * 1024 * 1024;

export async function fetchJson(url: string, hosts: string[], timeoutMs = 20000, maxBytes = MAX_JSON_BYTES): Promise<any> {
  assertHttps(url, hosts);
  const res = await fetch(url, { headers: { 'user-agent': 'c3d-mcp' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new BridgeError('DEPENDENCY_FAILED', `HTTP ${res.status} from ${new URL(url).hostname}.`, 'Check the asset id / try again later.');
  const body = await readCapped(res, maxBytes, 'JSON response');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new BridgeError('PARSE_ERROR', `Response from ${new URL(url).hostname} is not valid JSON.`);
  }
}

export interface Downloaded { data: Buffer; sha256: string; md5: string }

export async function fetchBinary(url: string, hosts: string[], maxBytes: number, timeoutMs = 120000): Promise<Downloaded> {
  assertHttps(url, hosts);
  const res = await fetch(url, { headers: { 'user-agent': 'c3d-mcp' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new BridgeError('DEPENDENCY_FAILED', `HTTP ${res.status} downloading ${new URL(url).pathname}.`);
  const data = await readCapped(res, maxBytes, 'Download');
  return { data, sha256: createHash('sha256').update(data).digest('hex'), md5: createHash('md5').update(data).digest('hex') };
}
