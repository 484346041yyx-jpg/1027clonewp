import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { WORKSPACE_LEASE_MS, ownedSchema } from './contracts.js';
import { localPath, fail } from './files.js';
import { assertWorkspaceAccess, heartbeatWorkspace, readWorkspaceState } from './service.js';

const entries = {
  test: 'tools/test.mjs', build: 'tools/build.mjs',
  'create:replica': 'src/replica-full/entry.ts', 'replica:full': 'src/replica-full/cli.ts',
  'replica:prepare': 'src/replica-preparation/cli.ts', reference: 'src/reference-cli.ts',
  'claude:capture': 'src/claude-capture/cli.ts', 'compare:replica': 'src/native44/compare-cli.ts',
  revision: 'src/native44/revision-cli.ts', 'revision:css': 'src/native44/current-css-revision-cli.ts',
  'revision:native': 'src/native44/current-native-revision-cli.ts', 'current-review': 'src/native44/current-review-cli.ts',
  'editor:complete': 'src/editor-completion/cli.ts', publication: 'src/native44/publication-cli.ts',
  delivery: 'src/native44/delivery-summary-cli.ts',
} as const;
export const execSchema = z.object({
  token: ownedSchema.shape.token,
  command: z.enum(Object.keys(entries) as [keyof typeof entries, ...Array<keyof typeof entries>]),
  args: z.array(z.string().max(4096).refine(value => !value.includes('\0'))).max(200).default([]),
  input: z.unknown().optional(),
}).strict();

/** No shell and no token in argv or files. Only an in-memory child environment. */
export async function execWorkspace(root: string, input: unknown) {
  const request = execSchema.parse(input), state = await readWorkspaceState(root);
  if (!state.lock) fail('not_lock_owner');
  await assertWorkspaceAccess(root, request.token);
  if (request.args.some(arg => arg.includes(request.token))) fail('token_in_arguments');
  const filename = await localPath(root, entries[request.command]);
  let args = filename.endsWith('.ts') ? ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, filename, ...request.args] : [filename, ...request.args];
  if (request.command === 'test' && request.args.length) {
    if (request.args.some(name => !/^tests\/[A-Za-z0-9_.-]+\.test\.ts$/.test(name))) fail('test_selection_invalid');
    const tests = await Promise.all(request.args.map(name => localPath(root, name)));
    args = ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, '--test', '--test-concurrency=2', '--test-timeout=120000', ...tests];
  }
  const child = spawn(process.execPath, args, { cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, CLONEWP_WORKSPACE_TOKEN: request.token } });
  child.stdin.on('error', () => {}); // Child may reject arguments before reading stdin.
  child.stdin.end(request.input === undefined ? undefined : JSON.stringify(request.input));
  let renewal: Promise<void> | undefined, renewalFailed = false;
  const heartbeat = setInterval(() => {
    if (renewal) return;
    renewal = (async () => {
      try {
        const current = await readWorkspaceState(root);
        await heartbeatWorkspace(root, { token: request.token, expectedRevision: current.revision });
      } catch { renewalFailed = true; child.kill(); }
    })().finally(() => { renewal = undefined; });
  }, Math.floor(WORKSPACE_LEASE_MS / 3));
  heartbeat.unref();
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', () => reject(Error('workspace_child_start_failed')));
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    clearInterval(heartbeat);
    await renewal;
    if (renewalFailed) fail('child_lease_lost');
    return { status: 'command-executed', command: request.command, exitCode, remoteWrites: 'determined-by-authorized-child-command' };
  } finally { clearInterval(heartbeat); await renewal; }
}
