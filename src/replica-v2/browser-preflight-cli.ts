import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BROWSER_DIAGNOSTIC_INPUT_LIMIT_BYTES, browserRequestUtf8Bytes, diagnoseBrowserPreflight } from './browser-diagnostics.js';
import { inspectBrowserCaptureRaster, validateBrowserCaptureTransaction } from './capture-transaction.js';
import { nextBrowserRecoveryAction } from './browser-recovery.js';

type CliIO = { stdin: AsyncIterable<string | Uint8Array>; write: (value: string) => void };
async function boundedProjectFile(root: string, filename: string, limit: number): Promise<Buffer> {
  if (!path.isAbsolute(filename)) throw Error('browser_preflight_absolute_path_required');
  const project = await realpath(root), absolute = await realpath(filename), relative = path.relative(project, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('browser_preflight_path_outside_project');
  const info = await stat(absolute);
  if (!info.isFile() || info.size > limit) throw Error('browser_preflight_input_too_large');
  return readFile(absolute);
}
async function readStdin(input: CliIO['stdin']): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BROWSER_DIAGNOSTIC_INPUT_LIMIT_BYTES) throw Error('browser_preflight_input_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
/** Local-only adapter. The agent supplies sanitized real tool observations; users do not hand-author this packet. */
export async function browserPreflightMain(args = process.argv.slice(2), root = process.cwd(), io: CliIO = { stdin: process.stdin, write: value => process.stdout.write(value) }): Promise<number> {
  const output = (value: unknown) => io.write(`${JSON.stringify(value, null, 2)}\n`);
  try {
    let inputFile: string | undefined, requestFile: string | undefined, rasterFile: string | undefined, version: '1' | '2' | undefined, stdin = false, recover = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--stdin' && !stdin) { stdin = true; continue; }
      if (arg === '--recover' && !recover) { recover = true; continue; }
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Error('browser_preflight_arguments_invalid');
      if (arg === '--input' && !inputFile) inputFile = value;
      else if (arg === '--request' && !requestFile) requestFile = value;
      else if (arg === '--raster' && !rasterFile) rasterFile = value;
      else if (arg === '--version' && !version && ['1', '2'].includes(value)) version = value as '1' | '2';
      else throw Error('browser_preflight_arguments_invalid');
    }
    if (stdin === Boolean(inputFile)) throw Error('browser_preflight_arguments_invalid');
    const text = stdin ? await readStdin(io.stdin) : (await boundedProjectFile(root, inputFile!, BROWSER_DIAGNOSTIC_INPUT_LIMIT_BYTES)).toString('utf8');
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw Error('browser_preflight_json_invalid'); }
    if (recover) {
      if (version || requestFile || rasterFile) throw Error('browser_recovery_arguments_invalid');
      const result = nextBrowserRecoveryAction(input); output(result);
      return result.status === 'ready' ? 0 : result.status === 'continue' || result.status === 'agent-action-required' ? 2 : 1;
    }
    if (version === '2') {
      if (requestFile) throw Error('browser_capture_request_override_forbidden');
      const raster = rasterFile ? await inspectBrowserCaptureRaster(await boundedProjectFile(root, rasterFile, 30 * 1024 * 1024)) : undefined;
      const report = validateBrowserCaptureTransaction(input, { raster }); output(report);
      return report.status === 'verified' ? 0 : report.status === 'action-required' ? 2 : 1;
    }
    if (rasterFile) throw Error('browser_preflight_raster_requires_version_two');
    if (requestFile) {
      const request = await boundedProjectFile(root, requestFile, 16 * 1024 * 1024);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('browser_preflight_input_invalid');
      input = { ...input, request: { utf8Bytes: browserRequestUtf8Bytes(request.toString('utf8')) } };
    }
    const report = diagnoseBrowserPreflight(input); output(report);
    return report.status === 'ready' ? 0 : report.status === 'action-required' ? 2 : 1;
  } catch (error) {
    // Never echo input, URLs, filesystem paths or raw tool errors: these may contain one-time/session data.
    const message = error instanceof Error ? error.message : '';
    const code = /^browser_(?:preflight|request|capture|recovery)_[a-z_]+$/.test(message) ? message : 'browser_preflight_read_failed';
    output({ version: 1, kind: 'browser-preflight', status: 'blocked', code, remoteWrites: 0 }); return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.exitCode = await browserPreflightMain();
