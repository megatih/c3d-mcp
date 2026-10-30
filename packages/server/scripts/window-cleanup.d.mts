export interface CleanupOptions { keepRenderManager?: boolean }
export function windowTitles(): string[];
export function closeNewWindows(before: string[], opts?: CleanupOptions): string[];
export function trackWindows(opts?: CleanupOptions): () => string[];
