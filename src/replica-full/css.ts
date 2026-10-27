import {createHash} from 'node:crypto';
import * as css from 'css-tree';
import type {ImportedAssetV2} from '../replica-v2/types.js';

function fail(code:string):never{throw Error(`replica_full_css_${code}`);}
/** Page CSS is independently compiled; no Canvas shell or global theme rules. */
export function compileFullPageCSS(input:string,pageId:number,assets:ImportedAssetV2[],runId:string):string{
 if(!Number.isSafeInteger(pageId)||pageId<1||!/^[A-Za-z0-9_-]{1,80}$/.test(runId)||typeof input!=='string'||Buffer.byteLength(input)>1048576||/[<\0]/.test(input))fail('input');
 const scope=`.elementor-${pageId}`,assetMap=new Map(assets.map(a=>[a.key,a]));
 const source=input.replace(/__ASSET_([A-Za-z0-9_-]+)__/g,(_,key:string)=>{
  const asset=assetMap.get(key);if(!asset||!Number.isSafeInteger(asset.attachmentId)||asset.attachmentId<1||!/^[a-f0-9]{64}$/.test(asset.sha256))fail('unresolved_asset');
  const url=new URL(asset.url);if(url.protocol!=='https:'||url.username||url.password||!url.pathname.startsWith('/wp-content/uploads/')||/["'()\s]/.test(url.href))fail('asset_url');return url.href;
 }).replace(/:page\b/g,scope);
 if(/__ASSET_/.test(source))fail('unresolved_asset');
 let ast:css.CssNode;try{ast=css.parse(source,{parseCustomProperty:true});}catch{fail('syntax');}
 const fontNames=new Map<string,string>(),prefix='cw-full-'+createHash('sha256').update(runId).digest('hex').slice(0,12)+'-';
 css.walk(ast!,node=>{
  if(node.type==='Atrule'){
   if(!['media','supports','font-face'].includes(node.name.toLowerCase()))fail('at_rule');
   if(node.name.toLowerCase()==='font-face'&&node.block){node.block.children.forEach(declaration=>{
    if(declaration.type==='Declaration'&&declaration.property.toLowerCase()==='font-family'){
     const family=css.generate(declaration.value).replace(/^['"]|['"]$/g,'').trim();if(!family||!/^[A-Za-z][A-Za-z0-9 _-]{0,70}$/.test(family))fail('font_family');fontNames.set(family,prefix+family.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
    }
   });}
  }
  if(node.type==='Rule'){
   if(node.prelude?.type!=='SelectorList')fail('selector');
   node.prelude.children.forEach(selector=>{
    const text=css.generate(selector);if(!text.startsWith(scope)||!new RegExp('^\\'+scope+'(?=[.#:\\[ >+~]|$)').test(text))fail('outside_page');
    if(selector.type!=='Selector')fail('selector');
    const firstCombinator=selector.children.toArray().find(child=>child.type==='Combinator');
    if(firstCombinator?.type==='Combinator'&&['+','~'].includes(firstCombinator.name))fail('root_sibling_escape');
   });
  }
  if(node.type==='Url'){
   let url:URL;try{url=new URL(node.value);}catch{fail('url');}
   if(url!.protocol!=='https:'||url!.username||url!.password||/[?&](?:token|nonce|password|secret|authorization|signature)=/i.test(url!.search))fail('url');
  }
 });
 css.walk(ast!,node=>{
  if(node.type==='String'&&fontNames.has(node.value))node.value=fontNames.get(node.value)!;
  else if(node.type==='Identifier'&&fontNames.has(node.name))node.name=fontNames.get(node.name)!;
 });
 // Full Width templates can still inherit WoodMart's negative-gap container.
 // The fixed rule targets only this owned page's theme content shell.
 return `body.page-id-${pageId}{margin-left:0!important}body.page-id-${pageId} .wd-sticky-nav{display:none!important}body.page-id-${pageId} #main-content.wd-content-layout{width:100%;max-width:none;margin:0;padding:0}@media(max-width:768px){body.page-id-${pageId} .wd-fs-menu .wd-dropdown-fs-menu,body.page-id-${pageId} .wd-fs-menu .wd-dropdown-fs-menu>.container,body.page-id-${pageId} .wd-fs-menu .wd-dropdown-fs-menu>.container>.wd-sub-menu{width:100%!important;max-width:100%!important}}`+css.generate(ast!);
}
