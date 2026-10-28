import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Catalog } from './contract.js';
import { assertConfiguratorRegistered, compileConfiguratorPatch, widgetSettings, type ConfiguratorPatch, type ConfiguratorRegistration } from './compile.js';
import type { ElementorElement } from '../wordpress/types.js';

function sha(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Durable intent for the separate, source-bound edit after an ordinary nonempty native44 composite save. */
export interface ConfiguratorPatchIntent {
  version: 1; kind: 'clonewp-configurator-postsave-patch';
  taskId: string; pageId: number; targetOrigin: string; packageSha256: string;
  slotId: string; widgetId: string; formWidgetId: string;
  baseHash: string; patchedHash: string;
}

export function prepareConfiguratorPatch(input: {
  taskId: string; pageId: number; targetOrigin: string; packageSha256: string;
  registration: ConfiguratorRegistration; baseElements: ElementorElement[];
  catalog: Catalog; slotId: string; widgetId: string;
}): { intent: ConfiguratorPatchIntent; patch: ConfiguratorPatch } {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(input.taskId) || !Number.isSafeInteger(input.pageId) || input.pageId <= 0)
    throw Error('configurator_task_identity');
  assertConfiguratorRegistered(input.registration, input.targetOrigin, input.packageSha256);
  const patch = compileConfiguratorPatch(input.baseElements, input.catalog, input.slotId, input.widgetId);
  assertConfiguratorExactDelta(input.baseElements, patch.elements, input.catalog, input.slotId, input.widgetId);
  return { patch, intent: { version: 1, kind: 'clonewp-configurator-postsave-patch',
    taskId: input.taskId, pageId: input.pageId, targetOrigin: new URL(input.targetOrigin).origin,
    packageSha256: input.packageSha256, slotId: input.slotId, widgetId: input.widgetId,
    formWidgetId: patch.formWidgetId, baseHash: sha(input.baseElements), patchedHash: sha(patch.elements) } };
}

/** A server adapter must recompute the same delta from its fresh stored model and owned media. */
export function assertConfiguratorExactDelta(before: ElementorElement[], after: ElementorElement[], catalog: Catalog,
  slotId: string, widgetId: string): void {
  const expected = compileConfiguratorPatch(before, catalog, slotId, widgetId).elements;
  if (!isDeepStrictEqual(after, expected)) throw Error('configurator_out_of_scope_delta');
}

/** Unknown write response is reconciled against a fresh page read, never retried blindly. */
export function reconcileConfiguratorPatch(intent: ConfiguratorPatchIntent, actualElements: ElementorElement[], expectedElements?: ElementorElement[]): 'not-applied' | 'applied' {
  const actualHash = sha(actualElements);
  if (actualHash === intent.baseHash) return 'not-applied';
  if (actualHash === intent.patchedHash) return 'applied';
  if (expectedElements && sha(expectedElements) === intent.patchedHash && isDeepStrictEqual(actualElements, expectedElements)) return 'applied';
  throw Error('configurator_postsave_conflict');
}

export interface ConfiguratorCatalogRevisionIntent {
  version: 1; kind: 'clonewp-configurator-catalog-revision'; taskId: string; pageId: number; targetOrigin: string;
  slotId: string; widgetId: string; formWidgetId: string; priorOperationId: string;
  baseHash: string; patchedHash: string; settingsHash: string; oldWidgetHash: string; newWidgetHash: string;
}

function media(catalog: Catalog): string[] {
  const refs = [...catalog.bottles, ...catalog.pumps, ...catalog.caps].flatMap(row => [row.image, row.preview]);
  refs.push(...catalog.decorations.flatMap(row => [row.image, ...row.overlays.map(overlay => overlay.image)]));
  refs.push(...Object.values(catalog.placeholders ?? {}).map(row => row.image));
  return [...new Set(refs.map(row => `${row.id}|${row.url}`))].sort();
}

/** A revision has one editable target: the already saved configurator widget settings. */
export function prepareConfiguratorCatalogRevision(input: {
  taskId: string; pageId: number; targetOrigin: string; slotId: string; widgetId: string; formWidgetId: string;
  priorOperationId: string; settingsHash: string; baseElements: ElementorElement[]; oldCatalog: Catalog; newCatalog: Catalog;
}): { intent: ConfiguratorCatalogRevisionIntent; elements: ElementorElement[]; oldWidgetSettings: Record<string, unknown> } {
  const { baseElements, oldCatalog, newCatalog } = input;
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(input.taskId) || !Number.isSafeInteger(input.pageId) || input.pageId < 1 ||
      new URL(input.targetOrigin).origin !== input.targetOrigin || !/^[a-f0-9]{7}$/.test(input.slotId) ||
      !/^[a-f0-9]{7}$/.test(input.widgetId) || !/^[a-f0-9]{7}$/.test(input.formWidgetId) ||
      !/^[A-Za-z0-9_-]{4,100}$/.test(input.priorOperationId) || !/^[a-f0-9]{64}$/.test(input.settingsHash))
    throw Error('configurator_revision_identity');
  if (oldCatalog.form.widgetId !== input.formWidgetId || newCatalog.form.widgetId !== input.formWidgetId ||
      oldCatalog.form.summaryField !== newCatalog.form.summaryField || oldCatalog.form.uploadField !== newCatalog.form.uploadField ||
      !isDeepStrictEqual(media(oldCatalog), media(newCatalog))) throw Error('configurator_revision_media_or_form');
  const elements = structuredClone(baseElements), nodes: ElementorElement[] = [];
  const walk = (rows: ElementorElement[]) => { for (const row of rows) { nodes.push(row); walk(row.elements); } }; walk(elements);
  const find = (id: string) => { const rows = nodes.filter(row => row.id === id); if (rows.length !== 1) throw Error('configurator_revision_tree'); return rows[0]; };
  const slot = find(input.slotId), widget = find(input.widgetId), form = find(input.formWidgetId);
  const oldSettings = widgetSettings(oldCatalog), newSettings = widgetSettings(newCatalog);
  const legacySettings = { ...oldSettings };
  delete (legacySettings as Partial<typeof oldSettings>).filter_groups_json;
  const matchesOldSettings = isDeepStrictEqual(widget.settings, oldSettings) ||
    oldSettings.filter_groups_json === '{}' && !Object.hasOwn(widget.settings, 'filter_groups_json') &&
      isDeepStrictEqual(widget.settings, legacySettings);
  if (slot.elType !== 'container' || slot.elements.at(-1) !== widget || widget.elType !== 'widget' ||
      widget.widgetType !== 'clonewp_bottle_configurator' || widget.elements.length !== 0 ||
      nodes.filter(row => row.widgetType === 'clonewp_bottle_configurator').length !== 1 ||
      form.elType !== 'widget' || form.widgetType !== 'form' || !matchesOldSettings)
    throw Error('configurator_revision_tree');
  const oldWidgetSettings = structuredClone(widget.settings);
  widget.settings = newSettings;
  if (sha(elements) === sha(baseElements)) throw Error('configurator_revision_unchanged');
  return { elements, oldWidgetSettings, intent: { version: 1, kind: 'clonewp-configurator-catalog-revision', taskId: input.taskId,
    pageId: input.pageId, targetOrigin: input.targetOrigin, slotId: input.slotId, widgetId: input.widgetId,
    formWidgetId: input.formWidgetId, priorOperationId: input.priorOperationId,
    baseHash: sha(baseElements), patchedHash: sha(elements), settingsHash: input.settingsHash,
    oldWidgetHash: sha(oldWidgetSettings), newWidgetHash: sha(newSettings) } };
}

export function reconcileConfiguratorCatalogRevision(intent: ConfiguratorCatalogRevisionIntent, actual: ElementorElement[], expected?: ElementorElement[]) {
  const actualHash = sha(actual);
  if (actualHash === intent.baseHash) return 'not-applied' as const;
  if (actualHash === intent.patchedHash || expected && sha(expected) === intent.patchedHash && isDeepStrictEqual(actual, expected))
    return 'applied' as const;
  throw Error('configurator_revision_conflict');
}
