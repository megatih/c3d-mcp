// ASCII-only JSON and Adler-32, as required by docs/PROTOCOL.md section 2.2 / 3 (probe P05: File.write truncates non-ASCII).

/** JSON.stringify with every code unit >= 0x7F escaped as \uXXXX (surrogate pairs stay valid as two escapes). */
export function asciiJson(value: unknown): string {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) throw new TypeError('value is not JSON-serialisable');
  return text.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Adler-32 of the bytes, 8 lowercase hex digits. */
export function adler32(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, '0');
}
