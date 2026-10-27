import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, redactor } from '../core/config.js';
import { WordPressClient } from '../wordpress/client.js';
import { NATIVE44_ALL_TYPES } from './catalog.js';
import { applyNative44Revision, prepareNative44Revision, recordNative44RevisionReview, type Native44RevisionDependencies } from './revision.js';
import { readNative44CurrentState } from './current-state.js';

export async function runNative44RevisionCli(argv: string[], root = process.cwd(), dependencies?: Native44RevisionDependencies): Promise<unknown> {
  const [command, ...args] = argv;
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) { if (!/^--[a-z-]+$/.test(args[i] ?? '') || !args[i + 1] || options[args[i]]) throw Error('revision_cli_invalid_arguments'); options[args[i]] = args[i + 1]; }
  const exact = (keys: string[]) => { if (Object.keys(options).some(key => !keys.includes(key)) || keys.some(key => !options[key])) throw Error('revision_cli_invalid_arguments'); };
  root = await realpath(root);
  const json = async (filename: string) => { const target = path.resolve(root, filename), relative = path.relative(root, target); if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || /[?\r\n]|^[a-z]+:\/\//i.test(filename) || await realpath(target) !== target) throw Error('revision_cli_path_escape'); const info = await stat(target); if (!info.isFile() || info.size > 32 * 1024 * 1024) throw Error('revision_cli_request_size_limit'); const bytes = await readFile(target); if (bytes.length > 32 * 1024 * 1024) throw Error('revision_cli_request_size_limit'); return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); };
  if (command === 'prepare') { exact(['--request']); return prepareNative44Revision(root, await json(options['--request'])); }
  if (command === 'status') { exact(['--run']); return { status: 'local-evidence', current: await readNative44CurrentState(root, path.join(root, 'runs', options['--run'])) }; }
  if (command === 'review') { exact(['--run', '--request']); return recordNative44RevisionReview(root, options['--run'], await json(options['--request'])); }
  if (command !== 'apply' && command !== 'reconcile') throw Error('revision_cli_expected_prepare_apply_reconcile_review_or_status');
  exact(['--run', '--operation']);
  const deps = dependencies ?? { remote: async manifest => {
    const loaded = await loadConfig(root);
    if (new URL(manifest.targetUrl).origin !== new URL(loaded.config.targetUrl).origin) throw Error('revision_target_configuration_conflict');
    return new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: [...NATIVE44_ALL_TYPES] });
  } } satisfies Native44RevisionDependencies;
  return applyNative44Revision(root, options['--run'], options['--operation'], deps, command);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNative44RevisionCli(process.argv.slice(2)).then(result => { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); const status = (result as any)?.status; if (['unknown', 'conflict', 'retryable'].includes(status)) process.exitCode = 2; }).catch(error => { process.stderr.write(redactor()(error) + '\n'); process.exitCode = 1; });
}
