import test from 'node:test';
import assert from 'node:assert/strict';
import { compileNative44, assertNative44Compilation } from '../src/native44/compiler.js';
import { validateNative44Program } from '../src/native44/validate.js';
import { NATIVE44_CATALOG_HASH } from '../src/native44/catalog.js';
import { NATIVE44_SELECTION_RULES_HASH } from '../src/native44/selection-rules.js';
import { native44ProfileViewports } from '../src/native44/profile.js';
import { NATIVE44_TARGET_ENVIRONMENT, type Native44Program, type Native44CompileOptions } from '../src/native44/types.js';
import type { TargetPostsEvidence } from '../src/wordpress/posts-contract.js';
import type { LegacySchema } from '../src/wordpress/types.js';

const digest='b'.repeat(64),ref={path:'D:/cloneWP/tests/fixtures/posts-compiler.json',sha256:digest};
const schemas:Record<string,LegacySchema>={
  container:{type:'container',class:'Container',controls:{css_classes:{type:'text'}}},
  heading:{type:'heading',class:'Heading',controls:{_css_classes:{type:'text'},title:{type:'textarea'}}},
  wd_blog:{type:'wd_blog',class:'XTS\\Elementor\\Blog',controls:{_css_classes:{type:'text'},post_type:{type:'select',options:{post:'Post',ids:'IDs'}},orderby:{type:'select',options:{date:'Date'}},order:{type:'select',options:{DESC:'Descending',ASC:'Ascending'}},offset:{type:'number'},items_per_page:{type:'number'},taxonomies:{type:'wd_autocomplete'},blog_design:{type:'select',options:{masonry:'Grid',list:'List'}}}},
};
function program():Native44Program{return{
  version:2,workflow:'block-replication',executionStrategy:'native44-css-handoff',replicationProfile:'desktop-browser-v1',selectionRulesHash:NATIVE44_SELECTION_RULES_HASH,
  articleListPolicy:'target-posts-v1',editorNaming:'native-translated-v1',taskId:'posts-compiler',title:'Target article list',sourceUrl:'https://source.example/',componentCatalog:{...ref,sha256:NATIVE44_CATALOG_HASH},knowledge:{...ref,fingerprint:digest},targetEnvironment:{...NATIVE44_TARGET_ENVIRONMENT},sourceFacts:ref,componentPlan:ref,assetsManifest:ref,viewports:native44ProfileViewports('desktop-browser-v1'),
  blocks:[{kind:'composite',key:'news',children:[{kind:'native',key:'news-title',widgetType:'heading',widgetSettings:{title:'Latest News'}},{kind:'native-posts',key:'news-list',widgetType:'wd_blog',widgetSettings:{blog_design:'masonry'},query:{itemsPerPage:2,orderby:'date',order:'desc',evidence:['article-list-scope.json']}}]}],
};}
function evidence(ids=[27,22]):TargetPostsEvidence{return{version:1,targetOrigin:'https://target.example',readAt:'2026-10-18T00:00:00.000Z',evidence:['target-posts.json'],query:{itemsPerPage:2,orderby:'date',order:'desc',offset:0,categoryIds:[],tagIds:[]},posts:ids.map((id,i)=>({id,status:'publish',date:`2026-10-${18-i}T00:00:00`,title:`Real target post ${id}`,excerpt:'Real target excerpt',permalink:`https://target.example/articles/${id}/`,featuredMediaId:0,imageVariants:[],categoryIds:[5],tagIds:[]}))};}
function options(posts=[evidence()]):Native44CompileOptions{return{schemas,assets:[],posts,targetOrigin:'https://target.example',knowledge:{fingerprint:digest,controlsByWidget:Object.fromEntries(Object.entries(schemas).map(([type,schema])=>[type,new Set(Object.keys(schema.controls))]))}};}

test('native blog emits a dynamic target query, separate receipt and native translated editor name',()=>{
  const compiled=compileNative44(program(),options()),[heading,blog]=compiled.composition.elements[0].elements;
  assert.equal(heading.settings.title,'Latest News');assert.equal(blog.widgetType,'wd_blog');assert.equal(blog.settings.post_type,'post');assert.equal(blog.settings.items_per_page,2);assert.equal(blog.settings.order,'DESC');assert.equal(blog.settings.orderby,'date');assert.equal(blog.settings.offset,0);assert.equal(Object.hasOwn(blog.settings,'include'),false);assert.equal(Object.hasOwn(blog.settings,'_title'),false);
  assert.deepEqual(compiled.queryReceipts,[]);assert.deepEqual(compiled.postQueryReceipts?.[0].observedPostIds,[27,22]);assert.equal(compiled.postQueryReceipts?.[0].elementId,blog.id);assert.equal(compiled.postQueryReceipts?.[0].provider,'target-wordpress-posts');assertNative44Compilation(compiled,compiled.composition);
  const newer=compileNative44(program(),options([evidence([31,27])]));assert.deepEqual(newer.composition,compiled.composition);assert.deepEqual(newer.postQueryReceipts?.[0].observedPostIds,[31,27]);
});
test('blog receipts and explicit adaptation policy are sealed with the compiler document',()=>{
  const compiled=compileNative44(program(),options());compiled.postQueryReceipts![0].observedPostIds=[999];assert.throws(()=>assertNative44Compilation(compiled,compiled.composition),/exact current-process/);
  const other=compileNative44(program(),options());delete other.articleListPolicy;assert.throws(()=>assertNative44Compilation(other,other.composition),/exact current-process/);
});
test('missing, cross-origin, wrong-query, unpublished and unordered observations cannot authorize a blog',()=>{
  assert.throws(()=>compileNative44(program(),options([])),/Actual target published posts/);
  const empty=evidence();empty.posts=[];assert.throws(()=>compileNative44(program(),options([empty])),/Actual target published posts/);
  const wrong=evidence();wrong.query.itemsPerPage=4;assert.throws(()=>compileNative44(program(),options([wrong])),/Actual target published posts/);
  const origin=evidence();origin.targetOrigin='https://other.example';assert.throws(()=>compileNative44(program(),options([origin])),/Invalid published target posts|origin differs/);
  const draft=evidence();draft.posts[0].status='draft' as 'publish';assert.throws(()=>compileNative44(program(),options([draft])),/Invalid published target posts/);
  const unordered=evidence();unordered.posts.reverse();assert.throws(()=>compileNative44(program(),options([unordered])),/Invalid published target posts/);
});
test('author settings cannot freeze post IDs, inject undeclared filters or override dynamic query controls',()=>{
  for(const field of ['include','exclude','orderby','order','post_type','taxonomies','offset','items_per_page','meta_key','ajax_page']){
    const p=program(),node=(p.blocks[0] as any).children[1];node.widgetSettings[field]=field==='include'?[27,22]:'injected';assert.throws(()=>compileNative44(p,options()),/owned by the target posts adapter/);
  }
});
test('article policy is explicit and cannot reinterpret historical programs or generic resource claims',()=>{
  const p=program();delete p.articleListPolicy;assert.throws(()=>validateNative44Program(p),/explicit desktop target-posts/);
  const legacy=program();delete legacy.replicationProfile;delete legacy.selectionRulesHash;delete legacy.editorNaming;legacy.viewports=native44ProfileViewports();assert.throws(()=>validateNative44Program(legacy),/Historical native44/);
  const forged=program();(forged.blocks[0] as any).children[1]={kind:'native',key:'news-list',widgetType:'wd_blog',widgetSettings:{},resources:[{kind:'posts',ids:[27],targetOrigin:'https://target.example',evidence:['invented.json']}]};assert.throws(()=>validateNative44Program(forged),/resource_adapter_unverified/);
});
test('separate article regions select their own observed query without changing product receipts',()=>{
  const p=program(),first=(p.blocks[0] as any).children[1],second=structuredClone(first);second.key='featured-articles';second.query={...second.query,categoryIds:[5],itemsPerPage:1};(p.blocks[0] as any).children.push(second);
  const filtered=evidence([27]);filtered.query={...filtered.query,itemsPerPage:1,categoryIds:[5]};const compiled=compileNative44(p,options([evidence(),filtered]));assert.deepEqual(compiled.postQueryReceipts?.map(row=>row.observedPostIds),[[27,22],[27]]);assert.deepEqual(compiled.composition.elements[0].elements[2].settings.taxonomies,[5]);
});
