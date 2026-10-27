import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FileRef } from '../replica-v2/types.js';
import type { Native44ComponentKnowledge } from './knowledge.js';
import { NATIVE44_CATALOG_HASH, CORE_SINGLE_PRODUCT_TYPES, assertAllowedWidget, assertKnownNativeWidget } from './catalog.js';

// Frozen after qualification, independent of the original 44 catalog/index.
export const NATIVE_PRODUCT_EXTENSION_HASH = "e3e037e64334189b577e7503ca6a9189673db5778c42d212afbad8a9ea28c280";
export interface NativeProductExtension {
  version: 1; kind: 'native-component-extension'; id: 'core-single-product-v1';
  baseCatalogHash: string; types: string[]; components: Record<string, { path: string; sha256: string }>;
  sharedControls: FileRef;
  qualification: FileRef;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function assertProductExtensionReference(ref: FileRef | undefined): asserts ref is FileRef {
  if (!ref || ref.sha256 !== NATIVE_PRODUCT_EXTENSION_HASH || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('native_product_extension_not_qualified');
}
async function verified(root: string, ref: FileRef) {
  const filename = await realpath(path.resolve(root, ref.path)), relative = path.relative(await realpath(root), filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('native_product_extension_path');
  const bytes = await readFile(filename); if (hash(bytes) !== ref.sha256) throw Error('native_product_extension_bytes_changed'); return bytes;
}
export function assertProgramNativeWidget(type: string, ref?: FileRef): void {
  if (!ref) return assertAllowedWidget(type);
  assertProductExtensionReference(ref); assertKnownNativeWidget(type);
}
export async function readProductExtension(ref: FileRef, root = 'D:/cloneWP') {
  assertProductExtensionReference(ref);
  const index = JSON.parse((await verified(root, ref)).toString('utf8')) as NativeProductExtension;
  if (index.baseCatalogHash!==NATIVE44_CATALOG_HASH || index.version !== 1 || index.kind !== 'native-component-extension' || index.id !== 'core-single-product-v1' || JSON.stringify(index.types) !== JSON.stringify(CORE_SINGLE_PRODUCT_TYPES) || Object.keys(index.components).length !== 12) throw Error('native_product_extension_identity');
  const qualification = JSON.parse((await verified(root, index.qualification)).toString('utf8'));
  if (qualification.kind !== 'core-product-qualification' || qualification.status !== 'qualified' || qualification.existingPagesModified !== false || !CORE_SINGLE_PRODUCT_TYPES.every(type => qualification.components?.[type]?.registered && qualification.components[type].saved && qualification.components[type].rendered)) throw Error('native_product_extension_qualification');
  if(!Array.isArray(qualification.evidence)||!qualification.evidence.length)throw Error('native_product_extension_evidence_missing');
  for(const evidence of qualification.evidence)await verified(root,evidence);
  const components: Record<string, Native44ComponentKnowledge> = {};
  const shared=JSON.parse((await verified(root,index.sharedControls)).toString('utf8'));
  for (const type of CORE_SINGLE_PRODUCT_TYPES) { const component = JSON.parse((await verified(root, index.components[type])).toString('utf8')); if (component.componentType !== type || !Array.isArray(component.controls)) throw Error('native_product_extension_component'); component.controls=component.controls.map((control:{sharedControl?:string})=>{if(!control.sharedControl)return control;const resolved=shared[control.sharedControl];if(!resolved)throw Error('native_product_extension_shared_control');return resolved;});components[type] = component; }
  return { index, components };
}
export async function currentProductExtension(root = 'D:/cloneWP'): Promise<FileRef | undefined> {
  let pointer: { extension: FileRef };
  try { pointer = JSON.parse(await readFile(path.join(root, 'data/system/component-extension-current.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await readProductExtension(pointer.extension, root); return pointer.extension;
}
