import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadContext } from './loader.js';
import { refreshContextIndex } from './index.js';
import { CONTEXT_INTENTS, type ContextIntent, type ContextLoadOptions } from './contracts.js';

export function parseContextArguments(args: string[], root: string): ({ command: 'load'; options: ContextLoadOptions } | { command: 'index' }) | undefined {
  const [command, ...rest] = args; if (command === 'index') return rest.length ? undefined : { command };
  if (command !== 'load') return undefined;
  const fields: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) { const field = rest[index], value = rest[index + 1]; if (!['--intent', '--task', '--run', '--components'].includes(field) || fields[field] !== undefined || !value || value.startsWith('--')) return undefined; fields[field] = value; }
  if (!CONTEXT_INTENTS.includes(fields['--intent'] as ContextIntent)) return undefined;
  return { command, options: { root, intent: fields['--intent'] as ContextIntent, ...(fields['--task'] ? { task: fields['--task'] } : {}), ...(fields['--run'] ? { run: fields['--run'] } : {}), ...(fields['--components'] ? { components: fields['--components'].split(',') } : {}) } };
}
export async function contextMain(args = process.argv.slice(2), root = process.cwd()): Promise<number> {
  const parsed = parseContextArguments(args, root);
  if (!parsed) { process.stdout.write(`${JSON.stringify({ status: 'blocked', code: 'context_arguments_invalid', usage: 'context:load --intent replica|learn|compare|resume|maintain [--task ID] [--run ID] [--components commaList]; context:index' })}\n`); return 1; }
  if (parsed.command === 'load') { const result = await loadContext(parsed.options); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return result.exitCode; }
  try { const index = await refreshContextIndex(root); process.stdout.write(`${JSON.stringify({ status: 'ready', tasks: index.tasks.length, runs: index.runs.length, issues: index.issues }, null, 2)}\n`); return 0; }
  catch { process.stdout.write(`${JSON.stringify({ status: 'blocked', code: 'context_index_refresh_failed' })}\n`); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.exitCode = await contextMain();
