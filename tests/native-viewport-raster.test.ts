import test from 'node:test';import assert from 'node:assert/strict';import{nativeViewportRasterMapping,NATIVE_VIEWPORT_CAPTURE}from'../src/core/native-viewport-raster.js';
test('original native viewport rasters use a bounded explicit uniform mapping without relaxing legacy screenshots',()=>{
 assert.deepEqual(nativeViewportRasterMapping({width:375,height:844},{width:390,height:844}),{x:1,y:1});assert.equal(nativeViewportRasterMapping({width:375,height:812},{width:390,height:844}),null);
 const mapping=nativeViewportRasterMapping({width:375,height:812},{width:390,height:844},NATIVE_VIEWPORT_CAPTURE)!;assert.equal(mapping.x,375/390);assert.equal(mapping.y,812/844);
 assert.ok(nativeViewportRasterMapping({width:1905,height:1072},{width:1920,height:1080},NATIVE_VIEWPORT_CAPTURE));assert.ok(nativeViewportRasterMapping({width:415,height:900},{width:430,height:932},NATIVE_VIEWPORT_CAPTURE));
 for(const image of [{width:375,height:780},{width:300,height:650},{width:390,height:812},{width:391,height:844},{width:375,height:0}])assert.equal(nativeViewportRasterMapping(image,{width:390,height:844},NATIVE_VIEWPORT_CAPTURE),null);
 assert.equal(nativeViewportRasterMapping({width:375,height:844},{width:390,height:844},'invented-mode'),null);
});
