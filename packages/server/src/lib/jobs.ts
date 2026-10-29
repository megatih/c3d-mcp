// In-process job registry for c3d_render_sequence (one frame per bridge request).
import { randomUUID } from 'node:crypto';

export type JobStatus = 'running' | 'done' | 'cancelled' | 'failed';
export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  total: number;
  completed: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  outputs: string[];
  detail: Record<string, unknown>;
  controller: AbortController;
}

const jobs = new Map<string, Job>();

export function createJob(kind: string, total: number, detail: Record<string, unknown> = {}): Job {
  const job: Job = { id: `job-${randomUUID().slice(0, 8)}`, kind, status: 'running', total, completed: 0, startedAt: new Date().toISOString(), outputs: [], detail, controller: new AbortController() };
  jobs.set(job.id, job);
  return job;
}
export const getJob = (id: string): Job | undefined => jobs.get(id);
export const listJobs = (): Job[] => [...jobs.values()];
export function clearJobs(): void {
  jobs.clear();
}

export function finish(job: Job, status: JobStatus, error?: string): void {
  if (job.status !== 'running') return;
  job.status = status;
  job.finishedAt = new Date().toISOString();
  if (error) job.error = error;
}

export function cancelJob(job: Job): boolean {
  if (job.status !== 'running') return false;
  job.controller.abort();
  return true;
}

export function view(job: Job): Record<string, unknown> {
  const { controller: _c, ...rest } = job;
  return { ...rest, progress: job.total ? job.completed / job.total : 1 };
}
