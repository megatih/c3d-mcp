// Detects what is installed (fresh / current / outdated / newer / partial / unmanaged) without changing anything.
// Used by `c3d-mcp status`, `install` (auto / repair / reinstall), `doctor`, `setup` and the shell installer.
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { assetLocations, compareSemver, newestExisting, packageVersion, parseRuntimeVersion, readRuntimeVersionFile, renderMacroTemplate } from './assets.js';
import { bundledHelperVersion, installedHelperApp, readAppVersion } from './helperInstall.js';
import { mcpSubdirs } from './paths.js';
import type { Runtime } from './runtime.js';

/** What this package would install. */
export interface Bundle {
  runtimeText: string;
  runtimeVersion: string;
  templateText: string;
  /** Version of the helper app this package ships (undefined when none is bundled). */
  helperVersion?: string | undefined;
  packageVersion: string;
}

export type ComponentName = 'mailbox' | 'secret' | 'runtime' | 'macro' | 'manifest' | 'helper';
export type ComponentStatus = 'ok' | 'missing' | 'outdated' | 'newer' | 'modified' | 'corrupt';
export interface ComponentState { name: ComponentName; status: ComponentStatus; detail: string }
export type InstallKind = 'fresh' | 'current' | 'outdated' | 'newer' | 'partial' | 'unmanaged';
export type Recommended = 'install' | 'update' | 'repair' | 'none';

export interface InstallState {
  kind: InstallKind;
  components: ComponentState[];
  installed: { runtime?: string; helper?: string; package?: string };
  bundled: { runtime: string; helper?: string; package: string };
  recommended: Recommended;
  /** One line for humans: "Detected: …". */
  summary: string;
}

/** Reads what this package would install. `error` is a user-facing sentence when the bundled assets are missing. */
export async function loadBundle(rt: Pick<Runtime, 'exec'>, o: { runtimeSource?: string; templateSource?: string } = {}): Promise<{ bundle: Bundle } | { error: string }> {
  const loc = assetLocations();
  const runtimeSource = o.runtimeSource ?? newestExisting(loc.runtime);
  const templateSource = o.templateSource ?? newestExisting(loc.macroTemplate);
  if (!runtimeSource || !templateSource || !existsSync(runtimeSource) || !existsSync(templateSource)) {
    return { error: `Bundled bridge assets are missing (${!runtimeSource || !existsSync(runtimeSource) ? 'runtime.js' : 'macro template'}). Reinstall the c3d-mcp package or build the bridge (bridge/dist/runtime.js).` };
  }
  const runtimeText = await readFile(runtimeSource, 'utf8');
  return {
    bundle: {
      runtimeText,
      runtimeVersion: parseRuntimeVersion(runtimeText) ?? readRuntimeVersionFile(runtimeSource) ?? packageVersion(),
      templateText: await readFile(templateSource, 'utf8'),
      helperVersion: await bundledHelperVersion(rt.exec).catch(() => undefined),
      packageVersion: packageVersion(),
    },
  };
}

export const RUNTIME_MARKER = /c3d-mcp runtime/;
export const MACRO_MARKER = /c3d-mcp bridge loader/;

const mode = (p: string): number | undefined => {
  try { return statSync(p).mode & 0o777; } catch { return undefined; }
};
const text = (p: string): Promise<string | undefined> => readFile(p, 'utf8').catch(() => undefined);

export async function detectInstall(rt: Runtime, bundle: Bundle): Promise<InstallState> {
  const { paths } = rt;
  const components: ComponentState[] = [];
  const add = (name: ComponentName, status: ComponentStatus, detail: string): void => { components.push({ name, status, detail }); };

  // Runtime
  const runtimeText = await text(paths.runtimeFile);
  const installedRuntime = runtimeText === undefined ? undefined : parseRuntimeVersion(runtimeText);
  const runtimeNewer = installedRuntime !== undefined && compareSemver(installedRuntime, bundle.runtimeVersion) > 0;
  if (runtimeText === undefined) add('runtime', 'missing', paths.runtimeFile);
  else if (installedRuntime === undefined) add('runtime', 'corrupt', 'no runtime version found in the installed file');
  else if (runtimeNewer) add('runtime', 'newer', `${installedRuntime} is newer than the bundled ${bundle.runtimeVersion}`);
  else if (compareSemver(installedRuntime, bundle.runtimeVersion) < 0) add('runtime', 'outdated', `${installedRuntime} -> ${bundle.runtimeVersion}`);
  else if (runtimeText !== bundle.runtimeText) add('runtime', 'modified', `${installedRuntime}, but the file differs from the bundled runtime`);
  else add('runtime', 'ok', installedRuntime);

  // Loader macro (its text embeds the paths and the runtime version, like install() renders it)
  const macroText = await text(paths.macroFile);
  const effectiveVersion = runtimeNewer && installedRuntime ? installedRuntime : bundle.runtimeVersion;
  const expectedMacro = renderMacroTemplate(bundle.templateText, { RUNTIME_PATH: paths.runtimeFile, MCP_DIR: paths.root, VERSION: effectiveVersion });
  if (macroText === undefined) add('macro', 'missing', paths.macroFile);
  else if (macroText === expectedMacro) add('macro', 'ok', paths.macroFile);
  else if (!MACRO_MARKER.test(macroText)) add('macro', 'modified', 'the file is not a c3d-mcp loader macro');
  else {
    const found = /c3d-mcp bridge loader (\d+\.\d+\.\d+)/.exec(macroText)?.[1];
    if (found && compareSemver(found, effectiveVersion) < 0) add('macro', 'outdated', `${found} -> ${effectiveVersion}`);
    else add('macro', 'modified', 'the loader macro differs from what this version writes');
  }

  // Mailbox directories and secret
  const dirs = mcpSubdirs(paths);
  const missingDirs = dirs.filter((d) => !existsSync(d));
  const rootMode = mode(paths.root);
  if (missingDirs.length === dirs.length) add('mailbox', 'missing', paths.root);
  else if (missingDirs.length > 0) add('mailbox', 'missing', `missing: ${missingDirs.map((d) => d.slice(paths.root.length + 1) || '.').join(', ')}`);
  else if (rootMode !== undefined && (rootMode & 0o077) !== 0) add('mailbox', 'modified', `${paths.root} is accessible to other users (mode ${rootMode.toString(8)}; expected 700)`);
  else add('mailbox', 'ok', paths.root);
  const secretMode = mode(paths.secret);
  const secretSize = existsSync(paths.secret) ? statSync(paths.secret).size : 0;
  if (secretMode === undefined) add('secret', 'missing', paths.secret);
  else if (secretSize === 0) add('secret', 'corrupt', 'the secret file is empty');
  else if ((secretMode & 0o077) !== 0) add('secret', 'modified', `mode ${secretMode.toString(8)} (expected 600)`);
  else add('secret', 'ok', 'present (0600)');

  // Manifest
  const manifestText = await text(paths.manifest);
  let manifest: { schema?: number; version?: string; mcpDir?: string; helper?: unknown } | undefined;
  if (manifestText === undefined) add('manifest', 'missing', paths.manifest);
  else {
    try { manifest = JSON.parse(manifestText) as typeof manifest; } catch { manifest = undefined; }
    if (!manifest || manifest.schema !== 1) add('manifest', 'corrupt', 'the install manifest cannot be read');
    else if (manifest.mcpDir !== undefined && manifest.mcpDir !== paths.root) add('manifest', 'modified', `it belongs to ${manifest.mcpDir}`);
    else add('manifest', 'ok', `installed by c3d-mcp ${manifest.version ?? '?'}`);
  }

  // Helper (optional: only a problem when a previous install put one there)
  const app = installedHelperApp(rt);
  let installedHelper: string | undefined;
  if (!app) {
    add('helper', 'missing', 'not installed (optional)');
  } else {
    installedHelper = readAppVersion(app);
    const verified = await rt.exec('codesign', ['--verify', '--deep', '--strict', app], { timeoutMs: 20_000 }).then((r) => r.code === 0, () => false);
    if (!verified) add('helper', 'corrupt', `${app} does not pass the code-signature check`);
    else if (installedHelper === undefined) add('helper', 'corrupt', `${app} has no readable version`);
    else if (bundle.helperVersion && compareSemver(installedHelper, bundle.helperVersion) < 0) add('helper', 'outdated', `${installedHelper} -> ${bundle.helperVersion}`);
    else add('helper', 'ok', installedHelper);
  }

  const by = (n: ComponentName): ComponentState => components.find((c) => c.name === n) as ComponentState;
  const helperExpected = manifest?.helper !== undefined;
  // The bridge is installed when any of its own files exist; a helper app alone (e.g. from a Homebrew cask) is not a bridge install.
  const anythingThere = by('runtime').status !== 'missing' || by('macro').status !== 'missing' || by('manifest').status !== 'missing';
  const problems = components.filter((c) => (['missing', 'corrupt', 'modified'] as ComponentStatus[]).includes(c.status) && c.name !== 'manifest' && !(c.name === 'helper' && c.status === 'missing' && !helperExpected));
  const manifestBad = by('manifest').status === 'corrupt' || by('manifest').status === 'modified';
  const outdated = components.filter((c) => c.status === 'outdated');

  // Precedence: nothing at all -> fresh; our files without a manifest -> unmanaged; anything broken -> partial; then versions.
  let kind: InstallKind;
  if (!anythingThere) kind = 'fresh';
  else if (by('manifest').status === 'missing' && (by('runtime').status !== 'missing' || by('macro').status !== 'missing')) kind = 'unmanaged';
  else if (problems.length > 0 || manifestBad) kind = 'partial';
  else if (outdated.length > 0) kind = 'outdated';
  else if (by('runtime').status === 'newer') kind = 'newer';
  else kind = 'current';

  const recommended: Recommended = kind === 'fresh' || kind === 'unmanaged' ? 'install' : kind === 'outdated' ? 'update' : kind === 'partial' ? 'repair' : 'none';
  const list = (xs: ComponentState[]): string => xs.map((c) => `${c.name} ${c.status}`).join(', ');
  const summary =
    kind === 'fresh' ? (app ? `fresh install (no bridge files found; a helper app ${installedHelper ?? ''} is already installed)`.replace('  ', ' ') : 'fresh install (nothing found)')
    : kind === 'current' ? `current (runtime ${installedRuntime ?? '?'}${installedHelper ? `, helper ${installedHelper}` : ', no helper'})`
    : kind === 'outdated' ? `outdated: ${outdated.map((c) => `${c.name} ${c.detail}`).join(', ')}`
    : kind === 'newer' ? `newer than this package (${by('runtime').detail}); it will not be downgraded`
    : kind === 'unmanaged' ? 'bridge files exist but there is no install manifest (installed by hand or the manifest was lost)'
    : `partial install (${list([...problems, ...(manifestBad ? [by('manifest')] : [])])})`;

  return {
    kind,
    components,
    installed: { ...(installedRuntime ? { runtime: installedRuntime } : {}), ...(installedHelper ? { helper: installedHelper } : {}), ...(manifest?.version ? { package: manifest.version } : {}) },
    bundled: { runtime: bundle.runtimeVersion, ...(bundle.helperVersion ? { helper: bundle.helperVersion } : {}), package: bundle.packageVersion },
    recommended,
    summary,
  };
}
