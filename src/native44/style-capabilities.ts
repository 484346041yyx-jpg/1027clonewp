import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import * as css from 'css-tree';
import { assertKnownNativeWidget as assertAllowedWidget, NATIVE44_ALL_TYPES } from './catalog.js';
import type { Native44Condition, Native44Control, Native44Knowledge } from './knowledge.js';

export type Native44StyleCapabilityCategory = 'component-style' | 'shared-advanced' | 'container-layout' | 'content-visual-driver' | 'content-resource' | 'editor-only' | 'custom-css' | 'business-action' | 'unresolved';
export type Native44StyleMechanism = 'selector-setting' | 'class-setting' | 'frontend-setting' | 'condition-driver' | 'template-driver' | 'resource-binding' | 'not-native-style' | 'unresolved';
export interface Native44StyleEffect {
  selector: string; property: string; template: string; dictionaryValue?: string;
  cssVariable: boolean; states: string[];
}
export interface Native44StyleVariableConsumer {
  variable: string; selector: string; property: string; value: string; direct: boolean; atRules: string[];
  packageId: string; packageSha256: string; entry: string; sourceSha256: string;
}
export interface Native44StyleWrapperClassProof {
  className: string; method: 'get_html_wrapper_class' | 'add_render_attributes'; symbol: string;
  expression: 'literal-return' | 'get-name-concatenation' | 'literal-wrapper-render-attribute';
  packageId: string; packageSha256: string; entry: string; sourceSha256: string;
  inheritance: { symbol: string; packageId: string; packageSha256: string; entry: string; sourceSha256: string }[];
  getNameProof?: { symbol: string; name: string; packageId: string; packageSha256: string; entry: string; sourceSha256: string };
}
export type Native44StyleWrapperClass = Native44StyleWrapperClassProof;
export interface Native44StyleControlCapability {
  ref: string; controlId: string; repeaterPath: string[]; panel: { tab: string | null; section: string | null };
  category: Native44StyleCapabilityCategory; mechanism: Native44StyleMechanism; nativeStyleEligible: boolean;
  control: Native44Control; effects: Native44StyleEffect[]; opaqueSelectorTemplates: { selector: string; template: string; dictionaryValue?: string }[];
  prefixClass: string | null; frontendAvailable: boolean; renderType: string | null; selectorsDictionary: Record<string, unknown> | null;
  dependencyFields: { field: string; scope: string }[]; drivesControls: string[];
  templateDependencyFields: { field: string; token: string; scope: string }[]; templateDrivesControls: string[]; declaredDevices: string[];
  evidence: { knowledgeFingerprint: string; sourceDeclaration: unknown; controlType: unknown; historicalRuntime: unknown; packageIds: string[]; packageHashes: Record<string, string>; sourceDeclared: boolean; targetRegistered: false; renderedVerified: false };
}
export interface Native44StyleComponentCapabilities {
  componentType: string; controlRefs: string[]; specificRefs: string[]; sharedAdvancedRefs: string[];
  counts: { controls: number; rootControls: number; repeaterControls: number; nativeStyleEligible: number; unresolved: number };
}
export interface Native44StyleCapabilities {
  version: 1; kind: 'native44-style-capabilities'; knowledgeFingerprint: string; packageHashes: Record<string, string>;
  controls: Record<string, Native44StyleControlCapability>; components: Record<string, Native44StyleComponentCapabilities>;
  sharedAdvanced: { byControlId: Record<string, { baseRef: string; variants: { ref: string; componentTypes: string[] }[] }> };
  variableConsumers: Native44StyleVariableConsumer[];
  wrapperClassesByType: Record<string, Native44StyleWrapperClassProof[]>;
  coverage: { requestedTypes: string[]; complete44: boolean; rootControlOccurrences: number; controlOccurrences: number; uniqueCapabilities: number; categories: Record<Native44StyleCapabilityCategory, number>; targetRegistered: false; renderedVerified: false };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
function declarations(template: string): { properties: { property: string; template: string }[]; opaque: boolean } {
  const segments: string[] = []; let start = 0, depth = 0, quote = '', escape = false;
  for (let index = 0; index < template.length; index++) {
    const character = template[index];
    if (escape) { escape = false; continue; }
    if (character === '\\') { escape = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(' || character === '[') depth++;
    if (character === ')' || character === ']') depth--;
    if (character === ';' && depth === 0) { segments.push(template.slice(start, index)); start = index + 1; }
  }
  segments.push(template.slice(start));
  const properties: { property: string; template: string }[] = []; let opaque = depth !== 0 || quote !== '';
  for (const segment of segments.filter(item => item.trim())) {
    const match = segment.match(/^\s*((?:--[\w-]+)|(?:[a-z][\w-]*))\s*:\s*([\s\S]+?)\s*$/i);
    if (match) properties.push({ property: match[1], template: match[2] }); else opaque = true;
  }
  return { properties, opaque };
}
function states(selector: string): string[] {
  const result = new Set<string>();
  for (const name of ['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'disabled', 'checked']) if (new RegExp(`:${name}(?![\\w-])`).test(selector)) result.add(name);
  if (/\[open\]|\[aria-expanded\s*=\s*["']?true|[.-](?:is-)?(?:active|selected|open)(?![\w-])/i.test(selector)) result.add('component-state');
  return result.size ? [...result] : ['normal'];
}
export function native44StyleConditionFields(condition: Native44Condition | null | undefined): { field: string; scope: string }[] {
  if (!condition) return [];
  if (condition.type === 'group') return (condition.terms ?? []).flatMap(native44StyleConditionFields);
  return condition.field ? [{ field: condition.field, scope: condition.scope ?? 'component' }] : [];
}
export function native44StyleTemplateFields(control: Native44Control): { field: string; token: string; scope: string }[] {
  const targets = record(control.effectTargets), fields = new Map<string, { field: string; token: string; scope: string }>();
  for (const template of Object.values(record(targets.selectors))) {
    if (typeof template !== 'string') continue;
    for (const match of template.matchAll(/{{\s*([\w-]+)\.([\w.[\]-]+)\s*}}/g)) {
      const field = { field: match[1], token: match[2], scope: control.scope ?? 'component' };
      fields.set(canonical(field), field);
    }
  }
  return [...fields.values()];
}
function extractEffects(control: Native44Control) {
  const targets = record(control.effectTargets), selectors = record(targets.selectors), dictionary = record(targets.selectorsDictionary);
  const effects: Native44StyleEffect[] = [], opaqueSelectorTemplates: Native44StyleControlCapability['opaqueSelectorTemplates'] = [];
  for (const [selector, template] of Object.entries(selectors)) {
    if (typeof template !== 'string') continue;
    const variants = Object.keys(dictionary).length ? Object.entries(dictionary).map(([dictionaryValue, replacement]) => ({ dictionaryValue, template: template.replaceAll('{{VALUE}}', String(replacement)) })) : [{ template }];
    for (const variant of variants) {
      const parsed = declarations(variant.template);
      for (const property of parsed.properties) effects.push({ selector, ...property, ...('dictionaryValue' in variant ? { dictionaryValue: variant.dictionaryValue } : {}), cssVariable: property.property.startsWith('--'), states: states(selector) });
      if (parsed.opaque || parsed.properties.length === 0) opaqueSelectorTemplates.push({ selector, ...variant });
    }
  }
  return { effects, opaqueSelectorTemplates };
}
function businessAction(control: Native44Control): boolean {
  return /^(?:submit_actions|submissions_metadata|form_metadata|custom_messages|success_message|error_message|email_to(?:_\d+)?|email_from(?:_name)?|email_reply_to|email_to_cc|email_to_bcc|email_content|email_subject|redirect_to|slack_webhook|webhooks?|mailchimp|activecampaign|convertkit|drip|getresponse|mailerlite|discord|collect_submissions)(?:_|$)/i.test(control.id) || /(?:section_integration|section_email|section_redirect|section_webhook|section_slack)/i.test(control.panel?.section ?? '');
}
function category(control: Native44Control, hasEffect: boolean, isDriver: boolean): Native44StyleCapabilityCategory {
  if (/(?:^|_)custom_css$/.test(control.id) || control.id === 'html' && control.type === 'code') return 'custom-css';
  if (businessAction(control)) return 'business-action';
  if (/^(?:section|tab|tabs|heading|raw_html|divider|notice|button)$/i.test(control.type ?? '') || control.effectTargets && record(control.effectTargets).renderType === 'none' && !hasEffect && !isDriver && control.id.startsWith('_')) return 'editor-only';
  if (control.defaultPolicy === 'task-resource-required' || control.defaultPolicy === 'task-content-required' || ['media', 'gallery', 'url', 'wysiwyg', 'query', 'repeater'].includes(control.type ?? '') || control.effectClass === 'content-data' && !hasEffect && !isDriver) return 'content-resource';
  if (control.panel?.tab === 'advanced') return 'shared-advanced';
  if (control.panel?.tab === 'style') return 'component-style';
  if (control.panel?.tab === 'layout') return 'container-layout';
  if (hasEffect || isDriver || control.effectClass === 'structural') return 'content-visual-driver';
  return 'unresolved';
}

export function classifyNative44StyleControl(control: Native44Control, options: { drivesControls?: readonly string[]; templateDrivesControls?: readonly string[] } = {}): { category: Native44StyleCapabilityCategory; mechanism: Native44StyleMechanism; nativeStyleEligible: boolean } {
  const parsed = extractEffects(control), targets = record(control.effectTargets);
  const prefixClass = typeof targets.prefixClass === 'string' && targets.prefixClass.length > 0;
  const frontendAvailable = targets.frontendAvailable === true;
  const hasEffect = parsed.effects.length > 0 || parsed.opaqueSelectorTemplates.length > 0 || prefixClass || frontendAvailable;
  const classified = category(control, hasEffect, Boolean(options.drivesControls?.length || options.templateDrivesControls?.length));
  const excluded = ['content-resource', 'editor-only', 'custom-css', 'business-action'].includes(classified);
  const mechanism: Native44StyleMechanism = excluded ? classified === 'content-resource' ? 'resource-binding' : 'not-native-style' : parsed.effects.length > 0 ? 'selector-setting' : prefixClass ? 'class-setting' : frontendAvailable ? 'frontend-setting' : options.templateDrivesControls?.length ? 'template-driver' : options.drivesControls?.length ? 'condition-driver' : 'unresolved';
  return { category: classified, mechanism, nativeStyleEligible: !excluded && mechanism !== 'unresolved' };
}

export function buildNative44StyleCapabilities(knowledge: Native44Knowledge, options: { variableConsumers?: readonly Native44StyleVariableConsumer[]; wrapperClassesByType?: Record<string, readonly Native44StyleWrapperClassProof[]> } = {}): Native44StyleCapabilities {
  const packageHashes = { ...knowledge.index.source.packageHashes };
  for (const [packageId, value] of Object.entries(knowledge.index.source.packages ?? {})) packageHashes[packageId] = value.sha256;
  const catalog: Native44StyleCapabilities = {
    version: 1, kind: 'native44-style-capabilities', knowledgeFingerprint: knowledge.index.fingerprint, packageHashes,
    controls: {}, components: {}, sharedAdvanced: { byControlId: {} }, variableConsumers: [], wrapperClassesByType: {},
    coverage: { requestedTypes: Object.keys(knowledge.components).sort(), complete44: false, rootControlOccurrences: 0, controlOccurrences: 0, uniqueCapabilities: 0, categories: { 'component-style': 0, 'shared-advanced': 0, 'container-layout': 0, 'content-visual-driver': 0, 'content-resource': 0, 'editor-only': 0, 'custom-css': 0, 'business-action': 0, unresolved: 0 }, targetRegistered: false, renderedVerified: false },
  };
  const shared = new Map<string, Map<string, string[]>>();
  for (const [componentType, component] of Object.entries(knowledge.components)) {
    assertAllowedWidget(componentType);
    const flattened: { control: Native44Control; repeaterPath: string[] }[] = [];
    const visit = (control: Native44Control, repeaterPath: string[]) => {
      flattened.push({ control, repeaterPath });
      for (const child of control.repeater?.fields ?? []) visit(child, [...repeaterPath, control.id]);
    };
    component.controls.forEach(control => visit(control, []));
    const conditionDependencies = new Map(flattened.map(candidate => [candidate, native44StyleConditionFields(candidate.control.condition)]));
    const templateDependencies = new Map(flattened.map(candidate => [candidate, native44StyleTemplateFields(candidate.control)]));
    const profile: Native44StyleComponentCapabilities = { componentType, controlRefs: [], specificRefs: [], sharedAdvancedRefs: [], counts: { controls: flattened.length, rootControls: component.controls.length, repeaterControls: flattened.length - component.controls.length, nativeStyleEligible: 0, unresolved: 0 } };
    for (const { control, repeaterPath } of flattened) {
      const isDependency = (field: { field: string; scope: string }) => field.field.replace(/\[.*$/, '') === control.id && (field.scope === 'component' ? repeaterPath.length === 0 : field.scope === `repeater:${repeaterPath.join('.')}`);
      const drivesControls = flattened.filter(candidate => conditionDependencies.get(candidate)!.some(isDependency)).map(candidate => [...candidate.repeaterPath, candidate.control.id].join('.')).sort();
      const templateDrivesControls = flattened.filter(candidate => templateDependencies.get(candidate)!.some(isDependency)).map(candidate => [...candidate.repeaterPath, candidate.control.id].join('.')).sort();
      const parsed = extractEffects(control), targets = record(control.effectTargets);
      const prefixClass = typeof targets.prefixClass === 'string' && targets.prefixClass ? targets.prefixClass : null;
      const frontendAvailable = targets.frontendAvailable === true;
      const classification = classifyNative44StyleControl(control, { drivesControls, templateDrivesControls });
      const classified = classification.category, mechanism = classification.mechanism;
      const source = record(control.sourceEvidence), controlType = record(control.controlTypeEvidence);
      const packageIds = [...new Set([source.packageId, controlType.packageId].filter((value): value is string => typeof value === 'string'))].sort();
      const capability = {
        controlId: control.id, repeaterPath, panel: { tab: control.panel?.tab ?? null, section: control.panel?.section ?? null },
        ...classification,
        control: structuredClone(control), ...parsed, prefixClass, frontendAvailable,
        renderType: typeof targets.renderType === 'string' ? targets.renderType : null,
        selectorsDictionary: Object.keys(record(targets.selectorsDictionary)).length ? structuredClone(record(targets.selectorsDictionary)) : null,
        dependencyFields: native44StyleConditionFields(control.condition), drivesControls,
        templateDependencyFields: native44StyleTemplateFields(control), templateDrivesControls,
        declaredDevices: control.responsive ? /_(mobile|tablet|laptop|widescreen|tablet_extra|mobile_extra)$/.test(control.id) ? [control.id.match(/_(mobile|tablet|laptop|widescreen|tablet_extra|mobile_extra)$/)![1]] : control.devices?.length ? [...control.devices] : ['desktop', 'tablet', 'mobile'] : ['desktop'],
        evidence: { knowledgeFingerprint: knowledge.index.fingerprint, sourceDeclaration: control.sourceEvidence ?? null, controlType: control.controlTypeEvidence ?? null, historicalRuntime: control.runtimeEvidence ?? null, packageIds, packageHashes: Object.fromEntries(packageIds.filter(packageId => packageHashes[packageId]).map(packageId => [packageId, packageHashes[packageId]])), sourceDeclared: Boolean(source.packageId && source.entry && (source.declarationHash || source.sourceSha256)), targetRegistered: false as const, renderedVerified: false as const },
      };
      const ref = createHash('sha256').update(canonical(capability)).digest('hex');
      catalog.controls[ref] ??= { ref, ...capability };
      profile.controlRefs.push(ref);
      catalog.coverage.controlOccurrences++; catalog.coverage.categories[classified]++;
      if (capability.nativeStyleEligible) profile.counts.nativeStyleEligible++;
      if (mechanism === 'unresolved') profile.counts.unresolved++;
      if (classified === 'shared-advanced' && repeaterPath.length === 0) {
        profile.sharedAdvancedRefs.push(ref);
        const variants = shared.get(control.id) ?? new Map<string, string[]>(), types = variants.get(ref) ?? [];
        types.push(componentType); variants.set(ref, types); shared.set(control.id, variants);
      } else profile.specificRefs.push(ref);
    }
    catalog.coverage.rootControlOccurrences += component.controls.length;
    catalog.components[componentType] = profile;
  }
  for (const [controlId, refs] of shared) {
    const variants = [...refs].map(([ref, componentTypes]) => ({ ref, componentTypes: componentTypes.sort() })).sort((left, right) => right.componentTypes.length - left.componentTypes.length || left.ref.localeCompare(right.ref));
    catalog.sharedAdvanced.byControlId[controlId] = { baseRef: variants[0].ref, variants };
  }
  catalog.coverage.complete44 = NATIVE44_ALL_TYPES.every(type => Boolean(catalog.components[type])) && catalog.coverage.requestedTypes.length === 44;
  catalog.coverage.uniqueCapabilities = Object.keys(catalog.controls).length;
  for (const consumer of options.variableConsumers ?? []) {
    if (catalog.packageHashes[consumer.packageId] !== consumer.packageSha256 || !/^[a-f0-9]{64}$/.test(consumer.sourceSha256) || !consumer.variable.startsWith('--') || !consumer.entry.endsWith('.css')) throw Error('native44_style_variable_consumer_evidence_invalid');
    catalog.variableConsumers.push(structuredClone(consumer));
  }
  for (const componentType of Object.keys(catalog.components)) {
    catalog.wrapperClassesByType[componentType] = [];
    for (const proof of options.wrapperClassesByType?.[componentType] ?? []) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(proof.className) || catalog.packageHashes[proof.packageId] !== proof.packageSha256 || !/^[a-f0-9]{64}$/.test(proof.sourceSha256) || !proof.entry.endsWith('.php') || proof.inheritance.some(step => catalog.packageHashes[step.packageId] !== step.packageSha256)) throw Error('native44_style_wrapper_class_evidence_invalid');
      catalog.wrapperClassesByType[componentType].push(structuredClone(proof));
    }
  }
  return catalog;
}

export function getNative44StyleCapabilitiesForType(catalog: Native44StyleCapabilities, componentType: string): Native44StyleControlCapability[] {
  assertAllowedWidget(componentType);
  const profile = catalog.components[componentType];
  if (!profile) throw Error(`native44_style_capabilities_type_not_loaded: ${componentType}`);
  return profile.controlRefs.map(ref => {
    const capability = catalog.controls[ref];
    if (!capability) throw Error(`native44_style_capabilities_reference_missing: ${componentType}.${ref}`);
    return capability;
  });
}
export function findNative44StyleCapability(catalog: Native44StyleCapabilities, componentType: string, controlId: string, repeaterPath: readonly string[] = []): Native44StyleControlCapability | undefined {
  return getNative44StyleCapabilitiesForType(catalog, componentType).find(capability => capability.controlId === controlId && canonical(capability.repeaterPath) === canonical(repeaterPath));
}

function* sourcePackageEntries(bytes: Buffer, extension: string): Generator<{ entry: string; data: Buffer }> {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw Error('native44_style_zip_directory_missing');
  let offset = bytes.readUInt32LE(end + 16), totalSize = 0;
  const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('native44_style_zip_directory_invalid');
    const compression = bytes.readUInt16LE(offset + 10), compressedSize = bytes.readUInt32LE(offset + 20), uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    const entry = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!entry.endsWith(extension)) continue;
    totalSize += uncompressedSize;
    if (uncompressedSize > 20000000 || totalSize > 300000000) throw Error('native44_style_source_budget');
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('native44_style_zip_entry_invalid');
    if (![0, 8].includes(compression)) throw Error('native44_style_zip_compression_unsupported');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressedSize > bytes.length) throw Error('native44_style_zip_entry_bounds');
    const data = compression === 8 ? inflateRawSync(bytes.subarray(start, start + compressedSize), { maxOutputLength: 20000000 }) : bytes.subarray(start, start + compressedSize);
    if (data.length !== uncompressedSize) throw Error('native44_style_zip_entry_size');
    yield { entry, data };
  }
}

function phpWithoutComments(source: string): string {
  let result = '', quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index], next = source[index + 1];
    if (lineComment) { if (character === '\n') { lineComment = false; result += '\n'; } else result += ' '; continue; }
    if (blockComment) { if (character === '*' && next === '/') { blockComment = false; result += '  '; index++; } else result += character === '\n' ? '\n' : ' '; continue; }
    if (escaped) { result += character; escaped = false; continue; }
    if (quote) { result += character; if (character === '\\') escaped = true; else if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; result += character; continue; }
    if (character === '/' && next === '/' || character === '#') { lineComment = true; result += ' '; continue; }
    if (character === '/' && next === '*') { blockComment = true; result += '  '; index++; continue; }
    result += character;
  }
  return result;
}
function phpMethod(source: string, name: string): string | undefined {
  source = phpWithoutComments(source);
  const match = new RegExp(`(?:^|\\n)\\s*(?:(?:public|protected|private|final|static)\\s+)*function\\s+${name}\\s*\\([^)]*\\)\\s*(?::[^{}]+)?\\s*\\{`).exec(source);
  if (!match) return undefined;
  let depth = 1, quote = '', escaped = false, lineComment = false, blockComment = false;
  const start = match.index + match[0].length;
  for (let index = start; index < source.length; index++) {
    const character = source[index], next = source[index + 1];
    if (lineComment) { if (character === '\n') lineComment = false; continue; }
    if (blockComment) { if (character === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '/' && next === '/' || character === '#') { lineComment = true; continue; }
    if (character === '/' && next === '*') { blockComment = true; index++; continue; }
    if (character === '{') depth++;
    if (character === '}' && --depth === 0) return source.slice(start, index).trim();
    if (character === '}' && depth < 0) return undefined;
  }
  return undefined;
}

export async function readNative44StyleWrapperClasses(knowledge: Native44Knowledge): Promise<Record<string, Native44StyleWrapperClassProof[]>> {
  type Declaration = { symbol: string; parent?: string; source: string; proof: Native44StyleWrapperClassProof['inheritance'][number] };
  const declarations = new Map<string, Declaration>(), ambiguous = new Set<string>();
  for (const [packageId, definition] of Object.entries(knowledge.index.source.packages ?? {})) {
    const bytes = await readFile(definition.path), packageSha256 = createHash('sha256').update(bytes).digest('hex');
    if (packageSha256 !== definition.sha256 || packageSha256 !== knowledge.index.source.packageHashes[packageId]) throw Error(`native44_style_package_hash_mismatch: ${packageId}`);
    for (const { entry, data } of sourcePackageEntries(bytes, '.php')) {
      const source = phpWithoutComments(data.toString('utf8')), classes = [...source.matchAll(/^\s*(?:(?:abstract|final)\s+)?class\s+([\w]+)(?:\s+extends\s+([\\\w]+))?/gm)];
      if (classes.length !== 1) continue;
      const namespace = source.match(/^\s*namespace\s+([\\\w]+)\s*;/m)?.[1] ?? '', className = classes[0][1], parentName = classes[0][2];
      const imports = new Map([...source.slice(0, classes[0].index).matchAll(/^\s*use\s+([\\\w]+)(?:\s+as\s+(\w+))?\s*;/gm)].map(match => [match[2] ?? match[1].split('\\').at(-1)!, match[1].replace(/^\\/, '')]));
      const symbol = [namespace, className].filter(Boolean).join('\\'), parent = parentName ? parentName.startsWith('\\') ? parentName.slice(1) : imports.get(parentName) ?? [namespace, parentName].filter(Boolean).join('\\') : undefined;
      if (declarations.has(symbol)) { ambiguous.add(symbol); continue; }
      declarations.set(symbol, { symbol, parent, source, proof: { symbol, packageId, packageSha256, entry, sourceSha256: createHash('sha256').update(data).digest('hex') } });
    }
  }
  const result: Record<string, Native44StyleWrapperClassProof[]> = {};
  for (const [componentType, component] of Object.entries(knowledge.components)) {
    const primary = record(record(component.sourceOwnership).primary), chain: Declaration[] = [], visited = new Set<string>();
    let current = declarations.get(String(primary.symbol));
    while (current && !visited.has(current.symbol) && !ambiguous.has(current.symbol) && chain.length < 20) { chain.push(current); visited.add(current.symbol); current = current.parent ? declarations.get(current.parent) : undefined; }
    result[componentType] = [];
    if (!chain[0] || chain[0].proof.packageId !== primary.packageId || chain[0].proof.entry !== primary.entry || chain[0].proof.sourceSha256 !== primary.sourceSha256) continue;
    const nameOwner = chain.find(item => phpMethod(item.source, 'get_name') !== undefined), nameBody = nameOwner ? phpMethod(nameOwner.source, 'get_name') : undefined;
    const name = nameBody?.match(/^return\s+(['"])([A-Za-z0-9_-]+)\1\s*;$/)?.[2];
    const wrapperOwner = chain.find(item => phpMethod(item.source, 'get_html_wrapper_class') !== undefined), wrapperBody = wrapperOwner ? phpMethod(wrapperOwner.source, 'get_html_wrapper_class') : undefined;
    const literal = wrapperBody?.match(/^return\s+(['"])([A-Za-z0-9_-]+)\1\s*;$/)?.[2];
    const concatenation = wrapperBody?.match(/^return\s+(['"])([A-Za-z0-9_-]+)\1\s*\.\s*\$this->get_name\s*\(\s*\)\s*;$/)?.[2];
    if (wrapperOwner && (literal || concatenation && name)) result[componentType].push({ className: literal ?? `${concatenation}${name}`, method: 'get_html_wrapper_class', expression: literal ? 'literal-return' : 'get-name-concatenation', ...wrapperOwner.proof, inheritance: chain.slice(0, chain.indexOf(wrapperOwner) + 1).map(item => item.proof), ...(concatenation && name && nameOwner ? { getNameProof: { ...nameOwner.proof, name } } : {}) });
    const renderOwner = chain.find(item => phpMethod(item.source, 'add_render_attributes') !== undefined), renderBody = renderOwner ? phpMethod(renderOwner.source, 'add_render_attributes') : undefined;
    if (renderOwner && renderBody && !/\b(?:if|else|for|foreach|while|switch|try|catch)\s*[(\{:]|\bfunction\b/.test(renderBody)) {
      const literals = renderBody.match(/\$this->add_render_attribute\s*\(\s*(['"])_wrapper\1\s*,\s*\[\s*(['"])class\2\s*=>\s*\[\s*((?:(?:'[^']*'|"[^"]*")\s*,?\s*)+)/)?.[3];
      for (const match of literals?.matchAll(/(['"])([A-Za-z_][A-Za-z0-9_-]*)\1/g) ?? []) result[componentType].push({ className: match[2], method: 'add_render_attributes', expression: 'literal-wrapper-render-attribute', ...renderOwner.proof, inheritance: chain.slice(0, chain.indexOf(renderOwner) + 1).map(item => item.proof) });
    }
  }
  return result;
}

export async function readNative44StyleVariableConsumers(knowledge: Native44Knowledge): Promise<Native44StyleVariableConsumer[]> {
  const variables = new Set<string>();
  for (const component of Object.values(knowledge.components)) for (const control of component.controls) for (const effect of extractEffects(control).effects) if (effect.cssVariable) variables.add(effect.property);
  const consumers: Native44StyleVariableConsumer[] = [];
  for (const [packageId, definition] of Object.entries(knowledge.index.source.packages ?? {})) {
    const bytes = await readFile(definition.path), digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== definition.sha256 || digest !== knowledge.index.source.packageHashes[packageId]) throw Error(`native44_style_package_hash_mismatch: ${packageId}`);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw Error('native44_style_zip_directory_missing');
    let offset = bytes.readUInt32LE(end + 16), totalSize = 0;
    const count = bytes.readUInt16LE(end + 10);
    for (let index = 0; index < count; index++) {
      if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('native44_style_zip_directory_invalid');
      const compression = bytes.readUInt16LE(offset + 10), compressedSize = bytes.readUInt32LE(offset + 20), uncompressedSize = bytes.readUInt32LE(offset + 24);
      const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
      const entry = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      offset += 46 + nameLength + extraLength + commentLength;
      if (!entry.endsWith('.css')) continue;
      totalSize += uncompressedSize;
      if (uncompressedSize > 20000000 || totalSize > 300000000) throw Error('native44_style_source_budget');
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('native44_style_zip_entry_invalid');
      if (![0, 8].includes(compression)) throw Error('native44_style_zip_compression_unsupported');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressedSize > bytes.length) throw Error('native44_style_zip_entry_bounds');
      const data = compression === 8 ? inflateRawSync(bytes.subarray(start, start + compressedSize), { maxOutputLength: 20000000 }) : bytes.subarray(start, start + compressedSize);
      if (data.length !== uncompressedSize) throw Error('native44_style_zip_entry_size');
      const source = data.toString('utf8');
      if (!source.includes('var(--')) continue;
      const ast = css.parse(source), sourceSha256 = createHash('sha256').update(data).digest('hex');
      const atRules: string[] = [];
      css.walk(ast, { enter(node: css.CssNode) {
        if (node.type === 'Atrule') atRules.push(`@${node.name}${node.prelude ? ` ${css.generate(node.prelude)}` : ''}`);
        if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') return;
        const selector = css.generate(node.prelude);
        node.block.children.forEach((declaration: css.CssNode) => {
          if (declaration.type !== 'Declaration' || declaration.property.startsWith('--')) return;
          const value = css.generate(declaration.value), referenced = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]);
          for (const variable of new Set(referenced.filter(name => variables.has(name)))) consumers.push({ variable, selector, property: declaration.property, value, direct: value === `var(${variable})`, atRules: [...atRules], packageId, packageSha256: digest, entry, sourceSha256 });
        });
      }, leave(node: css.CssNode) { if (node.type === 'Atrule') atRules.pop(); } });
    }
  }
  return consumers;
}
