import test from 'node:test';
import assert from 'node:assert/strict';
import * as csstree from 'css-tree';
import {furryHeaderPageCSS,furryHeaderTestElements} from '../src/woodmart-header/presentation.js';

test('header experiment styles every element through the owned page body and leaves old page selectors absent',()=>{
  const css=furryHeaderPageCSS(15858),ast=csstree.parse(css);
  let selectors=0;
  csstree.walk(ast,{visit:'Rule',enter(node){
    assert.equal(node.prelude?.type,'SelectorList');
    const list=node.prelude as csstree.SelectorList;
    list.children.forEach(selector=>{const text=csstree.generate(selector);assert.match(text,/^body\.page-id-15858\s/);assert.ok(!text.includes('15769'));selectors++;});
  }});
  assert.ok(selectors>20);assert.throws(()=>furryHeaderPageCSS(0));assert.throws(()=>furryHeaderPageCSS(1.5));
});
test('standalone comparison body contains a real link to the preserved original and no duplicate header',()=>{
  const tree=furryHeaderTestElements();assert.equal(tree.length,1);assert.equal(tree[0].elType,'container');
  const content=tree[0].elements[0].settings.editor;
  assert.ok(content.includes('https://primevapeoutlet.com/furrys-kitchen-desktop-native-replica/'));
  assert.ok(!content.includes('<header'));assert.ok(!content.includes('<script'));
});
