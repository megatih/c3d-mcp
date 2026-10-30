import { BridgeError, type HelperClient } from '../toolkit.js';
import { HelperUnavailableError } from './helperClient.js';
import { BRIDGE_MENU_PATH } from './paths.js';
import { systemExec, type Executor } from './platform.js';

export type MenuState = 'present' | 'absent' | 'unknown';

export interface PressOptions {
  /** Window title to AXRaise before pressing (document windows only). */
  docTitle?: string;
  timeoutMs?: number;
}

/** Presses the bridge menu item. Resolves once the press was dispatched; rejects with a BridgeError otherwise. */
export interface Trigger {
  press(opts?: PressOptions): Promise<void>;
  menuState(): Promise<MenuState>;
}

// docs/PROTOCOL.md 2.1 (probe P01): the item is AXEnabled only while Cheetah3D is frontmost with a document window key.
const PRESS_SCRIPT = `on run argv
  set docTitle to item 1 of argv
  set waitMs to (item 2 of argv) as integer
  set menuPath to items 3 thru -1 of argv
  tell application "System Events"
    if not (exists process "Cheetah3D") then error "C3D:APP_NOT_RUNNING:Cheetah3D is not running"
    set prevName to name of first application process whose frontmost is true
    tell process "Cheetah3D"
      if (count of (windows whose subrole is "AXDialog")) > 0 then error "C3D:BLOCKED_BY_MODAL:A dialog is open in Cheetah3D"
      set frontmost to true
      set docWins to windows whose subrole is "AXStandardWindow"
      if (count of docWins) is 0 then error "C3D:TRIGGER_FAILED:No document window is open"
      set target to item 1 of docWins
      if docTitle is not "" then
        repeat with w in docWins
          if (name of w) is docTitle then set target to contents of w
        end repeat
      end if
      perform action "AXRaise" of target
      set cur to menu 1 of menu bar item (item 1 of menuPath) of menu bar 1
      repeat with i from 2 to (count of menuPath)
        set mi to menu item (item i of menuPath) of cur
        if i < (count of menuPath) then set cur to menu 1 of mi
      end repeat
      set ticks to waitMs div 25
      repeat with n from 1 to ticks
        if enabled of mi then exit repeat
        delay 0.025
      end repeat
      if not (enabled of mi) then error "C3D:TRIGGER_FAILED:Menu item stayed disabled (Cheetah3D not key, modal open, or macro not loaded)"
      try
        click mi
      on error errText number errNum
        if errNum is not -25204 then error errText number errNum
      end try
    end tell
    if prevName is not "Cheetah3D" then set frontmost of process prevName to true
  end tell
  return "pressed"
end run`;

const MENU_SCRIPT = `on run argv
  tell application "System Events"
    if not (exists process "Cheetah3D") then return "unknown"
    tell process "Cheetah3D"
      try
        set cur to menu 1 of menu bar item (item 1 of argv) of menu bar 1
        repeat with i from 2 to (count of argv)
          if not (exists menu item (item i of argv) of cur) then return "absent"
          if i < (count of argv) then set cur to menu 1 of menu item (item i of argv) of cur
        end repeat
        return "present"
      on error
        return "unknown"
      end try
    end tell
  end tell
end run`;

function failureFrom(stderr: string): BridgeError {
  const marker = /C3D:([A-Z_]+):([^\n]*)/.exec(stderr);
  if (marker) {
    const code = marker[1] as 'APP_NOT_RUNNING' | 'BLOCKED_BY_MODAL' | 'TRIGGER_FAILED';
    const hints: Record<string, string> = {
      APP_NOT_RUNNING: 'Start Cheetah3D and retry (with the helper app installed c3d-mcp launches it by itself unless C3D_MCP_NO_AUTOLAUNCH=1).',
      BLOCKED_BY_MODAL: 'Dismiss the dialog in Cheetah3D, then retry.',
      TRIGGER_FAILED: 'Open a document window, close the Render Manager, or run `c3d-mcp doctor`; a newly installed macro needs a Cheetah3D restart.',
    };
    return new BridgeError(code, marker[2]?.trim() || code, hints[code], { via: 'osascript' });
  }
  if (/not allowed assistive|-25211|-1719|\(-25201\)|assistive access/i.test(stderr)) {
    return new BridgeError('PERMISSION_MISSING', 'macOS Accessibility permission is missing for the process running c3d-mcp', 'System Settings > Privacy & Security > Accessibility: allow your terminal / MCP client (or install the helper app).', { via: 'osascript' });
  }
  return new BridgeError('TRIGGER_FAILED', `osascript failed: ${stderr.trim().slice(0, 300)}`, 'Run `c3d-mcp doctor`.', { via: 'osascript' });
}

/** Fallback trigger that drives System Events through `osascript` (works without the helper app; needs Accessibility for the host process). */
export class OsascriptTrigger implements Trigger {
  constructor(private readonly exec: Executor = systemExec, private readonly menuPath: readonly string[] = BRIDGE_MENU_PATH) {}

  async press(opts: PressOptions = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 2000;
    const res = await this.exec('osascript', ['-e', PRESS_SCRIPT, opts.docTitle ?? '', String(timeoutMs), ...this.menuPath], { timeoutMs: timeoutMs + 20_000 });
    if (res.code !== 0) throw failureFrom(res.stderr);
  }

  async menuState(): Promise<MenuState> {
    const res = await this.exec('osascript', ['-e', MENU_SCRIPT, ...this.menuPath], { timeoutMs: 10_000 });
    const out = res.stdout.trim();
    return res.code === 0 && (out === 'present' || out === 'absent') ? out : 'unknown';
  }
}

export type TriggerMode = 'auto' | 'helper' | 'osascript';

/** Prefers the helper's `pressBridge`; falls back to osascript only when the helper cannot be reached (never after a semantic helper error). */
export class AutoTrigger implements Trigger {
  constructor(
    private readonly helper: HelperClient,
    private readonly osascript: Trigger,
    private readonly mode: TriggerMode = 'auto',
    private readonly menuPath: readonly string[] = BRIDGE_MENU_PATH,
  ) {}

  async press(opts: PressOptions = {}): Promise<void> {
    if (this.mode !== 'osascript' && this.helper.available()) {
      try {
        await this.helper.call('pressBridge', { requireDocTitle: opts.docTitle, timeoutMs: opts.timeoutMs ?? 2000, menuPath: this.menuPath }, (opts.timeoutMs ?? 2000) + 15_000);
        return;
      } catch (err) {
        if (!(err instanceof HelperUnavailableError) || this.mode === 'helper') throw err;
      }
    } else if (this.mode === 'helper') {
      throw new HelperUnavailableError('C3D_MCP_TRIGGER=helper but the helper is not available');
    }
    await this.osascript.press(opts);
  }

  async menuState(): Promise<MenuState> {
    if (this.mode !== 'osascript' && this.helper.available()) {
      try {
        const status = await this.helper.call<{ bridgeMenuPresent?: boolean }>('status', {}, 5000);
        if (typeof status.bridgeMenuPresent === 'boolean') return status.bridgeMenuPresent ? 'present' : 'absent';
      } catch (err) {
        if (!(err instanceof HelperUnavailableError) || this.mode === 'helper') return 'unknown';
      }
    }
    return this.mode === 'helper' ? 'unknown' : this.osascript.menuState();
  }
}
