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

export async function fetchJson(url: string, hosts: string[], timeoutMs = 20000): Promise<any> {
  assertHttps(url, hosts);
  const res = await fetch(url, { headers: { 'user-agent': 'c3d-mcp' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new BridgeError('DEPENDENCY_FAILED', `HTTP ${res.status} from ${new URL(url).hostname}.`, 'Check the asset id / try again later.');
  return res.json();
}

export interface Downloaded { data: Buffer; sha256: string; md5: string }

export async function fetchBinary(url: string, hosts: string[], maxBytes: number, timeoutMs = 120000): Promise<Downloaded> {
  assertHttps(url, hosts);
  const res = await fetch(url, { headers: { 'user-agent': 'c3d-mcp' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!res.ok) throw new BridgeError('DEPENDENCY_FAILED', `HTTP ${res.status} downloading ${new URL(url).pathname}.`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new BridgeError('INVALID_ARGUMENT', `Download is ${declared} bytes, over the ${maxBytes} byte cap.`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > maxBytes) throw new BridgeError('INVALID_ARGUMENT', `Download is ${data.length} bytes, over the ${maxBytes} byte cap.`);
  return { data, sha256: createHash('sha256').update(data).digest('hex'), md5: createHash('md5').update(data).digest('hex') };
}
