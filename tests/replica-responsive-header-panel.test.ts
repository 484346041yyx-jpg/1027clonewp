import test from 'node:test';import assert from 'node:assert/strict';
import {splitResponsiveHeaderStyles,responsiveHeaderPageCSS} from '../src/replica-responsive/header.js';import {compileBundleStyles} from '../src/woodmart-header/generic/service.js';
const identity={moduleKey:'private-menu',headerId:'header_12345',targetOrigin:'https://target.example',owner:{ownerId:'clonewp',runId:'private-menu-run'}};
function plan():any{return {moduleKey:identity.moduleKey,style:{css:':header{color:red}:mobilemenu .wd-nav-fs>li>a{color:#222}',fonts:[]},layout:{rows:[],mobile:{version:2,mobileMaxWidth:767,tablet:'desktop',css:':header{color:red}',rows:[{slot:'general-header',params:{mobile_height:52.266},columns:{left:[],center:[],right:[]}},{slot:'header-bottom',params:{mobile_height:57},columns:{left:[],center:[],right:[]}}],scroll:{flow:'reserve-space',implementation:'scoped-css',views:[{width:390,height:844,policy:'fixed',offset:0,menuOpenLogo:'hidden',menuOpenHeight:57},{width:430,height:932,policy:'fixed',offset:0,menuOpenLogo:'hidden',menuOpenHeight:57}]}}}};}
test('header and phone panel roots stay in their existing independent strict compilers',()=>{
 const parts=splitResponsiveHeaderStyles(':header{color:red}:mobilemenu .wd-nav-fs>li>a{color:#222}');assert.match(parts.headerCSS,/:header/);assert.doesNotMatch(parts.headerCSS,/mobilemenu/);assert.match(parts.menuCSS,/:mobilemenu/);assert.throws(()=>splitResponsiveHeaderStyles(':header,:mobilemenu{color:red}'),/mixed_root/);assert.throws(()=>splitResponsiveHeaderStyles('@media(max-width:767px){:mobilemenu{color:red}}'),/conditional/);
 const p=plan();p.layout.mobile.menuCSS=':mobilemenu+body{color:red}';assert.throws(()=>responsiveHeaderPageCSS(p,42,identity.headerId),/scope/);
});
test('phone panel style revisions require one actually bound page of the same module and run',()=>{
 const page={pageId:42,postType:'page',template:'elementor_header_footer',status:'draft',runId:identity.owner.runId,headerId:identity.headerId,bodyHash:'a'.repeat(64),snapshotHash:'b'.repeat(64)},bundle:any={plan:plan(),state:{identity,confirmed:{snapshot:{module:{identity,pages:{42:page}}}}}};
 const css=compileBundleStyles(bundle);assert.match(css,/body\.page-id-42 \.wd-fs-menu/);assert.doesNotMatch(css,/:mobilemenu|:header/);assert.match(css,/\.whb-header_12345/);
 for(const change of [()=>delete bundle.state.confirmed,()=>bundle.state.confirmed.snapshot.module.pages[42].headerId=null,()=>bundle.state.confirmed.snapshot.module.pages[42].runId='foreign',()=>bundle.state.confirmed.snapshot.module.pages[99]={...page,pageId:99}]){const copy=structuredClone(bundle);change();assert.throws(()=>compileBundleStyles(bundle),/owned_bound_page_required/);Object.assign(bundle,copy);}
});
test('compact phone header follows the real outside native panel state with an exact owned page selector',()=>{
 const css=responsiveHeaderPageCSS(plan(),42,identity.headerId);assert.match(css,/body\.page-id-42:has\(>\.wd-fs-menu\.wd-opened\) \.whb-header_12345\{height:57px!important\}/);assert.match(css,/\.whb-general-header\{display:none!important\}/);assert.match(css,/top:calc\(57px \+ var\(--clonewp-header-admin-offset,0px\)\)/);assert.doesNotMatch(css,/wd-fs-menu-btn/);
});
test('document scroll locking is explicit, page-owned and cannot be smuggled onto a descendant or changed value',()=>{
 const p=plan();assert.doesNotMatch(responsiveHeaderPageCSS(p,42,identity.headerId),/html:has/);p.layout.mobile.menuCSS=':mobilemenu{--clonewp-menu-scroll-lock:1}';assert.match(responsiveHeaderPageCSS(p,42,identity.headerId),/html:has\(>body\.page-id-42>\.wd-fs-menu\.wd-opened\)\{overflow:hidden!important\}/);
 for(const css of [':mobilemenu .foreign{--clonewp-menu-scroll-lock:1}',':mobilemenu{--clonewp-menu-scroll-lock:0}',':mobilemenu{--other-property:1}']){p.layout.mobile.menuCSS=css;assert.throws(()=>responsiveHeaderPageCSS(p,42,identity.headerId),/header_menu_/);}
});
