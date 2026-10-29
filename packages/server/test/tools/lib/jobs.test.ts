 
import { beforeEach, describe, expect, it } from 'vitest';
import { cancelJob, clearJobs, createJob, finish, getJob, listJobs, view } from '../../../src/lib/jobs.js';

describe('job registry', () => {
  beforeEach(clearJobs);
  it('tracks progress and completion', () => {
    const j = createJob('x', 4);
    expect(getJob(j.id)).toBe(j);
    j.completed = 2;
    expect(view(j).progress).toBe(0.5);
    finish(j, 'done');
    expect(j.status).toBe('done');
    finish(j, 'failed', 'late');
    expect(j.status).toBe('done');
    expect(listJobs()).toHaveLength(1);
  });
  it('cancels only running jobs and sets the abort signal', () => {
    const j = createJob('x', 2);
    expect(cancelJob(j)).toBe(true);
    expect(j.controller.signal.aborted).toBe(true);
    finish(j, 'cancelled');
    expect(cancelJob(j)).toBe(false);
    expect('controller' in view(j)).toBe(false);
  });
});
