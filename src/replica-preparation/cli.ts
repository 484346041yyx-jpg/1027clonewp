import path from 'node:path';
import { assertReplicaSourceSlug } from '../core/replica-url.js';
import { validatePreparationPlan } from './contract.js';
import { assertWorkspaceAccess } from '../workspace/service.js';
import { fileURLToPath } from 'node:url';
import { initializePreparation, preparationPath, preparationRead, startPreparationJob, completePreparationJob, failPreparationJob, mergePreparationDirectory, preparationStatus, comparePreparationPresentation, readPreparationNativeSettings, readPreparationProductionGuide } from './io.js';
import { EXTENDED_NATIVE_TYPES as NATIVE44_ALL_TYPES } from '../native44/catalog.js';
import { recordPreparationPhase, readPreparationPhases, PREPARATION_PHASE_STAGES, type PreparationPhaseStage, type PreparationPhaseEvent } from './phase-events.js';

type PreparationCommand = 'dispatch' | 'start' | 'complete' | 'fail' | 'merge' | 'status' | 'phase' | 'phases' | 'compare-presentation' | 'read-native-settings' | 'read-production-guide';
export interface PreparationArgs { command: PreparationCommand; input?: string; runDirectory?: string; directory?: string; job?: string; result?: string; evidence?: string; widget?: string; section?: string; device?: 'desktop' | 'phone'; stage?: PreparationPhaseStage; event?: PreparationPhaseEvent; marker?: string }
export const PREPARATION_HELP = 'Default new replicas: create:replica -- PREPARATION.json [--run-dir FINAL_RUN_DIR]\nNative collaboration jobs: replica:prepare -- start|complete|fail --directory DIR --job JOB [--result FILE]\nCoordinator: replica:prepare -- merge|status --directory DIR\nPhase timing: replica:prepare -- phase --directory TASK_MATERIAL_DIR --stage STAGE --event start|succeeded|failed|cancelled [--marker ID]\nPhase history: replica:prepare -- phases --directory TASK_MATERIAL_DIR';
function fail(): never { throw Error('replica_preparation_arguments'); }

export function parsePreparationArgs(args: string[]): PreparationArgs {
  const command = args[0] as PreparationCommand;
  const flags: Record<PreparationCommand, string[]> = { dispatch: ['--input', '--run-dir'], start: ['--directory', '--job'], complete: ['--directory', '--job', '--result'], fail: ['--directory', '--job'], merge: ['--directory'], status: ['--directory'], phase: ['--directory', '--stage', '--event', '--marker'], phases: ['--directory'], 'compare-presentation': ['--directory', '--evidence'], 'read-native-settings': ['--directory', '--widget'], 'read-production-guide': ['--directory', '--job', '--section', '--device'] };
  if (!Object.hasOwn(flags, command)) fail();
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flags[command].includes(flag) || values.has(flag) || !value || value.startsWith('--')) fail();
    values.set(flag, value);
  }
  if (command === 'dispatch' ? !values.has('--input') : !values.has('--directory')) fail();
  if (['start', 'complete', 'fail'].includes(command) && !['header', 'body-1', 'body-2'].includes(values.get('--job') ?? '')) fail();
  if (command === 'complete' && !values.has('--result')) fail();
  if (command === 'compare-presentation' && !values.has('--evidence')) fail();
  if (command === 'read-native-settings' && !(NATIVE44_ALL_TYPES as readonly string[]).includes(values.get('--widget') ?? '')) fail();
  if (command === 'read-production-guide' && (!['body-1', 'body-2', 'merged'].includes(values.get('--job') ?? '') || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(values.get('--section') ?? '') || !['desktop', 'phone'].includes(values.get('--device') ?? ''))) fail();
  if (command === 'phase' && (!(PREPARATION_PHASE_STAGES as readonly string[]).includes(values.get('--stage') ?? '') || !['start', 'succeeded', 'failed', 'cancelled'].includes(values.get('--event') ?? '') || (values.get('--event') === 'start' ? values.has('--marker') : !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(values.get('--marker') ?? '')))) fail();
  return { command, ...(values.has('--section') ? { section: values.get('--section')! } : {}), ...(values.has('--device') ? { device: values.get('--device')! as 'desktop' | 'phone' } : {}), ...(values.has('--widget') ? { widget: values.get('--widget')! } : {}), ...(values.has('--evidence') ? { evidence: values.get('--evidence')! } : {}), ...(values.has('--input') ? { input: values.get('--input')! } : {}), ...(values.has('--run-dir') ? { runDirectory: values.get('--run-dir')! } : {}), ...(values.has('--directory') ? { directory: values.get('--directory')! } : {}), ...(values.has('--job') ? { job: values.get('--job')! } : {}), ...(values.has('--result') ? { result: values.get('--result')! } : {}), ...(values.has('--stage') ? { stage: values.get('--stage')! as PreparationPhaseStage } : {}), ...(values.has('--event') ? { event: values.get('--event')! as PreparationPhaseEvent } : {}), ...(values.has('--marker') ? { marker: values.get('--marker')! } : {}) };
}

/** Resolve only hash-bound file references; business URLs and text stay literal data. */
function resolveRefs(value: unknown, directory: string): unknown {
  if (Array.isArray(value)) return value.map(child => resolveRefs(child, directory));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === 'path' && typeof child === 'string' && typeof record.sha256 === 'string' ? path.resolve(directory, child) : resolveRefs(child, directory)]));
  }
  return value;
}

export async function runPreparationCLI(args: string[]): Promise<unknown> {
  if (!args.length || args.length === 1 && args[0] === '--help') return { help: PREPARATION_HELP + '\nRead-only native settings: replica:prepare -- read-native-settings --directory PREPARATION_DIR --widget WIDGET_TYPE\nRead-only section guide: replica:prepare -- read-production-guide --directory PREPARATION_DIR --job body-1|body-2|merged --section SECTION_KEY --device desktop|phone\nRead-only presentation differences: replica:prepare -- compare-presentation --directory PREPARATION_DIR --evidence REVIEW.json (not visual approval or publishing)', remoteWrites: 0 };
  const parsed = parsePreparationArgs(args);
  if (!['status', 'phases', 'read-production-guide', 'read-native-settings', 'compare-presentation'].includes(parsed.command)) await assertWorkspaceAccess('D:/cloneWP');
  if (parsed.command === 'dispatch') {
    const filename = await preparationPath(parsed.input!);
    const plan = validatePreparationPlan(resolveRefs(await preparationRead(filename), path.dirname(filename)));
    assertReplicaSourceSlug(plan);
    return initializePreparation(plan, parsed.runDirectory ? { finalRunDirectory: parsed.runDirectory } : {});
  }
  const directory = await preparationPath(parsed.directory!);
  if (parsed.command === 'read-production-guide') return readPreparationProductionGuide(directory, parsed.job!, parsed.section!, parsed.device!);
  if (parsed.command === 'compare-presentation') return comparePreparationPresentation(directory, parsed.evidence!);
  if (parsed.command === 'read-native-settings') return readPreparationNativeSettings(directory, parsed.widget!);
  switch (parsed.command) {
    case 'start': return startPreparationJob(directory, parsed.job!);
    case 'complete': return completePreparationJob(directory, parsed.job!, parsed.result!);
    case 'fail': return failPreparationJob(directory, parsed.job!);
    case 'merge': return mergePreparationDirectory(directory);
    case 'status': return preparationStatus(directory);
    case 'phase': return recordPreparationPhase(directory, parsed.stage!, parsed.event!, parsed.marker);
    case 'phases': return { timing: await readPreparationPhases(directory), remoteWrites: 0 };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = await runPreparationCLI(process.argv.slice(2)); console.log(JSON.stringify(result, null, 2));
    if ((result as { status?: string }).status === 'awaiting-preparation') process.exitCode = 3;
    else if ((result as { status?: string }).status === 'failed') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error(JSON.stringify({ error: /^(?:replica_(?:preparation|responsive)|workspace)_[a-z0-9_]+$/.test(message) ? message : 'replica_preparation_failed' })); process.exitCode = 1;
  }
}
