import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { createHeaderBundle, loadHeaderBundle, withHeaderBundleLock, saveHeaderBundleState, persistHeaderIntent, type HeaderPendingIntent } from '../src/woodmart-header/generic/bundle.js';
import type { HeaderModulePlan } from '../src/woodmart-header/generic/contract.js';

function plan(): HeaderModulePlan {
  return { version: 1, kind: 'clonewp-header-module', moduleKey: 'alder', targetOrigin: 'https://target.example', owner: { ownerId: 'clonewp', runId: 'new-run' }, name: 'Alder',
    menus: [{ key: 'main', name: 'Alder menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }],
    layout: { rows: [{ slot: 'general-header', params: { height: 90 }, columns: { left: [], center: [{ key: 'main', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: ':header {color:#345}', fonts: [] } };
}
async function fixture(fn: (base: string) => Promise<void>): Promise<void> {
  const root = await realpath('D:/cloneWP'), base = path.join(root, '.cache', `header-bundle-${randomUUID()}`);
  await mkdir(base, { recursive: true });
  try { await fn(base); }
  finally {
    const actual = await realpath(base), relative = path.relative(root, actual);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(actual.toLowerCase(), base.toLowerCase());
    await rm(actual, { recursive: true, force: true });
  }
}

test('bundle splits editable module resources and CSS edits preserve layout, body and identity', async () => fixture(async base => {
  const directory = path.join(base, 'module'), bundle = await createHeaderBundle(directory, plan(), { logo: 42 });
  assert.match(bundle.state.identity.headerId, /^header_[1-9]\d+$/);
  assert.deepEqual(bundle.plan, plan()); assert.deepEqual(bundle.mediaIds, { logo: 42 });
  const originalHeader = await readFile(path.join(directory, 'header.json')), identity = await readFile(path.join(directory, 'identity.json'));
  const body = path.join(base, 'independent-body.json'); await writeFile(body, '{"body":"original"}');
  await writeFile(path.join(directory, 'header.css'), ':header {color:#abc}');
  const edited = await loadHeaderBundle(directory);
  assert.equal(edited.plan.style.css, ':header {color:#abc}');
  assert.deepEqual(await readFile(path.join(directory, 'header.json')), originalHeader);
  assert.deepEqual(await readFile(path.join(directory, 'identity.json')), identity);
  assert.equal(await readFile(body, 'utf8'), '{"body":"original"}');
  await assert.rejects(createHeaderBundle(directory, plan()), /already_exists/);
}));

test('pending unknown operations survive reload with append-only intent and confirmed state', async () => fixture(async base => {
  const directory = path.join(base, 'module'); await createHeaderBundle(directory, plan());
  const pending: HeaderPendingIntent = { operationId: 'op-first', action: 'provision', payload: { isolated: true }, beforeHash: 'a'.repeat(64), planHash: 'b'.repeat(64), createdAt: new Date().toISOString() };
  await withHeaderBundleLock(directory, async bundle => {
    const intent = await persistHeaderIntent(bundle, pending);
    assert.match(intent.sha256, /^[a-f0-9]{64}$/); assert.match(intent.path, /intent-op-first\.json$/);
    await assert.rejects(persistHeaderIntent(bundle, pending), /EEXIST/);
    await saveHeaderBundleState(bundle, { ...bundle.state, pending, revision: 1 });
  });
  const unknown = await loadHeaderBundle(directory);
  assert.deepEqual(unknown.state.pending, pending); assert.equal(unknown.state.confirmed, null);
  await withHeaderBundleLock(directory, async bundle => {
    await saveHeaderBundleState(bundle, { ...bundle.state, pending: null, confirmed: { hash: 'c'.repeat(64), snapshot: { header: bundle.state.identity.headerId, menus: { main: 5 } } }, revision: 2 });
  });
  const saved = await loadHeaderBundle(directory); assert.equal(saved.state.revision, 2); assert.equal(saved.state.pending, null); assert.equal(saved.state.confirmed?.hash, 'c'.repeat(64));
}));

test('locks never steal a busy lock and release their own lock after callback failure', async () => fixture(async base => {
  const directory = path.join(base, 'module'); await createHeaderBundle(directory, plan());
  await withHeaderBundleLock(directory, async () => {
    await assert.rejects(withHeaderBundleLock(directory, async () => undefined), /bundle_locked/);
  });
  await assert.rejects(withHeaderBundleLock(directory, async () => { throw Error('callback failed'); }), /callback failed/);
  await withHeaderBundleLock(directory, async () => undefined);
}));

test('identity tampering and stale state writers fail without changing confirmed disk state', async () => fixture(async base => {
  const directory = path.join(base, 'module'), original = await createHeaderBundle(directory, plan()), stale = await loadHeaderBundle(directory);
  await saveHeaderBundleState(original, { ...original.state, revision: 1 });
  await assert.rejects(saveHeaderBundleState(stale, { ...stale.state, revision: 2 }), /state_changed/);
  const current = await loadHeaderBundle(directory); assert.equal(current.state.revision, 1);
  await assert.rejects(saveHeaderBundleState(current, { ...current.state, revision: 0 }), /revision_regressed/);
  const filename = path.join(directory, 'header.json'), header = JSON.parse(await readFile(filename, 'utf8'));
  header.owner.runId = 'another-run'; await writeFile(filename, JSON.stringify(header));
  await assert.rejects(loadHeaderBundle(directory), /identity_changed/);
}));

test('bundle rejects escaped paths, poisoned JSON and credential-bearing state before persistence', async () => fixture(async base => {
  await assert.rejects(createHeaderBundle('D:/outside-clonewp/header-test', plan()), /path_escape/);
  const directory = path.join(base, 'module'), bundle = await createHeaderBundle(directory, plan());
  await assert.rejects(saveHeaderBundleState(bundle, { ...bundle.state, confirmed: { hash: 'a'.repeat(64), snapshot: { authorization: 'sensitive' } } }), /credential_data_forbidden/);
  const poisoned = JSON.parse('{"__proto__":{"x":1}}');
  await assert.rejects(createHeaderBundle(path.join(base, 'bad'), plan(), poisoned), /json_invalid/);
  const current = await loadHeaderBundle(directory); assert.equal(current.state.confirmed, null);
}));

test('bundle rejects directory junctions and resource reparse points', async () => fixture(async base => {
  const directory = path.join(base, 'module'); await createHeaderBundle(directory, plan());
  const junction = path.join(base, 'alias'); await symlink(directory, junction, 'junction');
  await assert.rejects(loadHeaderBundle(junction), /reparse_or_non_directory/);
  const css = path.join(directory, 'header.css'); await rm(css);
  const elsewhere = path.join(base, 'elsewhere'); await mkdir(elsewhere);
  await symlink(elsewhere, css, 'junction');
  await assert.rejects(loadHeaderBundle(directory), /file_invalid/);
}));
