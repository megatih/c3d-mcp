// A fake C3D Bridge Helper: JSON lines over a Unix socket (contracts/helper-ipc.schema.json).
import { createServer, type Server, type Socket } from 'node:net';
import { rmSync } from 'node:fs';

export type HelperHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export class FakeHelper {
  readonly handlers = new Map<string, HelperHandler>();
  readonly calls: { cmd: string; args: Record<string, unknown> }[] = [];
  private server: Server | undefined;
  private sockets = new Set<Socket>();
  /** When true, connections are accepted but never answered. */
  silent = false;
  /** When true, the connection is closed without a reply. */
  hangUp = false;

  constructor(readonly socketPath: string) {
    this.handlers.set('ping', () => ({ version: '0.1.0', pid: 4242 }));
  }

  async start(): Promise<void> {
    rmSync(this.socketPath, { force: true });
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => undefined);
      let buf = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buf += chunk;
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          void this.reply(socket, line);
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.socketPath, resolve);
    });
  }

  private async reply(socket: Socket, line: string): Promise<void> {
    const req = JSON.parse(line) as { id: string; cmd: string; args?: Record<string, unknown> };
    this.calls.push({ cmd: req.cmd, args: req.args ?? {} });
    if (this.silent) return;
    if (this.hangUp) {
      socket.destroy();
      return;
    }
    const handler = this.handlers.get(req.cmd);
    try {
      if (!handler) throw Object.assign(new Error(`unknown command ${req.cmd}`), { code: 'UNSUPPORTED' });
      const result = await handler(req.args ?? {});
      socket.write(`${JSON.stringify({ id: req.id, ok: true, result })}\n`);
    } catch (err) {
      const e = err as Error & { code?: string; hint?: string; details?: unknown };
      socket.write(`${JSON.stringify({ id: req.id, ok: false, error: { code: e.code ?? 'INTERNAL', message: e.message, hint: e.hint, details: e.details } })}\n`);
    }
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    rmSync(this.socketPath, { force: true });
  }
}
