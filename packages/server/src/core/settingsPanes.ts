// Opens the System Settings privacy panes the helper needs. The deep-link scheme differs between macOS releases, so each pane has an
// ordered list of candidates; after opening one we read the (read-only) front window title and only accept it when it names the pane.
// Nothing here touches TCC: the user grants the permission by hand.
import type { Logger } from '../logging.js';
import { systemExec, type Executor } from './platform.js';

export type PrivacyPane = 'accessibility' | 'screenRecording';

export const PRIVACY_ROOT = 'x-apple.systempreferences:com.apple.preference.security';
const LEGACY = 'x-apple.systempreferences:com.apple.preference.security';
const EXTENSION = 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension';

const ANCHORS: Record<PrivacyPane, string[]> = {
  accessibility: ['Privacy_Accessibility'],
  screenRecording: ['Privacy_ScreenCapture', 'Privacy_ScreenRecording'],
};

/** Major version from `sw_vers -productVersion` output ("15.4.1" -> 15); undefined when unparsable. */
export function parseMacOSMajor(version: string | undefined): number | undefined {
  const m = /^\s*(\d+)(?:\.\d+)*\s*$/.exec(version ?? '');
  if (!m) return undefined;
  const major = Number.parseInt(m[1] as string, 10);
  return major > 0 ? major : undefined;
}

/** macOS 14 and 15 know the legacy `com.apple.preference.security` scheme best; 26 and newer (and unknown versions) prefer the extension scheme. */
function preferLegacy(major: number | undefined): boolean {
  return major !== undefined && major <= 15;
}

/** Ordered deep links to try, ending with the Privacy & Security root. */
export function paneCandidates(pane: PrivacyPane, major: number | undefined): string[] {
  const schemes = preferLegacy(major) ? [LEGACY, EXTENSION] : [EXTENSION, LEGACY];
  const out: string[] = [];
  for (const anchor of ANCHORS[pane]) for (const scheme of schemes) out.push(`${scheme}?${anchor}`);
  out.push(PRIVACY_ROOT);
  return out;
}

/** True when a System Settings window title names the pane (English UI; case-insensitive, tolerant of "Screen & System Audio Recording"). */
export function paneTitleMatches(pane: PrivacyPane, title: string | undefined): boolean {
  const t = (title ?? '').toLowerCase();
  if (!t) return false;
  // macOS 27 titles the Accessibility privacy list "Device Control and Data Access" (verified live on 27.2).
  return pane === 'accessibility' ? t.includes('accessibility') || t.includes('device control') : t.includes('screen') && (t.includes('recording') || t.includes('system audio'));
}

/** The click path to show when no deep link worked. */
export function manualPath(pane: PrivacyPane, major: number | undefined): string {
  const name = pane === 'accessibility' ? (major !== undefined && major >= 27 ? 'Device Control and Data Access (the former Accessibility list)' : 'Accessibility') : major !== undefined && major >= 15 ? 'Screen & System Audio Recording' : 'Screen Recording';
  return `System Settings > Privacy & Security > ${name}`;
}

export interface OpenPaneDeps {
  open(url: string): Promise<void>;
  /** Title of the front System Settings window, undefined when it cannot be read. */
  frontWindowTitle(): Promise<string | undefined>;
  sleep(ms: number): Promise<void>;
  macosMajor?: number;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** Wait after opening a link before reading the window title (default 1500). */
  settleMs?: number;
}

export interface OpenPaneResult {
  ok: boolean;
  pane: PrivacyPane;
  candidate?: string;
  title?: string;
  /** True when a title was read and matched; false when no title could be read at all (the first link is assumed to have worked). */
  verified: boolean;
  manualPath: string;
  tried: { candidate: string; title?: string }[];
}

export async function openPane(pane: PrivacyPane, deps: OpenPaneDeps): Promise<OpenPaneResult> {
  const manual = manualPath(pane, deps.macosMajor);
  const tried: OpenPaneResult['tried'] = [];
  const settle = deps.settleMs ?? 1500;
  const candidates = paneCandidates(pane, deps.macosMajor);
  let lastOpened: string | undefined;
  let anyTitle = false;
  for (const candidate of candidates) {
    if (candidate === PRIVACY_ROOT) break;
    await deps.open(candidate);
    lastOpened = candidate;
    await deps.sleep(settle);
    const title = await deps.frontWindowTitle().catch(() => undefined);
    tried.push({ candidate, ...(title !== undefined ? { title } : {}) });
    if (title !== undefined) anyTitle = true;
    if (paneTitleMatches(pane, title)) {
      deps.logger?.info('settings pane opened', { pane, candidate, title, macos: deps.macosMajor ?? 'unknown' });
      return { ok: true, pane, candidate, title, verified: true, manualPath: manual, tried };
    }
  }
  if (!anyTitle && tried.length > 0) {
    // Reading the window title needs Accessibility for the calling app, which is the very thing the user is about to grant:
    // assume the first (most specific) link worked and keep the click path as a safety net.
    const first = tried[0]?.candidate;
    deps.logger?.warn('settings pane title unreadable; assuming the first link worked', { pane, candidate: first, macos: deps.macosMajor ?? 'unknown' });
    return { ok: true, pane, candidate: first, verified: false, manualPath: manual, tried };
  }
  if (lastOpened !== PRIVACY_ROOT) await deps.open(PRIVACY_ROOT);
  deps.logger?.warn('no settings deep link matched; opened Privacy & Security', { pane, macos: deps.macosMajor ?? 'unknown', tried: tried.length });
  return { ok: false, pane, verified: false, manualPath: manual, tried };
}

const FRONT_TITLE_SCRIPT = `tell application "System Events"
  if not (exists process "System Settings") then return ""
  tell process "System Settings"
    if (count of windows) is 0 then return ""
    return name of front window
  end tell
end tell`;

/** Default title reader: a read-only System Events query. */
export function systemFrontWindowTitle(exec: Executor = systemExec): () => Promise<string | undefined> {
  return async () => {
    const r = await exec('osascript', ['-e', FRONT_TITLE_SCRIPT], { timeoutMs: 5000 });
    const t = r.stdout.trim();
    return r.code === 0 && t ? t : undefined;
  };
}
