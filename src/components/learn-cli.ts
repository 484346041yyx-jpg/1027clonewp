import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { learnComponent, learnPage } from './learning.js';

export async function runLearningCli(args: string[], options: { root?: string; write?: (value: string) => void } = {}): Promise<number> {
  const write = options.write ?? (value => console.log(value)), started = performance.now();
  try {
    const [kind, ...flags] = args, values = new Map<string, string>();
    if (!['page', 'component'].includes(kind)) throw Error('Usage: learn:page --url URL --observed DIRECTORY; learn:component --widget TYPE --evidence MANIFEST');
    const allowed = kind === 'page' ? ['--url', '--observed'] : ['--widget', '--evidence'];
    for (let index = 0; index < flags.length; index += 2) {
      if (!allowed.includes(flags[index]) || !flags[index + 1] || values.has(flags[index])) throw Error(`Invalid or repeated learning option: ${flags[index]}`);
      values.set(flags[index], flags[index + 1]);
    }
    if (allowed.some(flag => !values.has(flag))) throw Error(`Missing learning options: ${allowed.join(', ')}`);
    const root = path.resolve(options.root ?? process.cwd());
    const result = kind === 'page' ? await learnPage(root, values.get('--url')!, values.get('--observed')!) : await learnComponent(root, values.get('--widget')!, values.get('--evidence')!);
    write(JSON.stringify({ status: 'knowledge-published', learningId: result.record.learningId, mode: result.record.mode, conclusionStatus: result.record.conclusionStatus, qualification: result.record.qualification, record: result.recordRef, release: result.releaseRef, activation: 'knowledge-only', enabledComponentCount: 44, metrics: { elapsedMs: performance.now() - started, evidenceFiles: result.record.evidence.length, remoteRequests: 0, siteWrites: 0 } }, null, 2));
    return 0;
  } catch (error) {
    write(JSON.stringify({ status: 'blocked', message: error instanceof Error ? error.message : String(error), metrics: { elapsedMs: performance.now() - started, remoteRequests: 0, siteWrites: 0 } }, null, 2));
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runLearningCli(process.argv.slice(2));
