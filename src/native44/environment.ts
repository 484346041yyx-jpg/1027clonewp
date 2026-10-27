import { createHash } from 'node:crypto';
import type { CapabilityReport, PreflightReport } from '../wordpress/types.js';
import { assertKnownNativeWidget as assertAllowedWidget } from './catalog.js';
import { native44RegisteredSchemaEvidence } from './selection.js';

/** Knowledge package identity, not an instruction to upgrade the target. */
export const NATIVE44_TARGET_VERSIONS = Object.freeze({ woodmart: '8.5.5', woodmartCore: '1.1.8', elementor: '3.35.4', elementorPro: '3.35.1' });
export type Native44Environment = typeof NATIVE44_TARGET_VERSIONS;
/** These method bodies match the frozen 3.35.4 package and observed 3.33.2.
 * Actual whole file hashes are retained separately in each run lock. */
export const NATIVE44_CORE_METHOD_CONTRACTS = Object.freeze({
  save: { class: 'Elementor\\Core\\Base\\Document', method: 'save', sha256: 'ad4df235606e3be6ac1d86450c996ecd667fd3a4972f45f0710f104731485284' },
  get_elements_data: { class: 'Elementor\\Core\\Base\\Document', method: 'get_elements_data', sha256: '12a72073c728ed1e0a3d5b22694ca19d731ee43a18315ad3a9117544a59360f8' },
  responsiveRegistration: { class: 'Elementor\\Controls_Stack', method: 'add_responsive_control', sha256: '82cfd7092ae90f10a372feedab29b5e021d2ddd584c0f8757a81e331f4ea0873' },
  responsiveCSSExpansion: { class: 'Elementor\\Core\\Files\\CSS\\Base', method: 'parse_content', sha256: 'f77eae5cb48ad08e9be70a932c25e5b8b94d8f1b89b46962885107f3758d0b02' },
});
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,JSON.parse(canonical(v))])):value);
const sha=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export const native44MethodSourceHash=(source:string)=>sha(source.replace(/\r\n/g,'\n').trim());
export interface Native44EnvironmentCheck {
  policy:'component-contract';required:Native44Environment;knowledgeBaselineVersions:Native44Environment;
  actual:Record<string,string|null>;actualVersions:Record<string,string>;versionDifferences:Array<{name:string;knowledge:string;actual:string|null}>;
  platformReady:boolean;matched:boolean;contractCompatible:boolean;blockers:string[];checkedAt:string;usedTypes:string[];
  schemaContractHash?:string;sourceContractHash?:string;contractHash?:string;
  coreMethods:Record<string,{compatible:boolean;methodSourceHash?:string;sourceFileHash?:string}>;
}
type ObservedCapabilities=Pick<CapabilityReport,'versions'>&Partial<Pick<CapabilityReport,'mode'|'legacySchemas'|'sourceProof'>>;
function stableSchemas(capabilities:ObservedCapabilities,types:string[]){
  return Object.fromEntries(types.map(type=>{const schema=capabilities.legacySchemas?.[type];return[type,schema?native44RegisteredSchemaEvidence(schema).sha256:undefined];}));
}
/** Identity only. A persisted offline observation is never a live write permit. */
export function fingerprintNative44Contracts(capabilities:ObservedCapabilities,usedTypes:readonly string[]){
  const types=[...new Set(usedTypes)].sort();types.forEach(assertAllowedWidget);
  const sourceMethods=Object.fromEntries(Object.keys(NATIVE44_CORE_METHOD_CONTRACTS).map(key=>{const proof=capabilities.sourceProof?.[key]as{class?:string;method?:string;sha256?:string;source?:string}|undefined;return[key,proof?{class:proof.class,method:proof.method,sourceFileHash:proof.sha256,methodSourceHash:typeof proof.source==='string'?native44MethodSourceHash(proof.source):null}:null];}));
  const schemaContractHash=sha(stableSchemas(capabilities,types)),sourceContractHash=sha({sourceMethods,responsiveDevices:capabilities.sourceProof?.responsiveDevices});
  return{actualVersions:{...capabilities.versions},usedTypes:types,schemaContractHash,sourceContractHash};
}
/** Version differences are context. Actual platform, component registrations,
 * source contracts and the compiler's used-field intersection authorize use. */
export function checkNative44Environment(preflight:PreflightReport,capabilities?:ObservedCapabilities,options:{usedTypes?:readonly string[];requireContracts?:boolean}={}):Native44EnvironmentCheck{
  const types=[...new Set(options.usedTypes??Object.keys(capabilities?.legacySchemas??{}))].sort();types.forEach(assertAllowedWidget);
  const plugin=(name:string)=>preflight.plugins.find(item=>item.plugin.replace(/\.php$/,'')===name&&item.status==='active')?.version??null;
  const actual:Record<string,string|null>={woodmart:capabilities?.versions.woodmart??preflight.themes.find(theme=>theme.stylesheet==='woodmart')?.version??null,woodmartCore:plugin('woodmart-core/woodmart-core'),elementor:plugin('elementor/elementor'),elementorPro:plugin('elementor-pro/elementor-pro')};
  const blockers=[...preflight.blockers];
  for(const name of ['woodmartCore','elementor','elementorPro'])if(!actual[name])blockers.push(`${name}: required active platform is missing`);
  if(capabilities){if(!actual.woodmart)blockers.push('woodmart: active parent theme version is unverified');if(capabilities.versions.activeTemplate!=='woodmart')blockers.push('Active parent theme is not verified as woodmart');for(const[name,value]of Object.entries(actual))if(capabilities.versions[name]!==undefined&&capabilities.versions[name]!==value)blockers.push(`${name}: registry/header version disagreement`);}
  if(types.some(type=>['wd_products','woocommerce-products','wd_products_tabs','wd_products_brands','wd_product_categories','wd_wc_breadcrumb','wd_wishlist','wd_compare'].includes(type))&&!plugin('woocommerce/woocommerce'))blockers.push('WooCommerce is required by the actual page components');
  if(types.includes('wd_contact_form_7')&&!plugin('contact-form-7/wp-contact-form-7'))blockers.push('Contact Form 7 is required by the actual page components');
  const platformReady=blockers.length===0,coreMethods:Native44EnvironmentCheck['coreMethods']={};
  if(options.requireContracts!==false){
    if(!capabilities?.legacySchemas||!types.length)blockers.push('Actual used-component registry contracts have not been observed');
    if(capabilities?.mode==='unavailable')blockers.push('Actual Elementor construction capability is unavailable');
    for(const type of types){const schema=capabilities?.legacySchemas?.[type];if(!schema||schema.type!==type||!schema.class||!schema.controls||!Object.keys(schema.controls).length)blockers.push(`Actual required component contract is unavailable: ${type}`);const errors=capabilities?.sourceProof?.schemaErrors as Record<string,unknown>|undefined;if(errors?.[type])blockers.push(`Actual required component observation failed: ${type}`);}
    for(const[key,expected]of Object.entries(NATIVE44_CORE_METHOD_CONTRACTS)){
      const proof=capabilities?.sourceProof?.[key]as{class?:string;method?:string;source?:string;sha256?:string}|undefined,methodSourceHash=typeof proof?.source==='string'?native44MethodSourceHash(proof.source):undefined;
      const compatible=proof?.class===expected.class&&proof?.method===expected.method&&typeof proof?.sha256==='string'&&/^[a-f0-9]{64}$/.test(proof.sha256)&&methodSourceHash===expected.sha256;
      coreMethods[key]={compatible,...(methodSourceHash?{methodSourceHash}:{}),...(proof?.sha256?{sourceFileHash:proof.sha256}:{})};if(!compatible)blockers.push(`Actual core source contract is unverified or changed: ${key}`);
    }
  }
  const contractCompatible=options.requireContracts!==false&&blockers.length===0;
  const actualVersions={...capabilities?.versions,...Object.fromEntries(Object.entries(actual).filter((entry):entry is[string,string]=>entry[1]!==null))};
  const versionDifferences=Object.entries(NATIVE44_TARGET_VERSIONS).filter(([name,version])=>actual[name]!==version).map(([name,knowledge])=>({name,knowledge,actual:actual[name]??null}));
  const identity=capabilities?fingerprintNative44Contracts(capabilities,types):undefined,schemaContractHash=identity?.schemaContractHash,sourceContractHash=identity?.sourceContractHash;
  const contractHash=contractCompatible?sha({policy:'component-contract',actualVersions,usedTypes:types,schemaContractHash,sourceContractHash}):undefined;
  return{policy:'component-contract',required:NATIVE44_TARGET_VERSIONS,knowledgeBaselineVersions:NATIVE44_TARGET_VERSIONS,actual,actualVersions,versionDifferences,platformReady,matched:contractCompatible,contractCompatible,blockers,checkedAt:new Date().toISOString(),usedTypes:types,schemaContractHash,sourceContractHash,contractHash,coreMethods};
}
export function assertNative44Environment(check:Native44EnvironmentCheck):void{if(!check.contractCompatible||!check.contractHash)throw Error(`native44 environment contract is not verified; no draft/media write is permitted: ${check.blockers.join('; ')}`);}
export function assertNative44EnvironmentLock(previous:Pick<Native44EnvironmentCheck,'contractHash'>,current:Native44EnvironmentCheck):void{assertNative44Environment(current);if(!previous.contractHash||previous.contractHash!==current.contractHash)throw Error('Native44 actual environment/schema contract changed since the run lock; existing draft and media are preserved');}
