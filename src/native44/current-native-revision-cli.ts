import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, redactor } from '../core/config.js';
import { WordPressClient } from '../wordpress/client.js';
import { NATIVE44_ALL_TYPES } from './catalog.js';
import { applyNative44CurrentNativeRevision, prepareNative44CurrentNativeRevision, type Native44CurrentNativeRevisionDependencies } from './current-native-revision.js';

export async function runNative44CurrentNativeRevisionCli(argv: string[], root = process.cwd(), dependencies?: Native44CurrentNativeRevisionDependencies) {
  const [command, ...args] = argv, options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) { if (!/^--[a-z-]+$/.test(args[i] ?? '') || !args[i + 1] || options[args[i]]) throw Error('current_native_cli_invalid_arguments'); options[args[i]] = args[i + 1]; }
  const exact = (keys: string[]) => { if (Object.keys(options).some(key => !keys.includes(key)) || keys.some(key => !options[key])) throw Error('current_native_cli_invalid_arguments'); };
  root = await realpath(root);
  if (command === 'prepare') {
    exact(['--request']); const filename = path.resolve(root, options['--request']), relative = path.relative(root, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || /[?\r\n]|^[a-z]+:\/\//i.test(options['--request']) || await realpath(filename) !== filename) throw Error('current_native_cli_path_escape');
    const info = await stat(filename); if (!info.isFile() || info.size > 4 * 1024 * 1024) throw Error('current_native_cli_request_size_limit');
    const bytes = await readFile(filename); if (bytes.length > 4 * 1024 * 1024) throw Error('current_native_cli_request_size_limit');
    return prepareNative44CurrentNativeRevision(root, JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
  }
  if (!['apply', 'reconcile'].includes(command)) throw Error('current_native_cli_expected_prepare_apply_or_reconcile');
  exact(['--run', '--operation']);
  const deps = dependencies ?? { remote: async manifest => { const loaded = await loadConfig(root); if (new URL(manifest.targetUrl).origin !== new URL(loaded.config.targetUrl).origin) throw Error('current_native_target_configuration_conflict'); return new WordPressClient({ targetUrl: loaded.config.targetUrl, username: loaded.credentials.wp_user, applicationPassword: loaded.credentials.wp_app_password, networkRoute:loaded.config.wordpressNetworkRoute, executionStrategy: 'native44-css-handoff', allowedWidgetTypes: [...NATIVE44_ALL_TYPES] }); } } satisfies Native44CurrentNativeRevisionDependencies;
  return applyNative44CurrentNativeRevision(root, options['--run'], options['--operation'], deps, command as 'apply' | 'reconcile');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runNative44CurrentNativeRevisionCli(process.argv.slice(2)).then(result => { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); if (['unknown', 'conflict', 'retryable'].includes(result.status)) process.exitCode = 2; }).catch(error => { process.stderr.write(redactor()(error) + '\n'); process.exitCode = 1; });
