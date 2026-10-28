import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, realpath, rm, lstat } from 'node:fs/promises';
import { HEADER_MODULE_HELP, parseHeaderModuleArguments, runHeaderModuleCLI } from '../src/woodmart-header/generic/cli.js';
import { createHeaderBundle } from '../src/woodmart-header/generic/bundle.js';
import { claimWorkspace, checkpointWorkspace, inspectWorkspace } from '../src/workspace/service.js';
import type { HeaderModulePlan } from '../src/woodmart-header/generic/contract.js';

const plan = (): HeaderModulePlan => ({
  version: 1, kind: 'clonewp-header-module', moduleKey: 'cedar', targetOrigin: 'https://local-only.example', owner: { ownerId: 'clonewp', runId: 'cedar-run' }, name: 'Cedar',
  menus: [{ key: 'main', name: 'Cedar menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }],
  layout: { rows: [{ slot: 'general-header', params: { height: 88 }, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} },
  style: { css: ':header {color:#345}', fonts: [] },
});
const choice = () => ({ version: 1, kind: 'clonewp-replica-header-choice', provider: 'woodmart-header-builder', sourcePartition: { allUnits: ['header', 'body'], headerUnits: ['header'], bodyUnits: ['body'] } });
async function fixture(fn: (base: string) => Promise<void>): Promise<void> {
  const root = await realpath('D:/cloneWP'), name = `header-cli-${randomUUID()}`, base = path.join(root, '.cache', name);
  const status = await inspectWorkspace(root);
  const owner = await claimWorkspace(root, { agent: 'codex', sessionId: name, taskId: name, expectedRevision: status.revision, expectedFingerprint: status.fingerprint, resources: [`local:cache/${name}`] });
  const originalToken = process.env.CLONEWP_WORKSPACE_TOKEN;
  process.env.CLONEWP_WORKSPACE_TOKEN = owner.token;
  await mkdir(base, { recursive: true });
  const originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('Unexpected network in local header CLI'); };
  try { await fn(base); assert.equal(requests, 0); }
  finally {
    globalThis.fetch = originalFetch;
    try {
      const actual = await realpath(base), relative = path.relative(root, actual);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)); assert.equal(actual.toLowerCase(), base.toLowerCase());
      await rm(actual, { recursive: true, force: true });
    } finally {
      if (originalToken === undefined) delete process.env.CLONEWP_WORKSPACE_TOKEN;
      else process.env.CLONEWP_WORKSPACE_TOKEN = originalToken;
      const current = await inspectWorkspace(root);
      await checkpointWorkspace(root, {
        token: owner.token, expectedRevision: owner.revision, expectedFingerprint: current.fingerprint,
        notes: { goal: 'Header CLI local fixture', summary: 'Validated local header CLI behavior', progress: 'completed', decisions: [], changes: [], checks: [], openItems: [], nextSteps: ['Continue project testing'] },
        release: true,
      });
    }
  }
}

test('header module CLI rejects unknown commands, flags and duplicate values', () => {
  for (const command of ['publish', 'constructor', '__proto__', 'toString']) assert.throws(() => parseHeaderModuleArguments([command, '--bundle', 'x']), /unknown_command/);
  for (const args of [
    ['status', '--bundle', 'x', '--page-id', '10'],
    ['status', '--bundle', 'x', '--bundle', 'y'],
    ['bind', '--bundle', 'x', '--page-id'],
    ['status', 'bundle', 'x'],
    ['status', '--bundle', '--help-but-not-help'],
  ]) assert.throws(() => parseHeaderModuleArguments(args), /arguments_invalid/);
  assert.equal(parseHeaderModuleArguments(['--help']).command, 'help');
  assert.match(HEADER_MODULE_HELP, /create-page --bundle DIR --title TITLE --slug SLUG/);
  assert.equal(HEADER_MODULE_HELP.includes('publish --'), false);
});

test('header module CLI requires source scope and bounded numeric page identities', () => {
  assert.throws(() => parseHeaderModuleArguments(['init', '--bundle', 'x', '--plan', 'p']), /required_argument/);
  assert.throws(() => parseHeaderModuleArguments(['route']), /required_argument/);
  for (const id of ['0', '-1', '01', '1.5', '1e3', 'NaN', 'Infinity', '9007199254740993']) {
    assert.throws(() => parseHeaderModuleArguments(['bind', '--bundle', 'x', '--page-id', id]), /page_id_invalid/);
  }
  assert.equal(parseHeaderModuleArguments(['bind', '--bundle', 'x', '--page-id', '123']).flags['page-id'], '123');
  assert.throws(() => parseHeaderModuleArguments(['checkpoint', '--bundle', 'x', '--expected-hash', 'bad']), /hash_invalid/);
});

test('route, init and status stay purely local and keep independent editable files', async () => fixture(async base => {
  const planFile = path.join(base, 'plan.json'), choiceFile = path.join(base, 'choice.json'), directory = path.join(base, 'module');
  await writeFile(planFile, JSON.stringify(plan())); await writeFile(choiceFile, JSON.stringify(choice()));
  const routed = await runHeaderModuleCLI(['route', '--choice', choiceFile]) as { entryPoint: string; remoteWrites: number };
  assert.equal(routed.entryPoint, 'src/woodmart-header/generic/cli.ts'); assert.equal(routed.remoteWrites, 0);
  await writeFile(choiceFile, JSON.stringify({ ...choice(), provider: 'component' }));
  await assert.rejects(runHeaderModuleCLI(['route', '--choice', choiceFile]),/retired_component/);
  await writeFile(choiceFile, JSON.stringify(choice()));
  const initialized = await runHeaderModuleCLI(['init', '--bundle', directory, '--plan', planFile, '--choice', choiceFile]) as { status: string; remoteWrites: number };
  assert.equal(initialized.status, 'planned'); assert.equal(initialized.remoteWrites, 0);
  const beforeHeader = await readFile(path.join(directory, 'header.json')), beforeMenus = await readFile(path.join(directory, 'menus.json'));
  assert.deepEqual(JSON.parse(beforeHeader.toString()).menuBindingPolicy, {version:1,editorReview:'desktop-and-mobile-reopen'});
  const editorPlan = await runHeaderModuleCLI(['plan-menu-editor-review','--bundle',directory]) as {status:string;checks:unknown[];remoteWrites:number};
  assert.equal(editorPlan.status,'needs-browser-evidence');assert.ok(editorPlan.checks.length>0);assert.equal(editorPlan.remoteWrites,0);
  const first = await runHeaderModuleCLI(['status', '--bundle', directory]) as { planHash: string; styleHash: string; remoteWrites: number; visualVerification: string };
  assert.equal(first.remoteWrites, 0); assert.match(first.styleHash, /^[a-f0-9]{64}$/); assert.match(first.visualVerification, /review-required/);
  await writeFile(path.join(directory, 'header.css'), ':header {color:#abc}');
  const edited = await runHeaderModuleCLI(['status', '--bundle', directory]) as { planHash: string; styleHash: string; remoteWrites: number };
  assert.notEqual(edited.styleHash, first.styleHash); assert.notEqual(edited.planHash, first.planHash);
  assert.deepEqual(await readFile(path.join(directory, 'header.json')), beforeHeader); assert.deepEqual(await readFile(path.join(directory, 'menus.json')), beforeMenus);
  assert.equal(edited.remoteWrites, 0);
  // The fixture origin intentionally differs from the configured target: these
  // errors must be decided locally before loading config or creating a driver.
  await assert.rejects(runHeaderModuleCLI(['update-menu', '--bundle', directory, '--menu', 'not-in-plan']), /menu_key_missing/);
  await assert.rejects(runHeaderModuleCLI(['create-page', '--bundle', directory, '--title', 'New page', '--slug', 'not valid']), /page_input_invalid/);
}));

test('public route and init default an omitted provider to WHB for a new task', async () => fixture(async base => {
  const planFile = path.join(base, 'plan.json'), choiceFile = path.join(base, 'choice.json'), directory = path.join(base, 'module');
  const { provider: _provider, ...defaultChoice } = choice();
  await writeFile(planFile, JSON.stringify(plan())); await writeFile(choiceFile, JSON.stringify(defaultChoice));
  const route = await runHeaderModuleCLI(['route', '--choice', choiceFile]) as { provider: string };
  assert.equal(route.provider, 'woodmart-header-builder');
  const result = await runHeaderModuleCLI(['init', '--bundle', directory, '--plan', planFile, '--choice', choiceFile]) as { status: string; remoteWrites: number };
  assert.equal(result.status, 'planned'); assert.equal(result.remoteWrites, 0);
  const saved = JSON.parse(await readFile(path.join(directory, 'choice.json'), 'utf8'));
  assert.equal(saved.provider, 'woodmart-header-builder');
}));

test('public init rejects missing coverage and component-provider mismatch without creating a bundle', async () => fixture(async base => {
  const planFile = path.join(base, 'plan.json'), choiceFile = path.join(base, 'choice.json'), directory = path.join(base, 'module');
  await writeFile(planFile, JSON.stringify(plan()));
  const missing = choice(); missing.sourcePartition.bodyUnits = []; await writeFile(choiceFile, JSON.stringify(missing));
  await assert.rejects(runHeaderModuleCLI(['init', '--bundle', directory, '--plan', planFile, '--choice', choiceFile]), /missing_source_coverage/);
  await assert.rejects(lstat(directory), { code: 'ENOENT' });
  await writeFile(choiceFile, JSON.stringify({ ...choice(), provider: 'component' }));
  await assert.rejects(runHeaderModuleCLI(['init', '--bundle', directory, '--plan', planFile, '--choice', choiceFile]), /retired_component/);
  await assert.rejects(lstat(directory), { code: 'ENOENT' });
}));

test('public status requires the saved source choice even for a lower-level header-only bundle', async () => fixture(async base => {
  const directory = path.join(base, 'module'); await createHeaderBundle(directory, plan());
  await assert.rejects(runHeaderModuleCLI(['status', '--bundle', directory]), { code: 'ENOENT' });
  await assert.rejects(runHeaderModuleCLI(['route', '--choice', 'D:/outside-clonewp/choice.json']), /input_outside_workspace/);
  const help = await runHeaderModuleCLI(['--help']) as { help: string; remoteWrites: number };
  assert.equal(help.remoteWrites, 0); assert.match(help.help, /Body creation\/whole-page review remain separate/);
}));

