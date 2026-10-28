import {CORE_SINGLE_PRODUCT_TYPES} from './catalog.js';
import { relatedProductsQuerySchema } from '../wordpress/related-products.js';
import { isRelatedProductExtension } from './product-extension.js';
import { z } from 'zod';
import { parseFragment } from 'parse5';
import { assertAllowedWidget, NATIVE44_CATALOG_HASH } from './catalog.js';
import { NATIVE44_STRATEGY, NATIVE44_TARGET_ENVIRONMENT, NATIVE44_NATIVE_EDITOR_NAMING, NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW, NATIVE44_ARTICLE_LIST_POLICY, walkNative44, type Native44Component, type Native44Program } from './types.js';
import { DESKTOP_BROWSER_PROFILE, isDesktopBrowserProfile, native44ProfileViewports } from './profile.js';
import { NATIVE44_SELECTION_RULES_HASH } from './selection-rules.js';
import { assertNative44DesktopResourceSupport } from './adapters.js';
import { NATIVE44_REQUIREMENT_PROFILE, NATIVE44_COMPONENT_REFERENCE_GOAL } from './requirements.js';
import { native44PendingFormSchema, assertNative44PendingFormCandidate } from './pending-form.js';
import { normalizeTargetPostsQuery } from '../wordpress/posts-contract.js';
import { styleBindingSchema, nativeStyleSettingSchema } from './style-resolution.js';
import { componentModelSchema, COMPONENT_MODEL_POLICY, assertComponentModelExecutable } from './component-model.js';
import { currentProductSelectionSchema } from './current-product.js';
import { assertProgramNativeWidget, assertProductExtensionReference } from './product-extension.js';
import { inquiryPolicySchema, assertInquiryProgram } from './inquiry-form.js';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,100}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ref = z.object({ path: z.string().min(1), sha256: hash }).strict();
const settings = z.record(z.string(), z.unknown());
const resource = z.object({ kind: z.enum(['categories','brands','posts','menu','sidebar','form','page-context','wishlist','compare']), settingPath: z.string().optional(), ids: z.array(z.union([z.number().int().positive(), z.string().min(1)])).min(1), targetOrigin: z.string().url(), evidence: z.array(z.string().min(1)).min(1) }).strict();
const query = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200), evidence: z.array(z.string().min(1)).min(1), allowOverlap: z.boolean().optional() }).strict();
const postsQuery = z.object({ itemsPerPage:z.number().int().min(1).max(100),orderby:z.literal('date'),order:z.literal('desc'),offset:z.number().int().min(0).max(10000).optional(),categoryIds:z.array(z.number().int().positive()).max(100).optional(),tagIds:z.array(z.number().int().positive()).max(100).optional(),evidence:z.array(z.string().min(1)).min(1) }).strict();
const categoriesQuery = z.object({ rootIds: z.array(z.number().int().positive()).min(1).max(100), hideEmpty: z.boolean(), includeChildren: z.literal(true), orderby: z.literal('menu_order'), order: z.literal('ASC'), evidence: z.array(z.string().min(1)).min(1) }).strict();
const base = { key, model: componentModelSchema.optional(), settings: settings.optional(), sourceFactIds: z.array(z.string().min(1)).optional(), styleBindings: z.array(styleBindingSchema).min(1).max(500).optional(), nativeStyleSettings: z.array(nativeStyleSettingSchema).min(1).max(2000).optional(), role: z.enum(['heading','text','image','button','link','card','layout','carousel','product','navigation','form','decoration','other']).optional(), editorTitle: z.string().trim().min(1).max(120).regex(/^[^<>\u0000-\u001f]+$/).optional() };
const component: z.ZodType<Native44Component> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('native'), widgetType: z.string(), widgetSettings: settings, children: z.array(component).optional(), resources: z.array(resource).optional(), pendingForm: native44PendingFormSchema.optional() }).strict(),
  z.object({ ...base, kind: z.literal('composite'), children: z.array(component).min(1) }).strict(),
  z.object({ ...base, kind: z.literal('native-carousel'), widgetType: z.enum(['nested-carousel','wd_nested_carousel','slides','wd_banner_carousel','wd_infobox_carousel','wd_testimonials']), widgetSettings: settings, slides: z.array(component).min(1).max(100).optional() }).strict(),
  z.object({ ...base, kind: z.literal('native-products'), widgetType: z.enum(['wd_products','woocommerce-products','wd_products_tabs']), widgetSettings: settings, query: query.optional(), tabs: z.array(z.object({ key, title: z.string().min(1), settings: settings.optional(), query }).strict()).min(1).max(100).optional() }).strict(),
  z.object({ ...base, kind:z.literal('native-posts'),widgetType:z.literal('wd_blog'),widgetSettings:settings,query:postsQuery }).strict(),
  z.object({ ...base, kind:z.literal('native-categories'),widgetType:z.literal('wd_product_categories'),widgetSettings:settings,query:categoriesQuery }).strict(),
  z.object({ ...base, kind:z.literal('native-related-products'),widgetType:z.literal('woocommerce-product-related'),widgetSettings:settings,query:relatedProductsQuerySchema }).strict(),
  z.object({ ...base, kind: z.literal('html-static'), template: z.string().min(1).max(500000), css: z.string().max(300000), responsiveCss: z.string().max(300000).optional(), contentRole: z.enum(['marketing','navigation','category','service','decoration','footer']).optional(),
    slots: z.object({ text: z.record(key,z.string()), media: z.record(key,z.object({ assetKey:key, alt:z.string().optional(), responsive:z.array(z.object({assetKey:key,media:z.string().min(1)}).strict()).optional() }).strict()), links:z.record(key,z.object({url:z.string().min(1),isExternal:z.boolean().optional(),title:z.string().optional()}).strict()) }).strict(),
    exception: z.object({ reason:z.enum(['unsupported-content-model','unsupported-local-semantics']),summary:z.string().min(20),candidates:z.array(z.object({widgetType:z.string().min(1),limitation:z.string().min(20),evidence:z.array(ref).min(1)}).strict()).min(1) }).strict(),
  }).strict(),
]));
export const native44ProgramSchema = z.object({
  inquiryPolicy: inquiryPolicySchema.optional(),
  componentExtension: ref.optional(),
  currentRecord: currentProductSelectionSchema.optional(),
  componentModelPolicy: z.literal(COMPONENT_MODEL_POLICY).optional(),
  componentLearning: ref.optional(),
  styleResolutionVersion: z.union([z.literal(1),z.literal(2)]).optional(), styleCapabilities: ref.optional(),
  version:z.literal(2),workflow:z.literal('block-replication'),executionStrategy:z.literal(NATIVE44_STRATEGY),taskId:key,title:z.string().min(1),sourceUrl:z.string().url(),
  replicationProfile:z.literal(DESKTOP_BROWSER_PROFILE).optional(), selectionRulesHash:hash.optional(), requirementProfile:z.literal(NATIVE44_REQUIREMENT_PROFILE).optional(), goalProfile:z.literal(NATIVE44_COMPONENT_REFERENCE_GOAL).optional(),
  editorNaming:z.literal(NATIVE44_NATIVE_EDITOR_NAMING).optional(), reviewWorkflow:z.literal(NATIVE44_WHOLE_PAGE_REVIEW_WORKFLOW).optional(), visualAuditVersion:z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  articleListPolicy:z.literal(NATIVE44_ARTICLE_LIST_POLICY).optional(),
  componentCatalog:ref,knowledge:ref.extend({fingerprint:hash}),targetEnvironment:z.object({woodmart:z.literal('8.5.5'),woodmartCore:z.literal('1.1.8'),elementor:z.literal('3.35.4'),elementorPro:z.literal('3.35.1')}).strict(),
  sourceFacts:ref,componentPlan:ref,assetsManifest:ref,viewports:z.array(z.object({name:z.string().min(1),width:z.number().int().positive(),height:z.number().int().positive(),stage:z.enum(['desktop','responsive'])}).strict()).min(1),blocks:z.array(component).min(1),
}).strict();
const productTypes = new Set(['wd_products','woocommerce-products','wd_products_tabs']);
export function validateNative44Program(input: unknown): Native44Program {
  const program=native44ProgramSchema.parse(input), keys=new Set<string>();
  assertInquiryProgram(program);
  if(program.componentExtension) assertProductExtensionReference(program.componentExtension);
  if (program.styleResolutionVersion !== 2 && (program.styleCapabilities || walkNative44(program.blocks).some(node => node.nativeStyleSettings?.length))) throw Error('Native style setting plans require the version 2 resolution contract');
  const desktop = isDesktopBrowserProfile(program.replicationProfile);
  if (!desktop && (program.editorNaming || program.reviewWorkflow || program.articleListPolicy || program.visualAuditVersion)) throw Error('Historical native44 inputs cannot acquire new editor, article or review workflow defaults');
  if (program.visualAuditVersion && !program.reviewWorkflow) throw Error('Visual audit requires the whole-page review workflow');
  if (program.requirementProfile && !desktop) throw Error('Source requirements require explicit desktop planning; historical programs are not upgraded');
  if (program.goalProfile && (!desktop || program.requirementProfile !== NATIVE44_REQUIREMENT_PROFILE)) throw Error('Component reference goal requires an explicit desktop source requirements contract');
  if (desktop) {
    if (program.selectionRulesHash !== NATIVE44_SELECTION_RULES_HASH) throw Error('Desktop native44 selection rules identity is missing or changed');
    const expected = native44ProfileViewports(program.replicationProfile);
    if (program.viewports.length !== expected.length || expected.some((view, i) => ['name','width','height','stage'].some(key => program.viewports[i]?.[key as keyof typeof view] !== view[key as keyof typeof view]))) throw Error('Desktop profile requires exactly the ordered 1920x1080 and 1440x1000 desktop viewports');
    if (program.blocks.some(node => node.kind !== 'composite')) throw Error('Desktop visual modules require explicit stable composite containers');
  } else if (program.selectionRulesHash !== undefined) throw Error('Historical native44 inputs cannot acquire desktop selection rules');
  if(program.componentCatalog.sha256!==NATIVE44_CATALOG_HASH)throw new Error('Native44 component catalog hash differs from the fixed 44 component set');
  const source=new URL(program.sourceUrl);if(!['http:','https:'].includes(source.protocol)||source.username||source.password)throw new Error('Invalid native44 source URL');
  for(const node of walkNative44(program.blocks)){
    if(keys.has(node.key))throw new Error(`Duplicate native44 component identity: ${node.key}`);keys.add(node.key);
    if (!desktop && node.editorTitle !== undefined) throw Error('Historical native44 inputs cannot acquire new editor metadata');
    if (program.editorNaming && node.editorTitle !== undefined) throw Error(`Native translated Navigator names cannot use custom editorTitle: ${node.key}`);
    if (desktop && node.kind !== 'composite' && Object.keys(node.settings ?? {}).length) throw Error(`Desktop widget container settings require an explicit composite: ${node.key}`);
    if (desktop && node.kind === 'native' && node.widgetType === 'container') throw Error(`Desktop containers must use explicit composites: ${node.key}`);
    if('widgetType'in node){assertProgramNativeWidget(node.widgetType,program.componentExtension);if(node.kind!=='native-products'&&productTypes.has(node.widgetType))throw new Error(`Product component ${node.key} requires its verified query adapter`);if(node.widgetType==='html')throw new Error('HTML must use the typed html-static compiler with a native exception');}
    if (node.kind === 'native' && node.pendingForm) {
      if (!desktop || program.requirementProfile !== NATIVE44_REQUIREMENT_PROFILE || program.goalProfile !== NATIVE44_COMPONENT_REFERENCE_GOAL) throw Error('Pending forms require the explicit desktop component reference contract');
      // Syntax permits only the disabled candidate. The compiler separately
      // requires current-process source/KG/registered capability provenance.
      assertNative44PendingFormCandidate(node);
    } else if (desktop && node.kind === 'native') assertNative44DesktopResourceSupport(node.widgetType, node.resources);
    if(node.kind==='native-products'){
      if(node.widgetType==='wd_products_tabs' ? !node.tabs?.length||Boolean(node.query) : !node.query||Boolean(node.tabs))throw new Error(`Product query model differs from ${node.widgetType}: ${node.key}`);
      for(const q of node.tabs?.map(tab=>tab.query)??[node.query!])if(new Set(q.ids).size!==q.ids.length)throw new Error(`Duplicate target product IDs: ${node.key}`);
      if(node.tabs&&new Set(node.tabs.map(tab=>tab.key)).size!==node.tabs.length)throw new Error(`Duplicate product tab identities: ${node.key}`);
    }
    if(node.kind==='native-posts'){
      if(!desktop||program.articleListPolicy!==NATIVE44_ARTICLE_LIST_POLICY)throw Error(`Native posts require the explicit desktop target-posts article policy: ${node.key}`);
      for(const ids of [node.query.categoryIds??[],node.query.tagIds??[]])if(new Set(ids).size!==ids.length)throw Error(`Duplicate target post taxonomy IDs: ${node.key}`);
      normalizeTargetPostsQuery(node.query);
    }
    if (node.kind === 'native-categories') {
      if (!desktop || new Set(node.query.rootIds).size !== node.query.rootIds.length) throw Error(`Native categories require unique target roots in the desktop typed adapter: ${node.key}`);
    }
    if ('widgetType' in node && node.widgetType === 'woocommerce-product-related' && (node.kind !== 'native-related-products' || !desktop || !isRelatedProductExtension(program.componentExtension) || !program.currentRecord || node.query.contextKey !== program.currentRecord.contextKey || node.model?.data?.source !== 'current-record' || node.model.data.field !== 'related-products')) throw Error('native_related_product_requires_qualified_typed_context');
    if (node.kind === 'native-related-products' && (node.query.excludeIds?.length || node.query.limit > 20 || Number(node.widgetSettings.posts_per_page) !== node.query.limit)) throw Error('native_related_product_query_not_native');
    if(node.kind==='html-static'){
      if(['heading','text','image','button','link','card'].includes(node.role??''))throw new Error(`Ordinary ${node.role} content must use editable native controls: ${node.key}`);
      node.exception.candidates.forEach(candidate=>{assertAllowedWidget(candidate.widgetType);if(candidate.widgetType==='html')throw new Error('HTML cannot justify itself as a native candidate');if(/^(?:font|color|colour|spacing|size|margin|padding|styling|样式|尺寸|字体|间距|颜色)(?:\b|差异)/i.test(candidate.limitation.trim()))throw new Error('A styling difference cannot justify an HTML exception');});
      const fragment=parseFragment(node.template) as unknown as {childNodes?:Array<{tagName?:string;childNodes?:unknown[]}>};
      const direct=fragment.childNodes?.filter(n=>n.tagName)??[];
      if(direct.length===1&&/^(h[1-6]|p|span|img|picture|a)$/.test(direct[0].tagName??''))throw new Error(`Simple text/image/link HTML must use native controls: ${node.key}`);
      const tags:string[]=[];const collect=(n:any):void=>{if(n.tagName)tags.push(n.tagName);n.childNodes?.forEach(collect);};collect(fragment);
      if(tags.length<=20&&tags.some(t=>/^(?:h[1-6]|img|picture)$/.test(t))&&Object.keys(node.slots.media).length<=1&&Object.keys(node.slots.text).length<=3&&Object.keys(node.slots.links).length<=1)throw new Error(`Ordinary image/text card must use native controls: ${node.key}`);
    }
  }
  // Reject transport truncation and non-JSON values before authentication.
  const inspect=(value:unknown,path:string,depth:number):void=>{if(depth>50)throw new Error(`Native44 input depth exceeded: ${path}`);if(typeof value==='number'&&!Number.isFinite(value)||value==='[MaxDepth]')throw new Error(`Invalid or truncated native44 value: ${path}`);if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw new Error(`Unsafe native44 key: ${path}.${k}`);inspect(v,`${path}.${k}`,depth+1);}};
  if (!program.componentModelPolicy && walkNative44(program.blocks).some(node => node.model)) throw Error('unified_component_model_policy_required');
  if (program.componentLearning && !program.componentModelPolicy) throw Error('unified_component_learning_policy_required');
  if (program.currentRecord && (!program.componentModelPolicy || !walkNative44(program.blocks).some(node => node.model?.data?.source === 'current-record'))) throw Error('unified_current_record_selection_requires_binding');
  for(const node of walkNative44(program.blocks))if(node.kind!=='composite'&&'widgetType' in node&&CORE_SINGLE_PRODUCT_TYPES.includes(node.widgetType as any)&&(!program.currentRecord||!program.componentExtension||node.kind!=='native'||node.model?.data?.source!=='current-record'))throw Error('native_product_requires_current_record_template');
  assertComponentModelExecutable(program);
  inspect(program,'program',0);return program;
}
export { NATIVE44_TARGET_ENVIRONMENT };
