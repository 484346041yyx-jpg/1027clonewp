import { catalogSchema, type Catalog } from './contract.js';
import type { ConfiguratorSourceCatalog } from './source.js';
import type { Native44Asset } from '../native44/media.js';
import type { ImportedAssetV2 } from '../replica-v2/types.js';
import type { ConfiguratorOwnedAsset } from './driver.js';

/** Bind a frozen source catalog to attachments owned by this one page. */
export function bindConfiguratorCatalog(input: {
  template: ConfiguratorSourceCatalog; sourceImages: Native44Asset[]; mediaKeys: readonly string[];
  imported: ImportedAssetV2[]; formWidgetId: string; summaryField: string; uploadField: string;
}): { catalog: Catalog; assets: ConfiguratorOwnedAsset[] } {
  const keys = new Set(input.mediaKeys);
  if (keys.size !== input.mediaKeys.length || input.sourceImages.length !== keys.size ||
      input.sourceImages.some(image => !keys.has(image.key)) ||
      new Set(input.sourceImages.map(image => image.key)).size !== keys.size)
    throw Error('configurator_binding_source_keys');
  const source = new Map(input.sourceImages.map(image => [image.key, image]));
  const imported = new Map(input.imported.filter(asset => keys.has(asset.key)).map(asset => [asset.key, asset]));
  if (imported.size !== keys.size) throw Error('configurator_binding_imported_keys');
  const used = new Set<string>();
  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      if (Object.hasOwn(row, '$asset')) {
        if (Object.keys(row).length !== 1 || typeof row.$asset !== 'string' || !keys.has(row.$asset)) throw Error('configurator_binding_asset_ref');
        const original = source.get(row.$asset)!, actual = imported.get(row.$asset)!;
        if (original.sha256 !== actual.sha256 || original.mediaType !== actual.mimeType ||
            !Number.isSafeInteger(actual.attachmentId) || actual.attachmentId <= 0 || !actual.url.startsWith('https://'))
          throw Error('configurator_binding_asset_changed');
        used.add(row.$asset);
        return { id: actual.attachmentId, url: actual.url };
      }
      if (Object.hasOwn(row, '$nativeFormBinding')) throw Error('configurator_binding_form_position');
      return Object.fromEntries(Object.entries(row).map(([key, child]) => [key, bind(child)]));
    }
    return value;
  };
  if (input.template.form?.$nativeFormBinding !== true || !/^[a-f0-9]{7}$/.test(input.formWidgetId) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(input.summaryField) || !/^[A-Za-z0-9_-]{1,80}$/.test(input.uploadField))
    throw Error('configurator_binding_form');
  const { form: _form, ...template } = input.template;
  const catalog = catalogSchema.parse({ ...bind(template) as object,
    form: { widgetId: input.formWidgetId, summaryField: input.summaryField, uploadField: input.uploadField } });
  if (used.size !== keys.size) throw Error('configurator_binding_unused_source_media');
  const assets = [...new Map([...used].map(key => { const asset = imported.get(key)!;
    return [asset.attachmentId, { id: asset.attachmentId, url: asset.url, sha256: asset.sha256 }]; })).values()];
  if (assets.length !== new Set(assets.map(asset => asset.id)).size) throw Error('configurator_binding_asset_identity');
  return { catalog, assets };
}
