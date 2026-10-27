import path from 'node:path';
import { refreshContextIndex } from '../context/index.js';
import { writeJson } from '../core/files.js';

/** Index maintenance is local bookkeeping. Failure never erases a confirmed
 * draft or rewrites its journal as an unsuccessful remote save. */
export async function syncNative44ContextIndex(root: string, evidenceDir: string): Promise<void> {
  try { await refreshContextIndex(root); }
  catch {
    await writeJson(path.join(evidenceDir, 'context-index-gap.json'), { version: 1, code: 'context-index-refresh-failed', blockingRemoteWrites: false, recordedAt: new Date().toISOString(), nextAction: 'Run context:index to rebuild local identity and path references; confirmed site writes remain valid.' });
  }
}
