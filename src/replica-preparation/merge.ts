import * as cssTree from 'css-tree';
import { parseFragment } from 'parse5';
import { native44ModuleClass } from '../native44/adapters.js';
import { native44Children, walkNative44, type Native44Component } from '../native44/types.js';
import { validateNative44Program } from '../native44/validate.js';
import { validateSourceFactsV2 } from '../replica-v2/source.js';
import { BodySourceUnitsSchema } from '../replica-full/body-prepare.js';
import { validateHeaderModulePlan } from '../woodmart-header/generic/contract.js';
import { assertNativeImageCSS } from '../replica-full/native-image-policy.js';
import { buildPreparationJobs, preparationFail as fail, preparationHash, preparationHeaderIdentity, preparationJson, validatePreparationJobResult, validatePreparationPlan } from './contract.js';
import { BODY_FIDELITY_KINDS, type MergedPreparation, type PreparationJob, type PreparationJobResult, type PreparationMergeInputs, type PreparationPlan, type PreparationSectionResult } from './types.js';
import { verifyPreparationVisualTargets } from './visual-targets.js';
import { diagnosePreparationBuild, diagnoseSectionRelationships, diagnosePresentationAssignments } from './build-diagnostics.js';
import { COMPONENT_MODEL_POLICY, assertComponentModelExecutable, assertComponentModelSource } from '../native44/component-model.js';
import { configureInquiryBlocks, type InquiryConfiguration } from '../native44/inquiry-form.js';
import { assertInquirySourceCoverage } from './inquiry.js';

const sameSet = (a: string[], b: string[]) => new Set(a).size === a.length && new Set(b).size === b.length && a.length === b.length && a.every(item => b.includes(item));
const clone = <T>(input: T): T => JSON.parse(preparationJson(input)) as T;

/** Computed CSS repeats the duration list to match animation-name, and ignores
 * excess durations. A named zero-duration declaration is not visible motion. */
function hasNonzeroTextAnimation(style: Record<string, unknown>): boolean {
  const split = (input: unknown): cssTree.CssNode[][] => {
    if (typeof input !== 'string') return [];
    try {
      const value = cssTree.parse(input, { context: 'value' });
      if (value.type !== 'Value') return [];
      const groups: cssTree.CssNode[][] = [[]];
      value.children.forEach(node => { if (node.type === 'Operator' && node.value === ',') groups.push([]); else groups.at(-1)!.push(node); });
      return groups;
    } catch { return []; }
  };
  const names = split(style['animation-name']), durations = split(style['animation-duration']);
  if (!durations.length) return false;
  return names.some((group, index) => {
    const name = group.length === 1 ? group[0] : undefined;
    if (!name || !(name.type === 'String' && name.value.length > 0 || name.type === 'Identifier' && !/^(none|initial|inherit|unset|revert|revert-layer)$/i.test(name.name))) return false;
    const duration = durations[index % durations.length], time = duration.length === 1 ? duration[0] : undefined;
    return time?.type === 'Dimension' && /^(s|ms)$/i.test(time.unit) && Number.isFinite(Number(time.value)) && Number(time.value) > 0;
  });
}

/** A worker may only style its own stable module, never the page or sibling roots. */
export function assertPreparationSectionCSS(source: string, sectionKey: string): void {
  checkCSS(source, native44ModuleClass(sectionKey));
}
function checkCSS(source: string, moduleClass?: string): void {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 1_048_576 || /[<\u0000]/.test(source)) fail('css_invalid');
  let ast: cssTree.CssNode;
  try { ast = cssTree.parse(source, { parseCustomProperty: true, onParseError() { fail('css_syntax'); } }); } catch (error) { if (error instanceof Error && error.message.startsWith('replica_preparation_')) throw error; return fail('css_syntax'); }
  cssTree.walk(ast, node => {
    if (node.type === 'Raw') fail('css_unparsed');
    if (node.type === 'Atrule' && !['media', 'supports', ...(moduleClass ? [] : ['font-face'])].includes(node.name.toLowerCase())) fail('css_at_rule');
    if (node.type === 'Rule') {
      if (node.prelude.type !== 'SelectorList') fail('css_selector');
      node.prelude.children.forEach(selector => {
        if (selector.type !== 'Selector') fail('css_selector');
        const nodes = selector.children.toArray(), first = nodes[0];
        if (first?.type !== 'PseudoClassSelector' || first.name !== 'page' || first.children) fail('css_outside_scope');
        const firstCombinator = nodes.find(child => child.type === 'Combinator');
        if (firstCombinator?.type === 'Combinator' && ['+', '~'].includes(firstCombinator.name)) fail('css_sibling_escape');
        if (moduleClass) {
          if (nodes[1]?.type !== 'Combinator' || nodes[1].name !== ' ' || nodes[2]?.type !== 'ClassSelector' || nodes[2].name !== moduleClass) fail('css_outside_section');
          const afterRoot = nodes.slice(3).find(child => child.type === 'Combinator');
          if (afterRoot?.type === 'Combinator' && ['+', '~'].includes(afterRoot.name)) fail('css_sibling_escape');
        }
      });
    }
    if (node.type === 'Url') {
      if (/^__ASSET_[A-Za-z][A-Za-z0-9_-]{0,100}__$/.test(node.value)) return;
      let url: URL; try { url = new URL(node.value); } catch { return fail('css_url'); }
      if (url.protocol !== 'https:' || url.username || url.password || /(?:token|nonce|password|secret|authorization|signature)=/i.test(url.search)) fail('css_url');
    }
  });
}
function hasHeaderSemantics(node: Native44Component): boolean {
  let found = false;
  const markup = (value: string) => {
    if (!/[<>]/.test(value)) return;
    const visit = (entry: { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] }): void => {
      if (entry.tagName === 'header' || entry.attrs?.some(item => item.name === 'role' && item.value.trim().toLowerCase() === 'banner')) found = true;
      entry.childNodes?.forEach(item => visit(item as typeof entry));
    };
    visit(parseFragment(value) as unknown as Parameters<typeof visit>[0]);
  };
  for (const settings of [node.settings, 'widgetSettings' in node ? node.widgetSettings : undefined]) for (const [key, value] of Object.entries(settings ?? {})) if (typeof value === 'string') {
    if (/^(?:html_tag|tag|_element_tag)$/i.test(key) && value.toLowerCase() === 'header' || /^(?:role|aria_role)$/i.test(key) && value.toLowerCase() === 'banner' || /class/i.test(key) && /(?:^|\s)(?:site-header|main-header|whb-header|header-wrapper)(?:\s|$)/i.test(value) || /attribute/i.test(key) && /(?:^|[\s|])role[\s|=]+["']?banner\b/i.test(value)) found = true;
    markup(value);
  }
  if (node.kind === 'html-static') markup(node.template);
  return found;
}

/** Deterministic local merge only. The existing actual-body gate remains mandatory. */
export function mergePreparationResults(planInput: PreparationPlan, jobInputs: PreparationJob[], resultInputs: PreparationJobResult[], inputs: PreparationMergeInputs, options: { componentModelPolicy?: typeof COMPONENT_MODEL_POLICY; inquiryConfiguration?: InquiryConfiguration } = {}): MergedPreparation {
  try {
    const plan = validatePreparationPlan(planInput), jobs = buildPreparationJobs(plan), contractHash = preparationHash(plan), sharedHash = jobs[0].sharedHash;
    if (preparationHash(jobs) !== preparationHash(jobInputs)) fail('jobs_changed');
    const results = resultInputs.map(validatePreparationJobResult);
    if (!sameSet(results.map(item => item.jobId), jobs.map(item => item.jobId))) fail('results_incomplete');
    for (const result of results) if (result.taskId !== plan.taskId || result.runId !== plan.runId || result.contractHash !== contractHash || result.sharedHash !== sharedHash) fail('result_identity');
    const sourceFacts = validateSourceFactsV2(clone(inputs.sourceFacts)), sourceUnits = BodySourceUnitsSchema.parse(clone(inputs.sourceUnits));
    if (sourceFacts.sourceUrl !== plan.sourceUrl || sourceUnits.sourceUrl !== plan.sourceUrl || sourceUnits.taskId !== plan.taskId || !sameSet(sourceUnits.units.map(item => item.id), plan.sourcePartition.allUnits)) fail('source_identity');
    verifyPreparationVisualTargets(plan, sourceFacts);
    const physicalUnits = new Map(sourceUnits.units.map(item => [item.id, item])), factOwner = new Map<string, string>();
    for (const unit of sourceUnits.units) {
      if (new Set(unit.sourceFactIds).size !== unit.sourceFactIds.length || new Set(unit.nodeIds).size !== unit.nodeIds.length) fail('source_unit_duplicate');
      const snapshot = sourceFacts.snapshots.find(item => item.id === unit.snapshotId);
      if (!snapshot || !snapshot.nodes[unit.ownerNodeId] || !unit.nodeIds.includes(unit.ownerNodeId)) fail('source_unit_owner');
      for (const factId of unit.sourceFactIds) {
        const fact = sourceFacts.facts[factId];
        if (!fact || fact.snapshotId !== unit.snapshotId || !unit.nodeIds.includes(fact.nodeId) || factOwner.has(factId)) fail('source_fact_owner');
        factOwner.set(factId, unit.id);
      }
    }
    if (!sameSet([...factOwner.keys()], Object.keys(sourceFacts.facts))) fail('source_facts_incomplete');
    for (const section of plan.sections) {
      const expected = section.sourceUnitIds.flatMap(id => physicalUnits.get(id)!.sourceFactIds);
      if (!sameSet(section.sourceFactIds, expected)) fail('section_facts_changed');
      if (plan.version >= 5) {
        const checks = new Map(section.fidelity!.map(check => [check.kind, check]));
        const factIds = (kind: 'text' | 'media' | 'layout') => section.sourceFactIds.filter(id => sourceFacts.facts[id]?.kind === kind);
        for (const [kind, required] of [['text-layout', factIds('text')], ['item-inventory', factIds('media')], ['visual-boundaries', factIds('layout')]] as const) {
          const check = checks.get(kind)!;
          if (required.length && (check.status !== 'required' || required.some(id => !check.sourceFactIds.includes(id)))) fail('body_fidelity_source_coverage');
        }
        const interactive = section.sourceFactIds.some(id => { const fact = sourceFacts.facts[id]; return fact?.kind === 'interaction' && ['carousel', 'control', 'hover'].includes(String(fact.value.kind)); });
        if (interactive && checks.get('interaction')?.status !== 'required') fail('body_fidelity_interaction_missing');
        const animated = section.sourceFactIds.some(id => { const fact = sourceFacts.facts[id]; return fact?.kind === 'interaction' && fact.value.kind === 'control' && (fact.value.details as Record<string, unknown> | undefined)?.type === 'counter' || fact?.kind === 'text' && typeof fact.value.style === 'object' && fact.value.style !== null && hasNonzeroTextAnimation(fact.value.style as Record<string, unknown>); });
        if (animated && checks.get('motion')?.status !== 'required') fail('body_fidelity_motion_missing');
      }
    }
    const header = plan.reusedHeader ? undefined : validateHeaderModulePlan(results.find(item => item.jobId === 'header')!.header);
    if (header && plan.responsive && !header.layout.mobile) fail('responsive_header_required');
    if (header && plan.responsive?.decisions && (header.layout.mobile?.version !== 2 || preparationHash(header.layout.mobile.scroll) !== preparationHash(plan.responsive.decisions.header))) fail('responsive_header_decision_changed');
    if (header && preparationHeaderIdentity(header) !== preparationHeaderIdentity(plan.headerBase)) fail('header_identity_changed');
    const fragments = new Map<string, PreparationSectionResult>();
    for (const job of jobs.filter(item => item.responsibility === 'body')) {
      const result = results.find(item => item.jobId === job.jobId)!;
      if (!sameSet(result.sections!.map(item => item.key), job.sectionKeys)) fail('result_section_scope');
      result.sections!.forEach(section => fragments.set(section.key, section));
    }
    const keys = new Set<string>(), actualMappings = new Map(sourceUnits.units.map(item => [item.id, new Set<string>()]));
    const effectiveFacts = (node: Native44Component): string[] => [...new Set([...(node.sourceFactIds ?? []), ...native44Children(node).flatMap(effectiveFacts)])];
    checkCSS(plan.shared.css);
    const sectionClasses = new Set(plan.sections.map(section => native44ModuleClass(section.key)));
    // Shared typography/layout belongs to the frozen page contract. A section
    // selector there would create two competing owners for one module's CSS.
    cssTree.walk(cssTree.parse(plan.shared.css), node => { if (node.type === 'ClassSelector' && sectionClasses.has(node.name)) fail('shared_css_section_conflict'); });
    for (const section of plan.sections) {
      const fragment = fragments.get(section.key)!;
      if (fragment.blocks.length !== 1 || fragment.blocks[0].kind !== 'composite' || fragment.blocks[0].key !== section.key) fail('section_root');
      assertPreparationSectionCSS(fragment.css, section.key);
      if (plan.responsive ? fragment.responsive?.key !== section.key : fragment.responsive !== undefined) fail('responsive_section_required');
      const nodes = walkNative44(fragment.blocks), seenFacts = new Set<string>();
      for (const node of nodes) {
        if (node.key !== section.key && !node.key.startsWith(section.key + '_') || keys.has(node.key)) fail('component_key_scope'); keys.add(node.key);
        if (hasHeaderSemantics(node)) fail('embedded_header');
        if (node.kind === 'html-static') { assertPreparationSectionCSS(node.css, section.key); if (node.responsiveCss) assertPreparationSectionCSS(node.responsiveCss, section.key); }
        const facts = effectiveFacts(node);
        if (!facts.length || facts.some(id => !section.sourceFactIds.includes(id))) fail('component_fact_scope');
        for (const id of facts) { seenFacts.add(id); actualMappings.get(factOwner.get(id)!)!.add(node.key); }
      }
      if (!sameSet([...seenFacts], section.sourceFactIds)) fail('section_content_incomplete');
      if (plan.version >= 5) {
        const required = section.fidelity!.filter(check => check.status === 'required');
        if (!fragment.fidelity || !sameSet(fragment.fidelity.map(check => check.kind), required.map(check => check.kind))) fail('body_fidelity_result_incomplete');
        const nodeMap = new Map(nodes.map(node => [node.key, node]));
        for (const result of fragment.fidelity) {
          if (!BODY_FIDELITY_KINDS.includes(result.kind) || new Set(result.componentKeys).size !== result.componentKeys.length || result.componentKeys.some(key => !nodeMap.has(key))) fail('body_fidelity_component_scope');
          const check = required.find(row => row.kind === result.kind)!;
          const mapped = new Set(result.componentKeys.flatMap(key => effectiveFacts(nodeMap.get(key)!)));
          if (check.sourceFactIds.some(id => !mapped.has(id))) fail('body_fidelity_mapping');
        }
      } else if (fragment.fidelity) fail('body_fidelity_version');
    }
    const blocks = configureInquiryBlocks(plan.sections.flatMap(section => fragments.get(section.key)!.blocks),plan.bodyBase.inquiryPolicy,options.inquiryConfiguration,plan.taskId,plan.sourceUrl), program = validateNative44Program({ ...plan.bodyBase, ...(options.componentModelPolicy ? { componentModelPolicy: options.componentModelPolicy } : {}), ...(plan.version >= 7 ? { styleResolutionVersion: plan.version >= 8 ? 2 : 1 } : {}), blocks });
    assertInquirySourceCoverage(sourceFacts,program,plan.navigationForms);
    assertComponentModelExecutable(program, plan.sections.flatMap(section => fragments.get(section.key)!.responsive ? [fragments.get(section.key)!.responsive!] : []));
    assertComponentModelSource(program, sourceFacts);
    const mergedCSS = [plan.shared.css, ...plan.sections.map(section => fragments.get(section.key)!.css)].filter(Boolean).join('\n');
    assertNativeImageCSS(plan.nativeImagePolicy, program, mergedCSS);
    for (const form of plan.navigationForms ?? []) {
      const slot = walkNative44(blocks).find(node => node.key === form.slotComponentKey);
      if (!slot || slot.kind !== 'composite' || !slot.children.length || !form.sourceFactIds.every(id => slot.sourceFactIds?.includes(id))) fail('navigation_form_slot');
    }
    const modules = plan.sections.map(section => ({ key: section.key, sourceUnitIds: [...section.sourceUnitIds], sourceFactIds: [...section.sourceFactIds], componentKeys: walkNative44(fragments.get(section.key)!.blocks).map(node => node.key) }));
    for (const unit of sourceUnits.units) { unit.componentKeys = [...actualMappings.get(unit.id)!]; if (plan.sourcePartition.bodyUnits.includes(unit.id) && !unit.componentKeys.length || [...plan.sourcePartition.headerUnits, ...(plan.sourcePartition.footerUnits ?? []), ...(plan.sourcePartition.unselectedBodyUnits ?? [])].includes(unit.id) && unit.componentKeys.length) fail('component_mapping'); }
    return { header, program, css: mergedCSS, sourceUnits, buildDiagnostics: plan.version >= 6 ? [...diagnosePreparationBuild(sourceFacts, program), ...diagnoseSectionRelationships(sourceFacts, plan.sections, program), ...diagnosePresentationAssignments(sourceFacts, plan.sections, program)] : [], ...(plan.responsive ? { responsive: { ...plan.responsive, sections: plan.sections.map(s => fragments.get(s.key)!.responsive!) } } : {}), ...(plan.navigationForms ? { navigationForms: clone(plan.navigationForms) } : {}), ...(plan.nativeImagePolicy ? { nativeImagePolicy: clone(plan.nativeImagePolicy) } : {}), componentPlan: { version: 1, kind: 'task-native-body-component-plan', taskId: plan.taskId, sourceUrl: plan.sourceUrl, headerExcluded: true, modules }, contractHash, sharedHash };
  } catch (error) { if (error instanceof Error && error.message.startsWith('replica_preparation_')) throw error; return fail('merge_invalid'); }
}
