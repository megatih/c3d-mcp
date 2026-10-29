import type { HelperClient } from '../toolkit.js';
import { systemExec, type Executor } from './platform.js';

export interface AppStatus {
  running: boolean;
  /** undefined when only a process listing is available. */
  responsive?: boolean;
  frontmost?: boolean;
  version?: string;
  pid?: number;
  /** Process start (epoch ms) when it could be determined; used to recognise state left over from a previous process. */
  startedAtMs?: number;
  source: 'helper' | 'pgrep';
}

export interface ModalInfo { title: string; text: string; buttons: string[] }
export interface AppProbe {
  inspect(): Promise<AppStatus>;
  /** Open dialogs in Cheetah3D (AXDialog windows, P24). Empty when none or when they cannot be determined. */
  modals?(): Promise<ModalInfo[]>;
}

interface HelperStatus { cheetah?: { running?: boolean; pid?: number; frontmost?: boolean; version?: string; responsive?: boolean } }

/** Process liveness for fault classification: helper `status` when reachable, else `pgrep -x Cheetah3D`. */
export function createAppProbe(helper: HelperClient, exec: Executor = systemExec): AppProbe {
  const startCache = new Map<number, number | undefined>();
  async function startOf(pid: number | undefined): Promise<number | undefined> {
    if (pid === undefined) return undefined;
    if (!startCache.has(pid)) {
      const res = await exec('ps', ['-o', 'lstart=', '-p', String(pid)], { timeoutMs: 3000 });
      const t = Date.parse(res.stdout.trim());
      startCache.set(pid, res.code === 0 && Number.isFinite(t) ? t : undefined);
    }
    return startCache.get(pid);
  }
  const DIALOG_SCRIPT = `tell application "System Events"
  if not (exists process "Cheetah3D") then return ""
  set out to ""
  tell process "Cheetah3D"
    repeat with w in windows
      if subrole of w is "AXDialog" then
        set t to ""
        repeat with e in UI elements of w
          try
            if role of e is "AXStaticText" then set t to t & (value of e as text) & " "
          end try
        end repeat
        set out to out & t & linefeed
      end if
    end repeat
  end tell
  return out
end tell`;
  const probe = {
    async modals(): Promise<ModalInfo[]> {
      if (helper.available()) {
        try {
          const r = await helper.call<{ dialogs?: { title?: string; text?: string; buttons?: string[]; own?: boolean }[] }>('modalState', {}, 3000);
          return (r.dialogs ?? []).filter((d) => !d.own).map((d) => ({ title: d.title ?? '', text: d.text ?? '', buttons: d.buttons ?? [] }));
        } catch {
          // fall through to System Events
        }
      }
      const res = await exec('osascript', ['-e', DIALOG_SCRIPT], { timeoutMs: 5000 });
      return res.code === 0 ? res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((text) => ({ title: '', text, buttons: [] })) : [];
    },
    async inspect(): Promise<AppStatus> {
      const s = await probe.inspectRaw();
      return s.running ? { ...s, startedAtMs: await startOf(s.pid) } : s;
    },
    async inspectRaw(): Promise<AppStatus> {
      if (helper.available()) {
        try {
          const c = (await helper.call<HelperStatus>('status', {}, 3000)).cheetah;
          if (c) {
            return { running: c.running === true, responsive: c.responsive, frontmost: c.frontmost, version: c.version, pid: c.pid, source: 'helper' };
          }
        } catch {
          // fall through to the process listing
        }
      }
      const res = await exec('pgrep', ['-x', 'Cheetah3D'], { timeoutMs: 5000 });
      const pid = Number.parseInt(res.stdout.split('\n')[0] ?? '', 10);
      return { running: res.code === 0, pid: Number.isFinite(pid) ? pid : undefined, source: 'pgrep' };
    },
  };
  return probe;
}
