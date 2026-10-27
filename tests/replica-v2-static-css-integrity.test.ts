import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStaticHTML, scopeStaticCSS } from '../src/replica-v2/html.js';
import type { HtmlStaticComponentV2 } from '../src/replica-v2/types.js';
const component=(css:string):HtmlStaticComponentV2=>({key:'scoped',kind:'html-static',template:'<div><span data-cwp-text="copy"></span></div>',css,slots:{text:{copy:'Observed copy'},media:{},links:{}}});
test('static copy cannot be smuggled through pseudo content or an arbitrary attribute',()=>{
 for(const value of ['"Unobserved product price $5"','attr(data-offer)','counter(unbound)']) assert.throws(()=>renderStaticHTML(component(`div::after{content:${value}}`),'task','abcdef1',[],'desktop'),/typed text nodes/);
 assert.match(renderStaticHTML(component('div::before{content:"";display:block}'),'task','abcdef1',[],'desktop').html,/content:""/);
});
test('static CSS rejects non-finite literal styles before a writer can ignore them',()=>{
 for(const value of ['NaNpx','Infinity','-Infinityrem']) assert.throws(()=>scopeStaticCSS(`div{width:${value}}`,'owned-scope'),/non-finite/);
});
