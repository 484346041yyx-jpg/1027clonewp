import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFullPageCSS} from '../src/replica-full/css.js';
const asset={key:'icon',attachmentId:1,url:'https://target.example/wp-content/uploads/icon.svg',sha256:'a'.repeat(64),sourceUrl:'https://source.example/icon.svg',mimeType:'image/svg+xml'};
test('full-page CSS resolves exact own assets, scopes rules, and isolates font names',()=>{
 const result=compileFullPageCSS('@font-face{font-family:"Nunito";src:url("https://source.example/font.woff2")} :page .item{font:700 14px Nunito;background:url("__ASSET_icon__")} @media(max-width:1600px){:page .item{gap:2px}}',123,[asset],'new-run');
 assert.match(result,/\.elementor-123 \.item/);assert.match(result,/cw-full-[a-f0-9]{12}-nunito/);assert.match(result,/https:\/\/target.example\/wp-content\/uploads\/icon.svg/);assert.doesNotMatch(result,/:page|__ASSET_/);
 assert.ok(result.startsWith('body.page-id-123{margin-left:0!important}body.page-id-123 .wd-sticky-nav{display:none!important}body.page-id-123 #main-content.wd-content-layout{width:100%;max-width:none;margin:0;padding:0}'));
 assert.match(result,/body\.page-id-123 \.wd-fs-menu \.wd-dropdown-fs-menu>\.container>\.wd-sub-menu\{width:100%!important;max-width:100%!important\}/);
});
test('full-page CSS rejects global rules, root sibling escape, missing assets and active URLs',()=>{
 for(const value of ['body{color:red}','body.page-id-123 #main-content{display:none}',':page + .foreign{color:red}',':page~.foreign{color:red}',':page .x{background:url("__ASSET_missing__")}',':page .x{background:url("javascript:bad")}','@import "https://source.example/global.css";'])assert.throws(()=>compileFullPageCSS(value,123,[asset],'new-run'),/replica_full_css_/);
 assert.throws(()=>compileFullPageCSS('.elementor-1234 .x{color:red}',123,[asset],'new-run'),/outside_page/);
});
