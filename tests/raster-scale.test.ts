import test from 'node:test';
import assert from 'node:assert/strict';
import {observedRasterScale} from '../src/verification/raster-scale.js';
const facts={innerWidth:900,clientWidth:885,devicePixelRatio:2};
const receipt={method:'scroll-viewport-cdp-no-beyond',before:facts,contentRaster:{width:885,height:2500,scale:1,scaleBasis:'actual-png-viewport-ratio',measuredDevicePixelRatio:2},constraints:{domOrCSSMutations:0,viewportOverrides:0,captureBeyondViewport:false,fromSurface:true}};
test('compositor scale differs from emulated DPR only with coherent viewport and PNG proof',()=>{
  assert.deepEqual(observedRasterScale({receipt,image:{width:885,height:2500},facts}),{scale:1,basis:'observed-viewport-raster',gaps:[]});
  for(const invalid of [{...receipt,before:{...facts,clientWidth:900}},{...receipt,contentRaster:{...receipt.contentRaster,scale:2}},{...receipt,constraints:{...receipt.constraints,viewportOverrides:1}}]){
    const proof=observedRasterScale({receipt:invalid,image:{width:885,height:2500},facts});assert.equal(proof.scale,2);assert.ok(proof.gaps.some(gap=>gap.code==='screenshot-raster-receipt-incoherent'));
  }
});
test('legacy mismatched screenshot is a gap and never fitted to expected geometry',()=>{
  const proof=observedRasterScale({image:{width:1433,height:4968},facts:{innerWidth:1440,clientWidth:1425,devicePixelRatio:1}});assert.equal(proof.scale,1);assert.equal(proof.gaps[0].code,'screenshot-raster-scale-unproven');
  assert.equal(observedRasterScale({image:{width:1770,height:5000},facts}).gaps.length,0);
});
