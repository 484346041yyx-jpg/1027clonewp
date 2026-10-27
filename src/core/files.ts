import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertWorkspaceAccess } from '../workspace/service.js';

export async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(temporary, file);
}
export async function acquireLock(root: string) {
  await assertWorkspaceAccess(root);
  const file = path.join(root, '.cache/clone.lock');
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try { handle = await open(file, 'wx'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const lock = JSON.parse(await readFile(file, 'utf8'));
      let alive = true;
      try { process.kill(lock.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new Error(`Another cloneWP run owns the target lock (PID ${lock.pid})`);
      await unlink(file);
      handle = await open(file, 'wx');
    } else throw error;
  }
  const token = randomUUID();
  await handle.writeFile(JSON.stringify({ pid: process.pid, token, started: new Date().toISOString() }));
  await handle.close();
  return async () => {
    try { const lock = JSON.parse(await readFile(file, 'utf8')); if (lock.token === token) await unlink(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  };
}
export function makeRunId(sourceUrl: string) { return `${new Date().toISOString().replace(/[:.]/g, '-')}-${new URL(sourceUrl).hostname.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 45)}-${randomUUID().slice(0, 8)}`; }
