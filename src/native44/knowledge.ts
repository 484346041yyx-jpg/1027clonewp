import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertAllowedWidget, NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH, NATIVE44_REQUIRED_ENVIRONMENT } from './catalog.js';
import type { Native44NestedRelation, Native44Usage } from './recipes.js';
import { assertNative44RegisteredSettings, assertNative44Settings, expandedNative44Controls } from './settings.js';
import { currentProductExtension, readProductExtension, assertProgramNativeWidget } from './product-extension.js';
import type { FileRef } from '../replica-v2/types.js';
import { assertKnownNativeWidget } from './catalog.js';

export interface Native44Condition { type: 'group' | 'predicate'; operator?: string; terms?: Native44Condition[]; field?: string; value?: unknown; scope?: string }
export interface Native44Control {
  id: string; scope?: string; type?: string;
  label?: string | null; panel?: { tab?: string; section?: string };
  valueDomain?: { type?: string; options?: { value: unknown; label?: string }[]; min?: number; max?: number; step?: number; size_units?: string[]; range?: Record<string, { min?: number; max?: number; step?: number }>; [key: string]: unknown };
  defaultValue?: unknown; responsiveDefaults?: Record<string, unknown>; responsive?: boolean; devices?: string[];
  condition?: Native44Condition | null; effectTargets?: unknown; jsonPath?: string; effectClass?: string;
  sourceEvidence?: unknown; runtimeEvidence?: unknown; controlTypeEvidence?: unknown; runtimeContract?: Record<string, unknown> | null;
  savePolicy?: string; repeater?: { itemIdentityField?: string; fields: Native44Control[] } | null;
  defaultPolicy?: 'source-declared' | 'task-resource-required' | 'task-content-required';
}
export interface Native44ComponentKnowledge {
  componentType: string; title: string; controls: Native44Control[];
  semanticSlots: Record<string, string[]>; usage: Native44Usage; nested?: Native44NestedRelation;
  sourceOwnership: unknown; renderModel: unknown; runtimeAssets: unknown; runtimeIdentity: unknown;
  modes: { controlId: string; values: unknown[] }[];
  evidence: {
    sourceStudied: boolean; targetRegistered: false; usageVerified: 'historical-qualified' | 'source-only'; resourceBlocked: string[];
    historicalEnvironmentFingerprint: string; historicalCore: string; targetCore: string;
    effectRecordCount: number; interactionAttempts: number; interactionChanged: number;
    runtimeRetestRequired: string[]; records: { index: number; hash: string; controls: string[]; scope: string }[];
  };
}
interface ComponentFile extends Omit<Native44ComponentKnowledge, 'controls'> { controls: (Native44Control | { sharedControl: string })[] }
export interface Native44KnowledgeIndex {
  schemaVersion: 1; artifactType: 'native44-knowledge'; fingerprint: string; catalogHash: string;
  requiredEnvironment: typeof NATIVE44_REQUIRED_ENVIRONMENT; historicalEnvironment: Record<string, unknown>;
  source: { fingerprint: string; files: Record<string, { path: string; sha256: string; bytes: number }>; packageHashes: Record<string, string>; packages?: Record<string, { path: string; sha256: string; header: string; version: string }> };
  sharedControls: { path: string; sha256: string; count: number };
  components: Record<string, { path: string; sha256: string; controlCount: number }>;
  coverage: unknown; restrictions: string[];
}
export interface Native44Knowledge { extension?: Awaited<ReturnType<typeof readProductExtension>>; index: Native44KnowledgeIndex; sharedControls: Record<string, Native44Control>; components: Record<string, Native44ComponentKnowledge> }
export const DEFAULT_NATIVE44_KNOWLEDGE_DIR = 'D:/cloneWP/data/native44';
function hash(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function contained(root: string, name: string): string {
  const resolved = path.resolve(root, name); const relative = path.relative(path.resolve(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`native44_knowledge_path_escape: ${name}`);
  return resolved;
}
async function verifiedJson<T>(root: string, ref: { path: string; sha256: string }): Promise<T> {
  const bytes = await readFile(contained(root, ref.path));
  if (hash(bytes) !== ref.sha256) throw new Error(`native44_knowledge_hash_mismatch: ${ref.path}`);
  return JSON.parse(bytes.toString('utf8')) as T;
}
/** Daily use reads only the index, shared contract and components actually used by a page. */
export async function loadNative44Knowledge(usedTypes: readonly string[] = NATIVE44_ALL_TYPES, root = DEFAULT_NATIVE44_KNOWLEDGE_DIR, extension?: FileRef): Promise<Native44Knowledge> {
  if (new Set(usedTypes).size !== usedTypes.length) throw new Error('native44_duplicate_component_request');
  for (const type of usedTypes) assertProgramNativeWidget(type, extension);
  const extended = extension ? await readProductExtension(extension, path.resolve(root,'../..')) : undefined;
  const index = JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8')) as Native44KnowledgeIndex;
  if (index.schemaVersion !== 1 || index.artifactType !== 'native44-knowledge' || index.catalogHash !== NATIVE44_CATALOG_HASH) throw new Error('native44_knowledge_index_invalid');
  if (JSON.stringify(index.requiredEnvironment) !== JSON.stringify(NATIVE44_REQUIRED_ENVIRONMENT)) throw new Error('native44_knowledge_environment_contract_mismatch');
  const { fingerprint, ...identity } = index;
  if (hash(JSON.stringify(identity)) !== fingerprint) throw new Error('native44_knowledge_fingerprint_mismatch');
  const indexed = Object.keys(index.components);
  if (indexed.length !== 44 || indexed.some(type => !NATIVE44_ALL_TYPES.includes(type as any))) throw new Error('native44_knowledge_catalog_mismatch');
  const sharedControls = await verifiedJson<Record<string, Native44Control>>(root, index.sharedControls);
  const components: Record<string, Native44ComponentKnowledge> = {};
  await Promise.all(usedTypes.map(async type => {
    if (extended?.components[type]) { components[type] = extended.components[type]; return; }
    const stored = await verifiedJson<ComponentFile>(root, index.components[type]!);
    if (stored.componentType !== type) throw new Error(`native44_component_identity_mismatch: ${type}`);
    const controls = stored.controls.map(control => {
      if (!('sharedControl' in control)) return control;
      const shared = sharedControls[control.sharedControl];
      if (!shared) throw new Error(`native44_shared_control_missing: ${type}.${control.sharedControl}`);
      return shared;
    });
    if (new Set(controls.map(control => control.id)).size !== controls.length) throw new Error(`native44_duplicate_controls: ${type}`);
    components[type] = { ...stored, controls };
  }));
  return { ...(extended?{extension:extended}:{}), index, sharedControls, components };
}
export async function native44KnowledgeIdentity(root = 'D:/cloneWP',options:{componentExtension?:FileRef}={}): Promise<{
  componentExtension?: FileRef; componentCatalog: { path: string; sha256: string }; knowledge: { path: string; sha256: string; fingerprint: string }; targetEnvironment: typeof NATIVE44_REQUIRED_ENVIRONMENT;
}> {
  const indexPath = path.join(root, 'data/native44/index.json'); const bytes = await readFile(indexPath);
  const index = JSON.parse(bytes.toString('utf8')) as Native44KnowledgeIndex;
  const { fingerprint, ...identity } = index;
  if (index.catalogHash !== NATIVE44_CATALOG_HASH || hash(JSON.stringify(identity)) !== fingerprint) throw new Error('native44_knowledge_identity_invalid');
  const componentExtension = options.componentExtension; if(componentExtension)await readProductExtension(componentExtension,root);
  return { ...(componentExtension ? { componentExtension:{...componentExtension,path:path.resolve(root,componentExtension.path)} } : {}), componentCatalog: { path: path.join(root, 'config/native44-component-set.json'), sha256: NATIVE44_CATALOG_HASH }, knowledge: { path: indexPath, sha256: hash(bytes), fingerprint }, targetEnvironment: NATIVE44_REQUIRED_ENVIRONMENT };
}
export function toNative44CompilerKnowledge(loaded: Native44Knowledge, schemas?: Record<string, { controls: Record<string, unknown> }>): {
  fingerprint: string; controlsByWidget: Record<string, ReadonlySet<string>>;
  styleControlsByWidget: Record<string, Native44Control[]>;
  validateSettings: (widgetType: string, settings: Record<string, unknown>) => Record<string, unknown>;
} {
  const controlsByWidget = Object.fromEntries(Object.entries(loaded.components).map(([type, component]) => [type, new Set(expandedNative44Controls(component.controls).keys())]));
  return {
    fingerprint: loaded.index.fingerprint, controlsByWidget, styleControlsByWidget: Object.fromEntries(Object.entries(loaded.components).map(([type, component]) => [type, component.controls])),
    validateSettings(type, settings) {
      loaded.extension ? assertKnownNativeWidget(type) : assertAllowedWidget(type);
      const component = loaded.components[type]; if (!component) throw new Error(`native44_knowledge_component_not_loaded: ${type}`);
      const solved = assertNative44Settings(component, settings, schemas?.[type]?.controls).settings;
      if (schemas?.[type]?.controls) assertNative44RegisteredSettings(component, solved, schemas[type].controls);
      return solved;
    },
  };
}
