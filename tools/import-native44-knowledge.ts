import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { assertAllowedWidget, NATIVE44_ALL_TYPES, NATIVE44_CATALOG_HASH, NATIVE44_REQUIRED_ENVIRONMENT, validateNative44Catalog } from '../src/native44/catalog.js';
import { native44Usage } from '../src/native44/recipes.js';
import type { Native44Control, Native44ComponentKnowledge, Native44KnowledgeIndex } from '../src/native44/knowledge.js';

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
const sourceHash = (value: unknown) => sha(json(stable(value)));
export function verifyImportedSourceIntegrity(manual: any, effects: any, coverage: any): void {
  if (manual.manualHash !== sourceHash({ ...manual, generatedAt: undefined, manualHash: undefined, validation: undefined })) throw new Error('native44_source_manual_content_hash_mismatch');
  if (effects.modelHash !== sourceHash({ ...effects, modelHash: undefined })) throw new Error('native44_source_effect_content_hash_mismatch');
  for (const record of effects.records || []) if (record.recordHash !== sourceHash({ ...record, recordHash: undefined })) throw new Error(`native44_source_effect_record_hash_mismatch: ${record.componentType}`);
  if (coverage.coverageHash !== sourceHash({ ...coverage, generatedAt: undefined, coverageHash: undefined })) throw new Error('native44_source_coverage_content_hash_mismatch');
  if (coverage.status !== 'ready' || Object.values(coverage.gates || {}).some(value => value !== true) || coverage.source?.complete !== 44 || coverage.manual?.complete !== 44) throw new Error('native44_source_coverage_not_ready');
}
const dynamicIds = /^(?:ids|include|exclude|taxonomies|categories|brands|brand|form_id|contact_form_id|sidebar|sidebar_id|sidebar_name|query_posts_ids|query_exclude_ids|posts_ids|menu_id|remote_id|local_id)$/;
const businessAction = /(?:api_key|api_token|webhook|email_(?:to|from|reply|subject|content)|redirect_to|submit_actions|form_id|mailchimp_list|activecampaign_list)/;

/** Defaults are for safe mode drivers, never old laboratory content or resource identities. */
export function normalizeImportedControl(raw: any, contentIds: Set<string>): Native44Control {
  const control = structuredClone(raw) as Native44Control;
  const dynamic = dynamicIds.test(control.id) || /(?:autocomplete|^query$)/.test(String(control.type)) || Boolean(control.runtimeContract?.autocomplete || control.runtimeContract?.objectType)
    || (control.valueDomain?.options || []).some(option => /^\d+$/.test(String(option.value)) && ['select2', 'selectize', 'xts_autocomplete'].includes(String(control.type)));
  const content = contentIds.has(control.id) || ['media', 'gallery', 'url', 'wysiwyg', 'code', 'textarea'].includes(String(control.type));
  if (dynamic || businessAction.test(control.id)) {
    delete control.defaultValue; control.responsiveDefaults = {}; control.defaultPolicy = 'task-resource-required';
    if (control.valueDomain) control.valueDomain.options = [];
  } else if (content || control.repeater) {
    delete control.defaultValue; control.responsiveDefaults = {}; control.defaultPolicy = 'task-content-required';
  } else {
    control.defaultPolicy = 'source-declared';
  }
  if (control.valueDomain) {
    delete control.valueDomain.calibrationSamples;
    delete control.valueDomain.calibrationSampleKind;
  }
  // Imported declarations describe the source contract; no historical concrete URL may become a default.
  const unsafeDefault = (value: unknown): boolean => typeof value === 'string' ? /https?:\/\/|@[^\s]+\.[a-z]{2,}/i.test(value)
    : Array.isArray(value) ? value.some(unsafeDefault)
      : value && typeof value === 'object' ? Object.values(value).some(unsafeDefault) : false;
  if (unsafeDefault(control.defaultValue)) { delete control.defaultValue; control.defaultPolicy = 'task-content-required'; }
  if (control.repeater) control.repeater.fields = control.repeater.fields.map(field => normalizeImportedControl(field, contentIds));
  return control;
}
function zipEntry(bytes: Buffer, name: string): string {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('native44_package_zip_directory_missing');
  let offset = bytes.readUInt32LE(end + 16); const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('native44_package_zip_directory_invalid');
    const compression = bytes.readUInt16LE(offset + 10); const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28); const extraLength = bytes.readUInt16LE(offset + 30); const commentLength = bytes.readUInt16LE(offset + 32);
    const entry = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); const local = bytes.readUInt32LE(offset + 42);
    if (entry === name) {
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28); const data = bytes.subarray(start, start + compressedSize);
      if (![0, 8].includes(compression)) throw new Error('native44_package_zip_compression_unsupported');
      return (compression === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`native44_package_header_missing: ${name}`);
}
async function verifyPackages(expectedHashes: Record<string, string>): Promise<NonNullable<Native44KnowledgeIndex['source']['packages']>> {
  const definitions = {
    woodmart: { path: 'C:/Users/Administrator/Desktop/work tool/Theme/WoodMart 8.5.5/1-主题安装包/woodmart.zip', header: 'woodmart/style.css', version: '8.5.5' },
    'woodmart-core': { path: 'C:/Users/Administrator/Desktop/work tool/Theme/WoodMart 8.5.5/2-配套插件/woodmart-core.zip', header: 'woodmart-core/woodmart-core.php', version: '1.1.8' },
    elementor: { path: 'C:/Users/Administrator/Desktop/work tool/Plugin/Elementor 3.35.4 Pro 3.35.1/elementor.3.35.4.zip', header: 'elementor/elementor.php', version: '3.35.4' },
    'elementor-pro': { path: 'C:/Users/Administrator/Desktop/work tool/Plugin/Elementor 3.35.4 Pro 3.35.1/elementor-pro_3.35.1.zip', header: 'elementor-pro/elementor-pro.php', version: '3.35.1' },
  };
  const result: NonNullable<Native44KnowledgeIndex['source']['packages']> = {};
  for (const [id, definition] of Object.entries(definitions)) {
    const bytes = await readFile(definition.path); const digest = sha(bytes);
    if (digest !== expectedHashes[id]) throw new Error(`native44_package_hash_mismatch: ${id}`);
    const header = zipEntry(bytes, definition.header); const version = header.match(/^[ \t*]*Version:\s*([^\r\n]+)/im)?.[1]?.trim();
    if (version !== definition.version) throw new Error(`native44_package_version_mismatch: ${id} ${version}`);
    result[id] = { ...definition, sha256: digest };
  }
  return result;
}
export async function importNative44Knowledge(sourceRoot = 'D:/Cloneweb', projectRoot = 'D:/cloneWP'): Promise<Native44KnowledgeIndex> {
  const started = Date.now();
  const catalogPath = path.join(sourceRoot, 'config/component-set.json');
  const catalogBytes = await readFile(catalogPath); const catalog = JSON.parse(catalogBytes.toString('utf8'));
  validateNative44Catalog(catalog);
  if (sha(catalogBytes) !== NATIVE44_CATALOG_HASH) throw new Error('native44_source_catalog_changed');
  const sourceIndexPath = path.join(sourceRoot, 'data/component-knowledge/index.json');
  const sourceIndexBytes = await readFile(sourceIndexPath); const sourceIndex = JSON.parse(sourceIndexBytes.toString('utf8'));
  const refs = { index: sourceIndexPath, manual: path.join(sourceRoot, sourceIndex.componentManual), effects: path.join(sourceRoot, sourceIndex.componentEffectModel), coverage: path.join(sourceRoot, sourceIndex.componentCoverage) };
  const files: Native44KnowledgeIndex['source']['files'] = {};
  const readSource = async (key: keyof typeof refs) => {
    const bytes = await readFile(refs[key]); files[key] = { path: refs[key].replaceAll('\\', '/'), sha256: sha(bytes), bytes: bytes.byteLength };
    return JSON.parse(bytes.toString('utf8'));
  };
  await readSource('index');
  const manual = await readSource('manual'); const effects = await readSource('effects'); const coverage = await readSource('coverage');
  verifyImportedSourceIntegrity(manual, effects, coverage);
  if (manual.environment.fingerprint !== sourceIndex.activeFingerprint || effects.environmentFingerprint !== sourceIndex.activeFingerprint || effects.manualHash !== manual.manualHash || sourceIndex.coverageHash !== coverage.coverageHash) throw new Error('native44_source_knowledge_identity_mismatch');
  if (manual.components.length !== 44 || new Set(manual.components.map((component: any) => component.componentType)).size !== 44) throw new Error('native44_manual_identity_count');
  const packages = await verifyPackages(manual.environment.packageHashes);
  const out = path.join(projectRoot, 'data/native44'); await mkdir(path.join(out, 'components'), { recursive: true });
  await mkdir(path.join(projectRoot, 'config'), { recursive: true });
  await writeFile(path.join(projectRoot, 'config/native44-component-set.json'), catalogBytes);
  const normalized: Native44ComponentKnowledge[] = manual.components.map((component: any) => {
    assertAllowedWidget(component.componentType);
    const slots = component.semanticSlots as Record<string, string[]>;
    const usage = native44Usage(component.componentType, component.controls.filter((control: any) => control.repeater).map((control: any) => control.id));
    const contentIds = new Set([...slots.text, ...slots.richText, ...slots.media, ...slots.link, ...usage.primaryContentFields]);
    const controls = component.controls.map((control: any) => normalizeImportedControl(control, contentIds));
    const records = effects.records.map((record: any, index: number) => ({ record, index })).filter(({ record }: any) => record.componentType === component.componentType);
    const interactions = records.map(({ record }: any) => record.proof?.measurement?.interaction).filter((interaction: any) => interaction?.attempted);
    const evidence: Native44ComponentKnowledge['evidence'] = {
      sourceStudied: component.sourceOwnership?.status === 'source-complete', targetRegistered: false,
      usageVerified: records.length > 0 && !['wd_compare', 'wd_sidebar', 'breadcrumbs', 'html'].includes(component.componentType) ? 'historical-qualified' : 'source-only',
      resourceBlocked: usage.resourceDependencies,
      historicalEnvironmentFingerprint: sourceIndex.activeFingerprint, historicalCore: manual.environment.stack.woodmartCore, targetCore: NATIVE44_REQUIRED_ENVIRONMENT.woodmartCore,
      effectRecordCount: records.length, interactionAttempts: interactions.length, interactionChanged: interactions.filter((interaction: any) => interaction.changed).length,
      runtimeRetestRequired: ['目标环境 1.1.8 运行层尚未验证，不能沿用旧 Core 1.1.6 的完整证明', ...usage.interactionRequirements],
      records: records.map(({ record, index }: any) => ({ index, hash: record.recordHash || sha(json(record)), controls: record.coveredControlIds || [], scope: record.evidenceScope || 'unknown' })),
    };
    return {
      componentType: component.componentType, title: component.title, controls, semanticSlots: slots, usage,
      ...(usage.nested ? { nested: usage.nested } : {}), sourceOwnership: component.sourceOwnership,
      renderModel: component.renderModel, runtimeAssets: component.runtimeAssets, runtimeIdentity: component.runtimeIdentity,
      modes: (component.modeGraph?.drivers || []).filter((driver: any) => controls.find((control: Native44Control) => control.id === driver.controlId)?.defaultPolicy === 'source-declared').map((driver: any) => ({ controlId: driver.controlId, values: (driver.modes || []).map((mode: any) => mode.value) })),
      evidence,
    } as Native44ComponentKnowledge;
  });
  // Share identical advanced declarations. Component-specific provenance remains on each profile.
  const occurrences = new Map<string, { control: Native44Control; count: number }>();
  for (const component of normalized) for (const control of component.controls) {
    const key = sha(json(control)); const occurrence = occurrences.get(key);
    if (occurrence) occurrence.count++; else occurrences.set(key, { control, count: 1 });
  }
  const shared = Object.fromEntries([...occurrences].filter(([, row]) => row.count > 1 && row.control.panel?.tab === 'advanced').map(([key, row]) => [key, row.control]));
  const sharedBytes = Buffer.from(json(shared)); await writeFile(path.join(out, 'shared-controls.json'), sharedBytes);
  const componentRefs: Native44KnowledgeIndex['components'] = {};
  for (const component of normalized) {
    const stored = { ...component, controls: component.controls.map(control => { const key = sha(json(control)); return shared[key] ? { sharedControl: key } : control; }) };
    const bytes = Buffer.from(json(stored)); const relative = `components/${component.componentType}.json`;
    await writeFile(path.join(out, relative), bytes);
    componentRefs[component.componentType] = { path: relative, sha256: sha(bytes), controlCount: component.controls.length };
  }
  const identity: Omit<Native44KnowledgeIndex, 'fingerprint'> = {
    schemaVersion: 1, artifactType: 'native44-knowledge', catalogHash: NATIVE44_CATALOG_HASH,
    requiredEnvironment: NATIVE44_REQUIRED_ENVIRONMENT, historicalEnvironment: manual.environment.stack,
    source: { fingerprint: sourceIndex.activeFingerprint, files, packageHashes: manual.environment.packageHashes, packages },
    sharedControls: { path: 'shared-controls.json', sha256: sha(sharedBytes), count: Object.keys(shared).length }, components: componentRefs,
    coverage: { source: coverage.source, manual: coverage.manual, effects: coverage.effects, calibration: coverage.calibration, historicalOnly: true, targetRuntimeVerified: false },
    restrictions: ['日常任务按实际使用组件读取；不运行 Cloneweb 建站或凭据流程', '来源实验资源只作证据，不作为配方默认值', '本地源码合同与目标注册合同须取已验证交集', '设置覆盖不等于所有模式、资源及交互均已验证'],
  };
  const index: Native44KnowledgeIndex = { ...identity, fingerprint: sha(json(identity)) };
  await writeFile(path.join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  const generatedBytes = (await Promise.all(['index.json', 'shared-controls.json', ...Object.values(componentRefs).map(ref => ref.path)].map(async name => (await stat(path.join(out, name))).size))).reduce((sum, bytes) => sum + bytes, 0);
  await writeFile(path.join(out, 'import-metrics.json'), JSON.stringify({ importedAt: new Date().toISOString(), durationMs: Date.now() - started, sourceBytes: Object.values(files).reduce((sum, ref) => sum + ref.bytes, 0), generatedBytes, components: 44, sharedAdvancedControls: Object.keys(shared).length, sourceFingerprint: sourceIndex.activeFingerprint, knowledgeFingerprint: index.fingerprint }, null, 2) + '\n');
  return index;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importNative44Knowledge().then(index => console.log(JSON.stringify({ fingerprint: index.fingerprint, components: Object.keys(index.components).length, sharedAdvancedControls: index.sharedControls.count }))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
