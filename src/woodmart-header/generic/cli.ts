import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertWorkspaceAccess } from '../../workspace/service.js';
import { fileURLToPath } from 'node:url';
import { createHeaderBundle, loadHeaderBundle } from './bundle.js';
import { validateHeaderModulePlan, modulePlanHash } from './contract.js';
import { routeReplicaHeaderChoice, validateReplicaHeaderChoice } from './routing.js';
import { compileBundleStyles, provisionHeaderModule, updateHeaderModule, createHeaderModulePage, bindHeaderModulePage, inspectHeaderModule, reconcileHeaderModule, checkpointHeaderModule } from './service.js';
import { prepareHeaderMenuContentLocal } from './menu-content.js';

const ROOT = 'D:/cloneWP';
export const HEADER_MODULE_HELP = `Independent WoodMart header modules (no legacy generator changes)

  route --choice FILE
  init --bundle DIR --plan FILE --choice FILE [--media FILE]
  status --bundle DIR
  plan-menu-review --bundle DIR --public-url URL
  inspect --bundle DIR
  provision --bundle DIR
  update-header --bundle DIR
  update-menu --bundle DIR --menu KEY
  update-menu-content --bundle DIR --content KEY
  update-style --bundle DIR
  create-page --bundle DIR --title TITLE --slug SLUG
  bind --bundle DIR --page-id ID
  reconcile --bundle DIR
  checkpoint --bundle DIR --expected-hash SHA256

Local layout/menu/CSS files are independent. Remote commands only use the configured
test site. New resources and owned Full Width drafts only; no site default changes.
Body creation/whole-page review remain separate. Writes require subsequent visual review.
`;
const COMMAND_FLAGS: Record<string, { required: string[]; optional?: string[] }> = {
  route: { required: ['choice'] },
  init: { required: ['bundle', 'plan', 'choice'], optional: ['media'] },
  status: { required: ['bundle'] }, inspect: { required: ['bundle'] }, provision: { required: ['bundle'] },
  'plan-menu-review':{required:['bundle','public-url']},
  'update-header': { required: ['bundle'] }, 'update-style': { required: ['bundle'] },
  'update-menu': { required: ['bundle', 'menu'] }, 'create-page': { required: ['bundle', 'title', 'slug'] },
  'update-menu-content': { required: ['bundle', 'content'] },
  bind: { required: ['bundle', 'page-id'] }, reconcile: { required: ['bundle'] },
  checkpoint: { required: ['bundle', 'expected-hash'] },
};
export function parseHeaderModuleArguments(args: string[]): { command: string; flags: Record<string, string> } {
  if (!args.length || args.includes('--help')) return { command: 'help', flags: {} };
  const [command, ...rest] = args, spec = Object.hasOwn(COMMAND_FLAGS, command) ? COMMAND_FLAGS[command] : undefined;
  if (!spec) throw new Error('woodmart_header_cli_unknown_command');
  const flags: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, ''), value = rest[i + 1];
    if (!rest[i]?.startsWith('--') || ![...spec.required, ...spec.optional ?? []].includes(key) || Object.hasOwn(flags, key) || !value || value.startsWith('--')) throw new Error('woodmart_header_cli_arguments_invalid');
    flags[key] = value;
  }
  if (spec.required.some(key => !Object.hasOwn(flags, key))) throw new Error('woodmart_header_cli_required_argument');
  if (flags['page-id'] && !/^[1-9]\d{0,9}$/.test(flags['page-id'])) throw new Error('woodmart_header_cli_page_id_invalid');
  if (flags['expected-hash'] && !/^[a-f0-9]{64}$/.test(flags['expected-hash'])) throw new Error('woodmart_header_cli_hash_invalid');
  return { command, flags };
}
async function inputJSON(filename: string): Promise<unknown> {
  const absolute = path.resolve(filename), relative = path.relative(path.resolve(ROOT), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('woodmart_header_cli_input_outside_workspace');
  let current = path.resolve(ROOT);
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part); const info = await lstat(current);
    if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) throw new Error('woodmart_header_cli_input_reparse');
  }
  const info = await lstat(absolute);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('woodmart_header_cli_input_invalid');
  return JSON.parse(await readFile(absolute, 'utf8'));
}
function mediaInput(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('woodmart_header_cli_media_invalid');
  const output: Record<string, number> = {};
  for (const [key, id] of Object.entries(value)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(key) || !Number.isSafeInteger(id) || (id as number) < 1) throw new Error('woodmart_header_cli_media_invalid');
    output[key] = id as number;
  }
  return output;
}

export async function runHeaderModuleCLI(args: string[]): Promise<unknown> {
  const { command, flags } = parseHeaderModuleArguments(args);
  if (command === 'help') return { help: HEADER_MODULE_HELP, remoteWrites: 0 };
  if (!['route', 'status', 'plan-menu-review'].includes(command)) await assertWorkspaceAccess('D:/cloneWP');
  if (command === 'route') return routeReplicaHeaderChoice(await inputJSON(flags.choice));
  if (command === 'init') {
    const plan = validateHeaderModulePlan(await inputJSON(flags.plan));
    const choice = validateReplicaHeaderChoice(await inputJSON(flags.choice));
    if (choice.provider !== 'woodmart-header-builder') throw new Error('woodmart_header_cli_provider_mismatch');
    const media = flags.media ? mediaInput(await inputJSON(flags.media)) : {};
    // Validate module CSS before creating even a local bundle.
    const { compileHeaderModuleStyles } = await import('./styles.js');
    compileHeaderModuleStyles(plan.style, { moduleKey: plan.moduleKey, headerId: 'header_validation' });
    const bundle = await createHeaderBundle(flags.bundle, plan, media);
    await writeFile(path.join(bundle.directory, 'choice.json'), JSON.stringify(choice, null, 2), { flag: 'wx' });
    return { status: 'planned', bundle: bundle.directory, identity: bundle.state.identity, planHash: modulePlanHash(plan), independentlyEditable: ['header.json', 'menus.json', 'header.css', 'fonts.json'], remoteWrites: 0 };
  }
  const bundle = await loadHeaderBundle(flags.bundle);
  if(command==='plan-menu-review')return{status:'needs-browser-evidence',plans:(await import('./menu-review.js')).headerMenuReviewPlans(bundle,flags['public-url']),remoteWrites:0};
  // The public replica entry always requires the frozen source split. The
  // lower-level service can also be used to author a standalone header only.
  const choice = validateReplicaHeaderChoice(await inputJSON(path.join(bundle.directory, 'choice.json')));
  if (choice.provider !== 'woodmart-header-builder') throw new Error('woodmart_header_cli_provider_mismatch');
  if (command === 'status') return { identity: bundle.state.identity, revision: bundle.state.revision, pending: bundle.state.pending ? { operationId: bundle.state.pending.operationId, action: bundle.state.pending.action } : null, confirmedHash: bundle.state.confirmed?.hash ?? null, planHash: modulePlanHash(bundle.plan), sourcePartition: choice.sourcePartition, styleHash: (await import('node:crypto')).createHash('sha256').update(compileBundleStyles(bundle)).digest('hex'), remoteWrites: 0, visualVerification: 'separate-current-page-review-required' };
  if (bundle.state.pending && !['inspect', 'reconcile'].includes(command)) throw new Error('woodmart_header_cli_reconciliation_required');
  if (command === 'reconcile' && !bundle.state.pending) throw new Error('woodmart_header_cli_no_pending_intent');
  if (command === 'update-menu' && !bundle.plan.menus.some(menu => menu.key === flags.menu)) throw new Error('woodmart_header_cli_menu_key_missing');
  if (command === 'create-page' && (!flags.title.trim() || flags.title.length > 200 || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(flags.slug))) throw new Error('woodmart_header_cli_page_input_invalid');
  if (['provision', 'update-style', 'update-header'].includes(command)) compileBundleStyles(bundle);
  if (bundle.plan.menuContent) await prepareHeaderMenuContentLocal(bundle.plan.menuContent);
  if (command === 'update-menu-content' && !bundle.plan.menuContent?.some(item => item.key === flags.content)) throw Error('woodmart_header_cli_content_key_missing');

  // Unknown commands and all local contracts fail before credentials or network.
  const { loadConfig } = await import('../../core/config.js');
  const { config, credentials } = await loadConfig(ROOT);
  if (new URL(config.targetUrl).origin !== bundle.plan.targetOrigin) throw new Error('woodmart_header_cli_configured_target_mismatch');
  const { WoodMartHeaderTransport } = await import('../transport.js');
  const {WordPressConnection}=await import('../../wordpress/connection.js');
  const { WordPressHeaderModuleDriver } = await import('./wordpress.js');
  const options={targetUrl:config.targetUrl,username:credentials.wp_user,applicationPassword:credentials.wp_app_password,networkRoute:config.wordpressNetworkRoute},session=new WordPressConnection(options);
  const transport = new WoodMartHeaderTransport(options,session);
  const contentClient = bundle.plan.menuContent ? new (await import('../../wordpress/client.js')).WordPressClient({...options, executionStrategy: 'native44-css-handoff' },session) : undefined;
  const driver = new WordPressHeaderModuleDriver(transport, contentClient);
  try {
    switch (command) {
      case 'inspect': return inspectHeaderModule(bundle.directory, driver);
      case 'provision': return provisionHeaderModule(bundle.directory, driver);
      case 'update-header': return updateHeaderModule(bundle.directory, driver, 'header');
      case 'update-style': return updateHeaderModule(bundle.directory, driver, 'style');
      case 'update-menu': return updateHeaderModule(bundle.directory, driver, 'menu', flags.menu);
      case 'update-menu-content': return updateHeaderModule(bundle.directory, driver, 'menu-content', flags.content);
      case 'create-page': return createHeaderModulePage(bundle.directory, driver, { title: flags.title, slug: flags.slug });
      case 'bind': return bindHeaderModulePage(bundle.directory, driver, Number(flags['page-id']));
      case 'reconcile': return reconcileHeaderModule(bundle.directory, driver);
      case 'checkpoint': return checkpointHeaderModule(bundle.directory, driver, flags['expected-hash']);
      default: throw new Error('woodmart_header_cli_unknown_command');
    }
  } finally { await session.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = await runHeaderModuleCLI(process.argv.slice(2)); console.log(JSON.stringify(result, null, 2));
    const serialized = JSON.stringify(result);
    if (serialized.includes('"status":"write-unknown"') || serialized.includes('"status":"conflict"')) process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error(JSON.stringify({ error: /^(?:woodmart_header|workspace)_[a-z0-9_-]+$/i.test(message) ? message : 'woodmart_header_cli_command_failed' }));
    process.exitCode = 1;
  }
}
