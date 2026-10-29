import { join } from 'node:path';

/** Directory with the compiled sources (built by globalBuild.ts). */
export function dist(): string {
  const d = process.env.C3D_TEST_DIST;
  if (!d) throw new Error('C3D_TEST_DIST not set (global build did not run)');
  return d;
}

export const distFile = (rel: string): string => join(dist(), rel);
