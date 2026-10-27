import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, redactor } from '../core/config.js';
import { WordPressClient } from '../wordpress/client.js';
import { NATIVE44_ALL_TYPES } from './catalog.js';
import { applyNative44Publication, finalizeNative44Publication, prepareNative44Publication, type Native44PublicationDependencies } from './publication.js';
import { emitNative44DeliverySummary } from './delivery-summary.js';

export async function runNative44PublicationCli(argv: string[], rootInput = process.cwd(), injected?: Native44PublicationDependencies) {
  const root = await realpath(rootInput), [command, ...args] = argv, options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) { if (!['--request', '--run', '--operation'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error('native44_publication_cli_invalid_arguments'); options[args[i]] = args[i + 1]; }
  const exact = (keys: string[]) => { if (Object.keys(options).some(key => !keys.includes(key)) || keys.some(key => !options[key])) throw Error('native44_publication_cli_invalid_arguments'); };
  if (command === 'prepare') {
    exact(['--request']); const filename = path.resolve(root, options['--request']), relative = path.relative(root, filename);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || /[?\r\n]|^[a-z]+:\/\//i.test(options['--request']) || await realpath(filename) !== filename) throw Error('native44_publication_cli_path_escape');
    const info = await stat(filename); if (!info.isFile() || info.size > 1024 * 1024) throw Error('native44_publication_cli_request_size_limit');
    const content = await readFile(filename); if (content.length > 1024 * 1024) throw Error('native44_publication_cli_request_size_limit');
    return prepareNative44Publication(root, JSON.parse(content.toString('utf8').replace(/^\uFEFF/, '')));
  }
  if (!['apply', 'reconcile', 'finalize'].includes(command)) throw Error('native44_publication_cli_expected_prepare_apply_reconcile_finalize');
  exact(command === 'finalize' ? ['--run'] : ['--run', '--operation']);
  const deps = injected ?? { remote: async targetUrl => { const loaded = await loadConfig(root); if (new URL(targetUrl).origin !== new URL(loaded.config.targetUrl).origin) throw Error('native44_publication_target_origin_conflict'); return new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: NATIVE44_ALL_TYPES }); } } satisfies Native44PublicationDependencies;
  const result = command === 'finalize' ? await finalizeNative44Publication(root, options['--run'], deps) : await applyNative44Publication(root, options['--run'], options['--operation'], deps, command as 'apply' | 'reconcile');
  if (result.status === 'confirmed' && 'publication' in result && result.publication) {
    const publication = result.publication;
    const delivery = await emitNative44DeliverySummary(root, options['--run'], { remoteObservation: { taskId: publication.taskId, runId: publication.runId, pageId: publication.pageId, documentHash: publication.documentHash, status: 'owned-published-current', observedAt: new Date().toISOString(), readOnly: true } });
    return { ...result, deliverySummary: delivery.summaryRef, delivery: delivery.markdownRef };
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runNative44PublicationCli(process.argv.slice(2)).then(result => { console.log(JSON.stringify(result, null, 2)); if (['unknown', 'conflict', 'retryable'].includes(result.status)) process.exitCode = 2; }).catch(error => { console.error(redactor()(error)); process.exitCode = 1; });
