import { readFile, mkdir, open, unlink, statfs, realpath, lstat, rename } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalHeaderJson, headerJsonHash } from '../../woodmart-header/contract.js';
import { validateHeaderModuleIdentity, type HeaderModuleIdentity } from '../../woodmart-header/generic/wordpress.js';
import type { WoodMartHeaderTransport, HeaderPHPWriteIntent } from '../../woodmart-header/transport.js';
import type { FullReplicaRemoteSnapshot } from '../driver.js';
import { loadFullReplicaHeaderHelper } from '../native-helper.js';

export const nativeBackgroundKeys = new Set([
  'background_background', 'background_image', 'background_position', 'background_xpos', 'background_ypos',
  'background_attachment', 'background_repeat', 'background_size', 'background_bg_width', 'background_color',
  'background_overlay_background', 'background_overlay_color', 'background_overlay_color_b',
  'background_overlay_color_stop', 'background_overlay_color_b_stop', 'background_overlay_gradient_type',
  'background_overlay_gradient_angle', 'background_overlay_gradient_position', 'background_overlay_opacity',
]);
export interface BackgroundPatch {
  authorization: 'current-user-background-repair';
  pageId: number;
  nodes: Array<{ id: string; settings: Record<string, unknown> }>;
  css: string;
}
export interface BackgroundObservation {
  snapshot: FullReplicaRemoteSnapshot;
  editorLock: { activeUserId: number | false; currentUserId: number; tokenHash: string };
  receipt: null | { state: 'started' | 'complete'; patchHash: string; beforeHash: string; result?: unknown };
}
interface Revision {
  version: 1; kind: 'clonewp-native-background-revision'; operationId: string; identity: HeaderModuleIdentity;
  state: 'prepared' | 'submitted' | 'unconfirmed' | 'complete';
  patch: BackgroundPatch; patchHash: string; before: BackgroundObservation;
  intentHash: string; after?: BackgroundObservation;
}
type Transport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;
function fail(code: string): never { throw Error(`replica_full_background_${code}`); }
const copy = <T>(value: T): T => JSON.parse(canonicalHeaderJson(value)) as T;
async function checked(input: string, missingFinal = false): Promise<string> {
  const root = await realpath('D:/cloneWP'), target = resolve(input), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('path_escape');
  let current = root; const parts = rel.split(sep);
  for (const [i, part] of parts.entries()) {
    current = join(current, part); let info;
    try { info = await lstat(current); } catch (error) { if (missingFinal && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return target; throw error; }
    if (info.isSymbolicLink() || (await realpath(current)).toLowerCase() !== current.toLowerCase()) fail('path_reparse');
  }
  return target;
}
async function persist(filename: string, value: unknown, newFile = false): Promise<void> {
  await checked(filename, true);
  const free = await statfs(dirname(filename)); if (free.bavail * free.bsize < 512 * 1024 * 1024) fail('disk_space');
  if (newFile) {
    const file = await open(filename, 'wx'); try { await file.writeFile(canonicalHeaderJson(value)); await file.sync(); } finally { await file.close(); } return;
  }
  const temp = join(dirname(filename), `.background-${randomUUID()}.tmp`), file = await open(temp, 'wx');
  try { await file.writeFile(canonicalHeaderJson(value)); await file.sync(); } finally { await file.close(); }
  await rename(temp, filename);
}

export function validateBackgroundPatch(value: BackgroundPatch): BackgroundPatch {
  const p = copy(value);
  if (!p || Object.keys(p).sort().join(',') !== 'authorization,css,nodes,pageId' || p.authorization !== 'current-user-background-repair' || !Number.isSafeInteger(p.pageId) || p.pageId < 1 || !Array.isArray(p.nodes) || !p.nodes.length || p.nodes.length > 12 || new Set(p.nodes.map(n => n.id)).size !== p.nodes.length || typeof p.css !== 'string' || Buffer.byteLength(p.css) > 1_048_576 || /[\0<]/.test(p.css)) fail('patch_invalid');
  for (const node of p.nodes) {
    if (Object.keys(node).sort().join(',') !== 'id,settings' || !/^[A-Za-z0-9_-]{1,100}$/.test(node.id) || !node.settings || typeof node.settings !== 'object' || Array.isArray(node.settings) || !Object.keys(node.settings).length || Object.keys(node.settings).some(key => !nativeBackgroundKeys.has(key))) fail('node_invalid');
    const image = node.settings.background_image as { id?: unknown; url?: unknown } | undefined;
    if (image && (!Number.isSafeInteger(image.id) || Number(image.id) < 1 || typeof image.url !== 'string' || !/^https:\/\//.test(image.url) || Object.keys(image).sort().join(',') !== 'id,url')) fail('media_invalid');
  }
  return p;
}

/** Only these exact container settings and page custom_css may differ. */
export function expectedBackgroundPage(before: FullReplicaRemoteSnapshot, patchInput: BackgroundPatch): NonNullable<FullReplicaRemoteSnapshot['page']> {
  const patch = validateBackgroundPatch(patchInput), page = copy(before.page);
  if (!page || page.pageId !== patch.pageId || !['publish', 'draft'].includes(page.status) || page.template !== 'elementor_header_footer') fail('page_boundary');
  const remaining = new Map(patch.nodes.map(node => [node.id, node.settings]));
  const seen = new Set<string>();
  const walk = (nodes: typeof page.elements): void => {
    for (const node of nodes) {
      if (seen.has(node.id)) fail('duplicate_node'); seen.add(node.id);
      const settings = remaining.get(node.id);
      if (settings) {
        if (node.elType !== 'container') fail('container_required');
        node.settings = { ...node.settings, ...settings }; remaining.delete(node.id);
      }
      if (node.elements) walk(node.elements);
    }
  };
  walk(page.elements); if (remaining.size) fail('node_missing');
  page.settings = { ...page.settings, custom_css: patch.css }; return page;
}

export function assertBackgroundReadback(before: FullReplicaRemoteSnapshot, after: FullReplicaRemoteSnapshot, patch: BackgroundPatch): void {
  const expected = expectedBackgroundPage(before, patch), actual = copy(after.page);
  if (!actual) fail('readback_missing');
  expected.bodyHash = actual.bodyHash;
  if (headerJsonHash(expected) !== headerJsonHash(actual)) fail('page_changed');
  const a = copy(before.header), b = copy(after.header), id = String(patch.pageId);
  if (!a.snapshot.module?.pages[id] || !b.snapshot.module?.pages[id]) fail('header_owner');
  a.hash = b.hash;
  a.snapshot.module.pages[id].bodyHash = b.snapshot.module.pages[id].bodyHash;
  a.snapshot.module.pages[id].snapshotHash = b.snapshot.module.pages[id].snapshotHash;
  if (headerJsonHash(a) !== headerJsonHash(b) || headerJsonHash(before.receipts) !== headerJsonHash(after.receipts)) fail('protected_changed');
}

/** Independent amendment. Existing published checkpoints and draft-only actions are untouched. */
export class WordPressBackgroundRevision {
  constructor(private readonly transport: Transport) {}
  private async code(identityInput: HeaderModuleIdentity, data: Record<string, unknown>): Promise<string> {
    const identity = validateHeaderModuleIdentity(identityInput);
    if (identity.targetOrigin !== this.transport.origin) fail('target_mismatch');
    const [header, full, helper] = await Promise.all([
      loadFullReplicaHeaderHelper(), readFile(new URL('../wordpress-full.php', import.meta.url), 'utf8'),
      readFile(new URL('./wordpress.php', import.meta.url), 'utf8'),
    ]);
    const input = Buffer.from(canonicalHeaderJson({ identity, ...data })).toString('base64');
    return `$headerRead=static function($input){${header}\n};\n$fullRead=static function($input)use($headerRead){${full}\n};\n$input=json_decode(base64_decode('${input}'),true);\n${helper}`;
  }
  private unwrap(value: unknown): BackgroundObservation {
    const r = value as { ok?: boolean; code?: string; value?: BackgroundObservation };
    if (r?.ok !== true || !r.value?.snapshot || !r.value.editorLock) fail(r?.code && /^background_[a-z0-9_]+$/.test(r.code) ? r.code : 'unconfirmed');
    return r.value;
  }
  async inspect(identity: HeaderModuleIdentity, operationId?: string): Promise<BackgroundObservation> {
    if (operationId && !/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) fail('operation_invalid');
    return this.unwrap(await this.transport.readPHP({ name: 'full-background.inspect', trustedLocalCode: true, code: await this.code(identity, { action: 'inspect', ...(operationId ? { operationId } : {}) }) }));
  }
  async controls(identity: HeaderModuleIdentity): Promise<unknown> {
    return this.transport.readPHP({ name: 'full-background.controls', trustedLocalCode: true, code: await this.code(identity, { action: 'controls' }) });
  }
  async prepare(directory: string, identity: HeaderModuleIdentity, patchInput: BackgroundPatch): Promise<Revision> {
    directory = await checked(directory, true);
    const patch = validateBackgroundPatch(patchInput), before = await this.inspect(identity);
    expectedBackgroundPage(before.snapshot, patch);
    if (before.editorLock.activeUserId && before.editorLock.activeUserId !== before.editorLock.currentUserId) fail('other_editor');
    await mkdir(directory, { recursive: false });
    const free = await statfs(directory); if (free.bavail * free.bsize < 512 * 1024 * 1024) fail('disk_space');
    const operationId = `background-${randomUUID()}`;
    const intent = { version: 1 as const, kind: 'clonewp-native-background-revision' as const, operationId, identity: validateHeaderModuleIdentity(identity), patch, patchHash: headerJsonHash(patch), before };
    const revision: Revision = { ...intent, intentHash: headerJsonHash(intent), state: 'prepared' };
    await persist(join(directory, 'revision.json'), revision, true);
    await persist(join(directory, 'expected-page.json'), expectedBackgroundPage(before.snapshot, patch), true);
    return revision;
  }
  private async load(directory: string): Promise<Revision> {
    const r = JSON.parse(await readFile(await checked(join(directory, 'revision.json')), 'utf8')) as Revision;
    const { state: _state, after: _after, intentHash, ...intent } = r;
    if (r.version !== 1 || r.kind !== 'clonewp-native-background-revision' || headerJsonHash(intent) !== intentHash || headerJsonHash(validateBackgroundPatch(r.patch)) !== r.patchHash) fail('intent_changed');
    return r;
  }
  async apply(directory: string): Promise<Revision> { return this.run(directory, false); }
  async reconcile(directory: string): Promise<Revision> { return this.run(directory, true); }
  private async run(directory: string, reconcile: boolean): Promise<Revision> {
    directory = await checked(directory);
    const file = join(directory, 'revision.json'), lock = await checked(join(directory, '.lock'), true);
    const handle = await open(lock, 'wx');
    try {
      const r = await this.load(directory), observed = await this.inspect(r.identity, r.operationId);
      if (observed.receipt?.state === 'complete') {
        if (observed.receipt.patchHash !== r.patchHash || observed.receipt.beforeHash !== r.before.snapshot.hash) fail('receipt_changed');
        assertBackgroundReadback(r.before.snapshot, observed.snapshot, r.patch); r.state = 'complete'; r.after = observed;
        await persist(file, r); return r;
      }
      if (r.state === 'complete') fail('receipt_missing');
      if (reconcile && !observed.receipt) fail('not_submitted');
      if (!reconcile && (r.state !== 'prepared' || observed.receipt)) fail('reconcile_required');
      if (!reconcile && observed.snapshot.hash !== r.before.snapshot.hash) fail('snapshot_changed');
      if (reconcile) assertBackgroundReadback(r.before.snapshot, observed.snapshot, r.patch);
      const intent: HeaderPHPWriteIntent = { operationId: r.operationId, runId: r.identity.owner.runId, resource: `background-revision/${r.identity.moduleKey}`, expectedSnapshotSha256: observed.snapshot.hash, persistedIntentSha256: r.intentHash };
      r.state = 'submitted'; await persist(file, r);
      try {
        const after = this.unwrap(await this.transport.executePHP({ name: reconcile ? 'full-background.confirm' : 'full-background.apply', trustedLocalCode: true, intent,
          code: await this.code(r.identity, { action: reconcile ? 'confirm' : 'apply', operationId: r.operationId, expectedHash: observed.snapshot.hash, beforeHash: r.before.snapshot.hash, patchHash: r.patchHash, patch: r.patch, before: r.before.snapshot, approvedEditorLock: r.before.editorLock }) }));
        assertBackgroundReadback(r.before.snapshot, after.snapshot, r.patch);
        if (after.receipt?.state !== 'complete' || after.receipt.patchHash !== r.patchHash) fail('receipt_unconfirmed');
        r.state = 'complete'; r.after = after; await persist(file, r); return r;
      } catch (error) { r.state = 'unconfirmed'; await persist(file, r); throw error; }
    } finally { await handle.close(); await unlink(lock); }
  }
}
