import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReplicaSourceSlug,replicaTargetURL,replicaNavigationURL,isNativeReplicaSlug,replicaURLNotice} from '../src/core/replica-url.js';

test('replica routes preserve arbitrary source paths without brand-derived prefixes',()=>{
  for(const path of ['/glass-toner-bottle','/about-us','/articles/materials.html','/catalog/brand-products/','/a--b','/%E4%BA%A7%E5%93%81?sort=asc#details']){
    assert.equal(replicaTargetURL('https://reference.example'+path,'https://destination.example/'),'https://destination.example'+path);
  }
  assertReplicaSourceSlug({sourceUrl:'https://one.example/about-us',slug:'about-us'});
  assertReplicaSourceSlug({sourceUrl:'https://another.example/brand-products/',slug:'brand-products'});
  for(const slug of ['replica-about-us','about-us-2','about-us-20261025'])assert.throws(()=>assertReplicaSourceSlug({sourceUrl:'https://one.example/about-us',slug}),/source_path_mismatch/);
});

test('same-site navigation changes only origin, including relative links',()=>{
  const source='https://reference.example/catalog/item',target='https://destination.example';
  assert.equal(replicaNavigationURL('../news?page=2#top',source,target),'https://destination.example/news?page=2#top');
  for(const href of ['#section','mailto:a@example.com','tel:123','https://external.example/page'])assert.equal(replicaNavigationURL(href,source,target),href);
  assert.throws(()=>replicaTargetURL(source,target+'/invented-prefix'),/origin_required/);
});

test('unsupported native creation routes stop instead of becoming invented flat pages',()=>{
  assert.throws(()=>assertReplicaSourceSlug({sourceUrl:'https://reference.example/a/b',slug:'b'}),/parent_route_required/);
  assert.throws(()=>assertReplicaSourceSlug({sourceUrl:'https://reference.example/',slug:'homepage-copy'}),/homepage_requires_explicit_ownership/);
  assertReplicaSourceSlug({sourceUrl:'https://reference.example/index',slug:'index'});
});

test('selected sections may use only their explicit task-bound independent slug',()=>{
  const input={sourceUrl:'https://reference.example/',slug:'get-a-free-quote',pageScope:'body-only',sourcePartition:{selection:{targetSlug:'get-a-free-quote'}}};
  assert.doesNotThrow(()=>assertReplicaSourceSlug(input));
  assert.throws(()=>assertReplicaSourceSlug({...input,slug:'other'}),/selected_path_mismatch/);
  assert.throws(()=>assertReplicaSourceSlug({...input,pageScope:undefined}),/selected_path_mismatch/);
  assert.equal(replicaURLNotice(input.sourceUrl,'https://target.example/get-a-free-quote/','get-a-free-quote'),null);
});

test('native normalization and numeric suffixes are accepted and reported without brand prefixes',()=>{
  assert.ok(isNativeReplicaSlug('a--b','a-b'));
  for(const slug of ['a-b-2','a-b-10','a-b-101'])assert.ok(isNativeReplicaSlug('a--b',slug));
  for(const slug of ['replica-a-b','a-b-1','a-b-02','a-b-custom'])assert.equal(isNativeReplicaSlug('a--b',slug),false);
  assert.equal(replicaURLNotice('https://source.example/a-b','https://target.example/a-b/'),null);
  assert.deepEqual(replicaURLNotice('https://source.example/a--b','https://target.example/a-b-2/'),{requestedPath:'/a--b',actualPath:'/a-b-2/',actualUrl:'https://target.example/a-b-2/',reason:'wordpress-native-slug'});
});
