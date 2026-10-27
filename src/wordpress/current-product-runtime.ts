import {createHash} from 'node:crypto';
import type {CurrentProductSelection} from '../native44/current-product.js';

/** A native WoodMart product template, never an ordinary Page impersonating a product. */
export const CURRENT_PRODUCT_DOCUMENT_RUNTIME='woodmart-native-single-product-v1' as const;
export interface ProductRuntimeObservation {
  version:1;runtime:typeof CURRENT_PRODUCT_DOCUMENT_RUNTIME;targetOrigin:string;readAt:string;
  pageId:number;runId:string;productId:number;contextKey:string;postType:'woodmart_layout';layoutType:'single_product';
  providerClass:'XTS\\Modules\\Layouts\\Single_Product';sourceSha256:string;previewProductId:number;
  conditionsApplied:false;versions:Record<string,string>;
}
export interface ProductRuntimeCapability {readonly runtime:typeof CURRENT_PRODUCT_DOCUMENT_RUNTIME;readonly pageId:number;readonly runId:string;readonly productId:number;readonly contextKey:string;readonly targetOrigin:string}
const proofs=new WeakMap<ProductRuntimeCapability,{observation:ProductRuntimeObservation;hash:string}>();
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function productRuntimeCapability(observation:ProductRuntimeObservation,expected:{targetOrigin:string;pageId:number;runId:string;productId:number;contextKey:string}):ProductRuntimeCapability {
  if(observation.version!==1||observation.runtime!==CURRENT_PRODUCT_DOCUMENT_RUNTIME||observation.targetOrigin!==new URL(expected.targetOrigin).origin||observation.pageId!==expected.pageId||observation.runId!==expected.runId||observation.productId!==expected.productId||observation.contextKey!==expected.contextKey||observation.postType!=='woodmart_layout'||observation.layoutType!=='single_product'||observation.providerClass!=='XTS\\Modules\\Layouts\\Single_Product'||!/^[a-f0-9]{64}$/.test(observation.sourceSha256)||!Number.isSafeInteger(observation.previewProductId)||observation.previewProductId<1||observation.conditionsApplied!==false||!Number.isFinite(Date.parse(observation.readAt)))throw Error('current_product_document_runtime_mismatch');
  const capability=Object.freeze({runtime:observation.runtime,...expected,targetOrigin:observation.targetOrigin});proofs.set(capability,{observation:structuredClone(observation),hash:hash(capability)});return capability;
}
export function assertProductRuntimeCapability(capability:ProductRuntimeCapability|undefined,selection:CurrentProductSelection,origin:string,pageId?:number,runId?:string){
  const proof=capability&&proofs.get(capability);
  if(!capability||!proof||proof.hash!==hash(capability)||capability.productId!==selection.productId||capability.contextKey!==selection.contextKey||capability.targetOrigin!==new URL(origin).origin||pageId!==undefined&&capability.pageId!==pageId||runId!==undefined&&capability.runId!==runId)throw Error('current_product_document_runtime_required');
  const age=Date.now()-Date.parse(proof.observation.readAt);if(age< -60000||age>15*60*1000)throw Error('current_product_document_runtime_stale');return structuredClone(proof.observation);
}
export function productRuntimeReadPHP(pageId:number,runId:string,productId:number,contextKey:string):string {
  if(![pageId,productId].every(v=>Number.isSafeInteger(v)&&v>0)||!/^[A-Za-z0-9_-]{4,100}$/.test(runId)||!/^[A-Za-z][A-Za-z0-9_-]{0,100}$/.test(contextKey))throw Error('current_product_runtime_input');
  const encoded=Buffer.from(JSON.stringify({runId,contextKey})).toString('base64');
  return `$id=${pageId};$pid=${productId};$expected=json_decode(base64_decode('${encoded}'),true);
if(!post_type_exists('woodmart_layout')||!class_exists('XTS\\Modules\\Layouts\\Single_Product')||!method_exists('XTS\\Modules\\Layouts\\Single_Product','setup_postdata')){throw new RuntimeException('native_product_template_provider_missing');}
if(get_post_type($id)!=='woodmart_layout'||get_post_meta($id,'wd_layout_type',true)!=='single_product'||!in_array(get_post_status($id),['draft','publish'],true)||get_post_meta($id,'_clonewp_run_id',true)!==$expected['runId']||!current_user_can('edit_post',$id)){throw new RuntimeException('native_product_template_owner');}
$conditions=get_option('wd_layouts_conditions',[]);foreach((array)$conditions as $layouts){if(!empty($layouts[$id])){throw new RuntimeException('native_product_template_has_display_conditions');}}
$product=wc_get_product($pid);if(!$product||!in_array($product->get_type(),['simple','variable'],true)||$product->get_status()!=='publish'||!$product->is_visible()||get_post_field('post_password',$pid)!==''){throw new RuntimeException('native_product_template_record');}
$provider=new ReflectionClass('XTS\\Modules\\Layouts\\Single_Product');return ['version'=>1,'runtime'=>'woodmart-native-single-product-v1','targetOrigin'=>untrailingslashit(home_url('/')),'pageId'=>$id,'runId'=>$expected['runId'],'productId'=>$pid,'contextKey'=>$expected['contextKey'],'postType'=>'woodmart_layout','layoutType'=>'single_product','providerClass'=>'XTS\\Modules\\Layouts\\Single_Product','sourceSha256'=>hash_file('sha256',$provider->getFileName()),'previewProductId'=>(int)\\XTS\\Modules\\Layouts\\Single_Product::get_preview_product_id(),'conditionsApplied'=>false,'versions'=>['elementor'=>ELEMENTOR_VERSION,'woocommerce'=>WC_VERSION]];`;
}
