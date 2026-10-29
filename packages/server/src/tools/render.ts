/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, defineTool, type ErrorCode, type ToolContext, type ToolImage } from '../toolkit.js';
import { ext, ensureDir, guardWrite, resolveOut, uniquePath } from '../lib/files.js';
import { cancelJob, createJob, finish, getJob, listJobs, view } from '../lib/jobs.js';
import { clean, ok } from '../lib/result.js';
import { AnyObject, Confirm, ParamMap } from '../lib/schemas.js';

const RENDER_EXT = ['png', 'jpg', 'tiff'];
const MAX_DIM = 1568;
const MAX_BYTES = 900_000;

function checkRenderPath(p: string): void {
  const e = ext(p);
  if (!RENDER_EXT.includes(e)) throw new BridgeError('INVALID_ARGUMENT', `Render extension .${e || '(none)'} is not supported.`, `Use ${RENDER_EXT.map((x) => `.${x}`).join(', ')}; any other extension makes Cheetah3D open a blocking dialog.`);
}

const Res = {
  width: z.number().int().min(16).max(16384).optional().describe('Render width in pixels (sets the renderer resolution).'),
  height: z.number().int().min(16).max(16384).optional().describe('Render height in pixels.'),
};

async function applyResolution(ctx: ToolContext, i: { width?: number; height?: number; renderer?: 'CHEETAH' | 'FALCON'; params?: Record<string, unknown> }): Promise<Record<string, any> | undefined> {
  if (i.width === undefined && i.height === undefined && !i.renderer && !i.params) return undefined;
  if ((i.width === undefined) !== (i.height === undefined)) throw new BridgeError('INVALID_ARGUMENT', 'Give width and height together.');
  return ctx.bridge.one('setRenderSettings', clean({ renderer: i.renderer, width: i.width, height: i.height, params: i.params }));
}

export const setRenderSettings = defineTool({
  name: 'c3d_set_render_settings',
  title: 'Set render settings',
  description: 'Configures the renderer: engine (CHEETAH or FALCON), resolution and other renderer parameters (gamma, exposure, giOn, rayDepth, antialiasingMaxSamples ...); unknown parameter names are reported in the errors list of the result. Returns the resulting resolution. Larger resolution = slower render_image.',
  group: 'render',
  inputSchema: z.strictObject({ renderer: z.enum(['CHEETAH', 'FALCON']).optional().describe('Render engine.'), ...Res, params: ParamMap.optional().describe('Renderer parameters, e.g. {"giOn": true, "exposure": 1.2}.') }),
  outputSchema: z.looseObject({ renderer: z.string().optional(), resolution: AnyObject.optional(), applied: z.array(z.string()).optional(), errors: z.array(AnyObject).optional() }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(i, ctx) {
    if (i.width === undefined && i.height === undefined && !i.renderer && !i.params) throw new BridgeError('INVALID_ARGUMENT', 'Nothing to set: give renderer, width+height or params.');
    if ((i.width === undefined) !== (i.height === undefined)) throw new BridgeError('INVALID_ARGUMENT', 'Give width and height together.');
    const resp = (await ctx.bridge.run([{ op: 'setRenderSettings', args: clean({ renderer: i.renderer, width: i.width, height: i.height, params: i.params }) }])).results[0];
    if (!resp) throw new BridgeError('INTERNAL', 'No result for setRenderSettings.');
    const r = (resp.result ?? {}) as Record<string, any>;
    const errors = (r.errors ?? []) as Array<{ name?: string; code?: string; message?: string }>;
    const applied = (r.applied ?? []) as string[];
    if (!resp.ok) {
      // Partial success: surface what was applied together with the per-key errors instead of failing outright.
      const partial = applied.length > 0 || r.resolution !== undefined;
      if (!partial) {
        const first = errors[0];
        throw new BridgeError(((first?.code ?? resp.error?.code) as ErrorCode | undefined) ?? 'INVALID_ARGUMENT', first ? `${String(first.name)}: ${first.message ?? 'rejected'}` : (resp.error?.message ?? 'setRenderSettings failed'), resp.error?.hint ?? 'Check parameter names with c3d_get_parameters on the renderer.', { errors });
      }
    }
    const rejected = errors.length ? ` ${errors.length} parameter(s) rejected: ${errors.map((e) => `${String(e.name)} (${e.message ?? e.code ?? 'rejected'})`).join(', ')}.` : '';
    return ok({ ...r, applied, errors }, `Renderer ${String(r.renderer)} at ${JSON.stringify(r.resolution)}; applied ${applied.length}.${rejected}`);
  },
});

export const renderImage = defineTool({
  name: 'c3d_render_image',
  title: 'Render image',
  description:
    'Renders the active camera of the document to a PNG/JPG/TIFF file and returns a preview (downscaled to <=1568 px and <1 MB) plus stats {width,height,blank,meanLuma}. Synchronous; large resolutions can take long. blank:true means the image is a single flat color (empty scene, camera inside geometry or no light). The full-resolution file stays in the work directory (path in the result). Only .png/.jpg/.tiff are allowed.',
  group: 'render',
  inputSchema: z.strictObject({
    path: z.string().optional().describe('Output file (.png/.jpg/.tiff); default <workDir>/renders/render-<timestamp>.png.'),
    ...Res,
    time: z.number().min(0).optional().describe('Render at this animation time (seconds).'),
    include_image: z.boolean().optional().describe('Return the preview image (default true).'),
    confirm: Confirm,
  }),
  outputSchema: z.looseObject({ path: z.string(), width: z.number().int(), height: z.number().int(), blank: z.boolean(), meanLuma: z.number(), preview: AnyObject.optional() }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Render the scene to an image and show a preview.',
  async handler(i, ctx) {
    const target = i.path ?? `render-${Date.now()}.png`;
    checkRenderPath(target);
    const abs = resolveOut(ctx, target, 'renders');
    await guardWrite(ctx, abs, i.confirm, 'render');
    await applyResolution(ctx, i);
    ctx.services.progress('rendering');
    const r = await ctx.bridge.one<Record<string, any>>('render', clean({ path: abs, time: i.time }), { deadlineMs: 600_000 });
    if (r.exists === false || !fs.existsSync(abs)) throw new BridgeError('INTERNAL', `Renderer reported success but ${abs} does not exist.`, 'Check c3d_doctor for modal dialogs.');
    const stats = await ctx.services.imageTools.analyze(abs);
    const small = await ctx.services.imageTools.downscale(abs, { maxDim: MAX_DIM, maxBytes: MAX_BYTES });
    const images: ToolImage[] = i.include_image === false ? [] : [{ data: fs.readFileSync(small.path).toString('base64'), mimeType: small.mime }];
    return {
      structured: { path: abs, width: stats.width, height: stats.height, blank: stats.blank, meanLuma: stats.meanLuma, size: r.size, preview: { path: small.path, width: small.width, height: small.height, bytes: small.bytes, mime: small.mime } },
      text: `Rendered ${stats.width}x${stats.height} to ${abs}${stats.blank ? ' - WARNING: image is blank (flat color)' : ''}; mean luma ${stats.meanLuma.toFixed(3)}.`,
      images,
    };
  },
});

export const renderSequence = defineTool({
  name: 'c3d_render_sequence',
  title: 'Render image sequence (job)',
  description: 'Starts a background job rendering frames start..end at the document fps (one frame per bridge request, so other tools can interleave between frames; each frame still blocks Cheetah3D while it renders) into a directory as name_0001.png ... and returns a job id immediately. Poll with c3d_job_status, stop with c3d_job_cancel. The animation time is moved per frame and is NOT restored. Max 3600 frames. Only png/jpg/tiff.',
  group: 'render',
  inputSchema: z.strictObject({
    directory: z.string().optional().describe('Output directory (default <workDir>/sequences/<job>). Existing files are never overwritten.'),
    prefix: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional().describe('File name prefix (default "frame").'),
    format: z.enum(['png', 'jpg', 'tiff']).optional().describe('Image format (default png).'),
    start: z.number().min(0).optional().describe('Start time in seconds (default 0).'),
    end: z.number().min(0).describe('End time in seconds (inclusive).'),
    fps: z.number().min(1).max(240).optional().describe('Frames per second (default: the document fps).'),
    ...Res,
  }),
  outputSchema: z.looseObject({ job_id: z.string(), total_frames: z.number().int(), directory: z.string() }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const start = i.start ?? 0;
    if (i.end < start) throw new BridgeError('INVALID_ARGUMENT', 'end must be >= start.');
    const fps = i.fps ?? (await ctx.bridge.one<{ fps: number }>('getDocumentInfo')).fps;
    const total = Math.floor((i.end - start) * fps + 1e-9) + 1;
    if (total > 3600) throw new BridgeError('INVALID_ARGUMENT', `${total} frames exceeds the limit of 3600.`, 'Render fewer frames or a shorter range.');
    const format = i.format ?? 'png';
    const prefix = i.prefix ?? 'frame';
    const job = createJob('render_sequence', total, { fps, start, end: i.end });
    const dir = i.directory ? path.normalize(i.directory) : path.join(ctx.config.workDir, 'sequences', job.id);
    if (!path.isAbsolute(dir)) {
      finish(job, 'failed', 'directory must be absolute');
      throw new BridgeError('INVALID_ARGUMENT', 'directory must be an absolute path.');
    }
    const files = Array.from({ length: total }, (_, n) => path.join(dir, `${prefix}_${String(n + 1).padStart(4, '0')}.${format}`));
    const clash = files.find((f) => fs.existsSync(f));
    if (clash) {
      finish(job, 'failed', 'file exists');
      throw new BridgeError('INVALID_ARGUMENT', `${clash} already exists; sequences never overwrite files.`, 'Use a new directory or prefix.');
    }
    ensureDir(dir);
    for (const f of files) ctx.session.ownedPaths.add(f);
    job.detail.directory = dir;
    try {
      await applyResolution(ctx, i);
    } catch (e) {
      finish(job, 'failed', e instanceof Error ? e.message : String(e));
      throw e;
    }
    const expectDocument = ctx.session.expectDocument ? { ...ctx.session.expectDocument } : undefined;
    void (async () => {
      try {
        for (let n = 0; n < total; n++) {
          if (job.controller.signal.aborted) {
            finish(job, 'cancelled');
            return;
          }
          await ctx.bridge.one('render', { path: files[n]!, time: start + n / fps }, clean({ expectDocument, deadlineMs: 600_000, signal: job.controller.signal }));
          job.completed = n + 1;
          job.outputs.push(files[n]!);
        }
        finish(job, 'done');
      } catch (e) {
        if (job.controller.signal.aborted) finish(job, 'cancelled');
        else finish(job, 'failed', e instanceof Error ? e.message : String(e));
      }
    })();
    return ok({ job_id: job.id, total_frames: total, directory: dir, fps }, `Started ${job.id}: ${total} frames to ${dir}. Poll with c3d_job_status.`);
  },
});

const JobOut = z.looseObject({ id: z.string(), status: z.enum(['running', 'done', 'cancelled', 'failed']), total: z.number().int(), completed: z.number().int() });

export const jobStatus = defineTool({
  name: 'c3d_job_status',
  title: 'Job status',
  description: 'Reports progress of a background job started by c3d_render_sequence (status, frames completed/total, output files, error). Without job_id lists all jobs of this server process. Jobs are lost when the server restarts.',
  group: 'render',
  inputSchema: z.strictObject({ job_id: z.string().optional().describe('Job id returned by c3d_render_sequence (omit to list all).') }),
  outputSchema: z.looseObject({ jobs: z.array(JobOut) }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  // eslint-disable-next-line @typescript-eslint/require-await
  async handler(i) {
    const jobs = i.job_id ? [getJob(i.job_id)].filter((j) => j !== undefined) : listJobs();
    if (i.job_id && !jobs.length) throw new BridgeError('NOT_FOUND', `No job "${i.job_id}".`, 'Jobs live only in the current server process; omit job_id to list.');
    return ok({ jobs: jobs.map(view) }, jobs.map((j) => `${j.id}: ${j.status} ${j.completed}/${j.total}${j.error ? ` (${j.error})` : ''}`).join('\n') || 'No jobs.');
  },
});

export const jobCancel = defineTool({
  name: 'c3d_job_cancel',
  title: 'Cancel job',
  description: 'Cancels a running background job; the frame currently being rendered finishes first. Already rendered frames are kept.',
  group: 'render',
  inputSchema: z.strictObject({ job_id: z.string().describe('Job id returned by c3d_render_sequence.') }),
  outputSchema: z.looseObject({ cancelled: z.boolean(), job: JobOut }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  // eslint-disable-next-line @typescript-eslint/require-await
  async handler(i) {
    const job = getJob(i.job_id);
    if (!job) throw new BridgeError('NOT_FOUND', `No job "${i.job_id}".`);
    const cancelled = cancelJob(job);
    return ok({ cancelled, job: view(job) }, cancelled ? `Cancellation requested for ${job.id}.` : `${job.id} is already ${job.status}.`);
  },
});

export const captureViewport = defineTool({
  name: 'c3d_capture_viewport',
  title: 'Capture viewport screenshot',
  description: 'Screenshots the Cheetah3D document window (ScreenCaptureKit via the helper) and returns it as an image. Shows the editor viewport (selection, gizmos, grid), unlike c3d_render_image. Needs Screen Recording permission for the helper (PERMISSION_MISSING otherwise).',
  group: 'render',
  inputSchema: z.strictObject({ title: z.string().optional().describe('Window title (default: front document window).') }),
  outputSchema: z.looseObject({ path: z.string(), width: z.number().int(), height: z.number().int(), blank: z.boolean() }),
  mutating: false,
  idempotent: true,
  openWorld: false,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    if (!ctx.helper.available()) throw new BridgeError('PERMISSION_MISSING', 'The helper app is not available.', 'Run c3d_doctor; Screen Recording permission is granted to the helper app in System Settings.');
    const out = path.join(ctx.config.workDir, 'captures', `viewport-${Date.now()}.png`);
    ensureDir(path.dirname(out));
    try {
      await ctx.helper.call('captureWindow', clean({ title: i.title, outPath: out }), 20000);
    } catch (e) {
      if (e instanceof BridgeError && /screen|record|permission/i.test(e.message) && e.code !== 'PERMISSION_MISSING') throw new BridgeError('PERMISSION_MISSING', e.message, 'Grant Screen Recording to the helper in System Settings > Privacy & Security.');
      throw e;
    }
    const stats = await ctx.services.imageTools.analyze(out);
    const small = await ctx.services.imageTools.downscale(out, { maxDim: MAX_DIM, maxBytes: MAX_BYTES });
    return {
      structured: { path: out, width: stats.width, height: stats.height, blank: stats.blank, meanLuma: stats.meanLuma },
      text: `Captured ${stats.width}x${stats.height} viewport to ${out}${stats.blank ? ' (blank - is the window visible?)' : ''}.`,
      images: [{ data: fs.readFileSync(small.path).toString('base64'), mimeType: small.mime }],
    };
  },
});

const Rgb = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

export const postprocessImage = defineTool({
  name: 'c3d_postprocess_image',
  title: 'Post-process rendered image',
  description:
    'POST-PROCESSES an existing image file (normally a c3d_render_image result) with the helper app: bloom {threshold 0..1, radius px, intensity 0..2}, outline {strength 0..1, width 0.5..4, color [r,g,b]} edge lines from luminance, vignette {intensity 0..1, radius 0..2}, grade {saturation 0..2, contrast 0.5..1.5, exposure -2..2, shadow_tint, highlight_tint [r,g,b], tint_amount 0..1}, posterize {levels 2..32}. Cheetah3D itself has NO outlines or bloom: chain it after c3d_render_image(path) and pass that path here. Writes <workDir>/post/<name>_post_<n>.png (never overwrites) and returns a preview. Needs the helper (UNSUPPORTED otherwise: run `c3d-mcp install`).',
  group: 'render',
  inputSchema: z.strictObject({
    path: z.string().min(1).describe('Existing image to process (e.g. the path returned by c3d_render_image). Relative paths resolve inside <workDir>/renders.'),
    out_path: z.string().optional().describe('Output .png (default <workDir>/post/<name>_post_<n>.png). Existing files are never overwritten.'),
    bloom: z.strictObject({ threshold: z.number().min(0).max(1).optional(), radius: z.number().min(1).max(256).optional(), intensity: z.number().min(0).max(2).optional() }).optional().describe('Glow around bright areas: threshold 0..1 (default 0.7), radius in px, intensity 0..2.'),
    outline: z.strictObject({ strength: z.number().min(0).max(1).optional(), width: z.number().min(0.5).max(4).optional(), color: Rgb.optional() }).optional().describe('Edge/outline overlay: strength 0..1, width 0.5..4 px, color [r,g,b] 0..1.'),
    vignette: z.strictObject({ intensity: z.number().min(0).max(1).optional(), radius: z.number().min(0).max(2).optional() }).optional().describe('Darkened corners: intensity 0..1, radius 0..2.'),
    grade: z.strictObject({ saturation: z.number().min(0).max(2).optional(), contrast: z.number().min(0.5).max(1.5).optional(), exposure: z.number().min(-2).max(2).optional(), shadow_tint: Rgb.optional(), highlight_tint: Rgb.optional(), tint_amount: z.number().min(0).max(1).optional() }).optional().describe('Color grade: saturation 0..2, contrast 0.5..1.5, exposure -2..2 stops, split-toning tints [r,g,b] and tint_amount 0..1.'),
    posterize: z.strictObject({ levels: z.number().int().min(2).max(32) }).optional().describe('Reduce each channel to this many levels (2..32).'),
    include_image: z.boolean().optional().describe('Return the preview image (default true).'),
    confirm: Confirm,
  }),
  outputSchema: z.looseObject({ path: z.string(), source: z.string(), width: z.number().int(), height: z.number().int(), applied: z.array(z.string()), blank: z.boolean(), meanLuma: z.number(), preview: AnyObject.optional() }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const effects = { bloom: i.bloom, outline: i.outline, vignette: i.vignette, grade: i.grade, posterize: i.posterize };
    if (!Object.values(effects).some((v) => v !== undefined)) throw new BridgeError('INVALID_ARGUMENT', 'Nothing to do: give at least one of bloom, outline, vignette, grade, posterize.');
    if (!ctx.helper.available()) throw new BridgeError('UNSUPPORTED', 'Image post-processing needs the helper app.', 'Run `c3d-mcp install` to install or update the helper, then c3d_doctor.');
    const src = resolveOut(ctx, i.path, 'renders');
    if (!fs.existsSync(src)) throw new BridgeError('NOT_FOUND', `Image not found: ${src}`, 'Render first with c3d_render_image and pass its path.');
    let out: string;
    if (i.out_path) {
      out = resolveOut(ctx, i.out_path, 'post');
      if (ext(out) !== 'png') throw new BridgeError('INVALID_ARGUMENT', 'out_path must end in .png.');
      await guardWrite(ctx, out, i.confirm, 'post-processing');
    } else {
      const dir = path.join(ctx.config.workDir, 'post');
      ensureDir(dir);
      out = uniquePath(dir, `${path.basename(src, path.extname(src))}_post`, '.png');
      ctx.session.ownedPaths.add(out);
    }
    const g = i.grade;
    const args = clean({
      path: src,
      outPath: out,
      bloom: i.bloom,
      outline: i.outline,
      vignette: i.vignette,
      grade: g ? clean({ saturation: g.saturation, contrast: g.contrast, exposure: g.exposure, shadowTint: g.shadow_tint, highlightTint: g.highlight_tint, tintAmount: g.tint_amount }) : undefined,
      posterize: i.posterize,
    });
    ctx.services.progress('post-processing');
    let r: Record<string, any>;
    try {
      r = await ctx.helper.call<Record<string, any>>('postProcessImage', args, 120_000);
    } catch (e) {
      if (e instanceof BridgeError && (e.name === 'HelperUnavailableError' || /unknown (command|cmd)|unsupported command|not implemented|invalid command/i.test(e.message)))
        throw new BridgeError('UNSUPPORTED', 'The installed helper app cannot post-process images.', 'Run `c3d-mcp install` to update the helper app, then retry.', { cause: e.message });
      throw e;
    }
    const outFile = String(r.outPath ?? out);
    if (!fs.existsSync(outFile)) throw new BridgeError('INTERNAL', `The helper reported success but ${outFile} does not exist.`, 'Run c3d_doctor.');
    ctx.session.ownedPaths.add(outFile);
    const stats = await ctx.services.imageTools.analyze(outFile);
    const small = await ctx.services.imageTools.downscale(outFile, { maxDim: MAX_DIM, maxBytes: MAX_BYTES });
    const images: ToolImage[] = i.include_image === false ? [] : [{ data: fs.readFileSync(small.path).toString('base64'), mimeType: small.mime }];
    const applied = Array.isArray(r.applied) ? (r.applied as string[]) : Object.entries(effects).filter(([, v]) => v !== undefined).map(([k]) => k);
    return {
      structured: { path: outFile, source: src, width: Number(r.width ?? stats.width), height: Number(r.height ?? stats.height), bytes: r.bytes, applied, blank: stats.blank, meanLuma: stats.meanLuma, preview: { path: small.path, width: small.width, height: small.height, bytes: small.bytes, mime: small.mime } },
      text: `Post-processed ${path.basename(src)} (${applied.join(', ')}) -> ${outFile} (${stats.width}x${stats.height}).${stats.blank ? ' WARNING: result is blank.' : ''}`,
      images,
    };
  },
});

export const renderTools = [setRenderSettings, renderImage, renderSequence, jobStatus, jobCancel, captureViewport, postprocessImage];
