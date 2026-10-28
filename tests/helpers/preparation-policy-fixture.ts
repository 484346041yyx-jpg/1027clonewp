import { NATIVE44_CATALOG_HASH } from '../../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../../src/native44/profile.js';
import { BODY_FIDELITY_KINDS, PREPARATION_COMPATIBILITY_KEYS, PREPARATION_DECISION_KEYS, type PreparationPlan, type PreparationSection } from '../../src/replica-preparation/types.js';
const ref = (path: string) => ({ path, sha256: 'a'.repeat(64) });
export function preparationPolicyFixture(count = 12): PreparationPlan {
  const sourceUrl = 'https://source.example/', targetOrigin = 'https://target.example';
  const sections: PreparationSection[] = Array.from({ length: count }, (_, i) => ({ key: `section${i}`, sourceUnitIds: [`unit${i}`], sourceFactIds: [`fact${i}`], family: 'content', dependsOn: [], estimatedEffort: 1,
    fidelity: BODY_FIDELITY_KINDS.map(kind => ({ kind, status: kind === 'text-layout' ? 'required' : 'not-applicable', sourceFactIds: [`fact${i}`], expected: `Observed source ${kind} retained for this complete region.`, evidence: [ref('source.png')] })),
    visualTargets: [{ kind: 'geometry', sourceFactId: `fact${i}`, rect: { x: 0, y: i * 100, width: 1200, height: 100 }, evidence: ref('source.png') }, { kind: 'paint', sourceFactId: `fact${i}`, property: 'color', value: '#123', evidence: ref('source.png') }],
  }));
  const plan: PreparationPlan = { version: 8, kind: 'clonewp-replica-preparation', taskId: 'task', runId: 'run', title: 'Store', slug: 'store', sourceUrl, targetOrigin, sourceEvidence: ref('evidence.json'), sourceFacts: ref('facts.json'), sourceUnits: ref('units.json'), headerAssets: ref('header-assets.json'), bodyAssets: ref('assets.json'),
    bodyBase: { version: 2, workflow: 'block-replication', executionStrategy: 'native44-css-handoff', taskId: 'task', title: 'Store', sourceUrl, replicationProfile: 'desktop-browser-v1', selectionRulesHash: NATIVE44_SELECTION_RULES_HASH, editorNaming: 'native-translated-v1', reviewWorkflow: 'whole-page-after-css-v1', goalProfile: 'component-reference-v1', requirementProfile: 'source-requirements-v1', articleListPolicy: 'target-posts-v1', componentCatalog: { ...ref('catalog.json'), sha256: NATIVE44_CATALOG_HASH }, knowledge: { ...ref('knowledge.json'), fingerprint: 'a'.repeat(64) }, targetEnvironment: { woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' }, sourceFacts: ref('facts.json'), componentPlan: ref('plan.json'), assetsManifest: ref('assets.json'), viewports: native44ProfileViewports('desktop-browser-v1'), visualAuditVersion: 3 },
    headerBase: { version: 1, kind: 'clonewp-header-module', moduleKey: 'store', targetOrigin, owner: { ownerId: 'clonewp', runId: 'run' }, name: 'Store header', menus: [{ key: 'main', name: 'Menu', items: [{ key: 'home', parentKey: null, title: 'Home', url: '/' }] }], layout: { rows: [{ slot: 'general-header', params: {}, columns: { left: [], center: [{ key: 'nav', type: 'mainmenu', menuKey: 'main', params: {} }], right: [] } }], settings: {} }, style: { css: ':header{color:#123}', fonts: [] } },
    sourcePartition: { allUnits: ['header', ...sections.flatMap(s => s.sourceUnitIds)], headerUnits: ['header'], bodyUnits: sections.flatMap(s => s.sourceUnitIds) },
    shared: { decisions: PREPARATION_DECISION_KEYS.map(key => ({ key, value: 'source-derived', evidence: [ref('source.png')] })), compatibility: PREPARATION_COMPATIBILITY_KEYS.map(key => ({ key, status: 'verified', reason: 'Actual source and native capability checked.', evidence: [ref('proof.json')] })), css: ':page{color:#123}' }, sections,
    responsive: { version: 2, tablet: 'desktop', mobileMaxWidth: 768, viewports: [{ width: 390, height: 844 }, { width: 430, height: 932 }], source: ref('phones.json'), decisions: { version: 1, layouts: [], carousels: [], header: { implementation: 'native', flow: 'reserve-space', views: [390, 430].map(width => ({ width, height: width === 430 ? 932 : 844, snapshotId: 'phone', nodeId: 'header', interactionId: 'scroll', policy: 'fixed', offset: 0 })) } } },
  };
  return plan;
}

