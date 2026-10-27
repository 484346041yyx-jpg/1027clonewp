import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeViewportRaster} from '../src/native44/viewport-raster.js';

test('CUA scale normalization preserves CSS anchor positions and removes scrollbar pixels',async()=>{
  const width=1440,height=1000,clientWidth=1425;
  const pattern=Buffer.from(`<svg width="${width}" height="${height}"><rect width="1440" height="1000" fill="white"/><rect x="100" y="200" width="100" height="100" fill="red"/><rect x="1425" width="15" height="1000" fill="blue"/></svg>`);
  const scaled=await sharp(pattern).resize(clientWidth,Math.round(height*clientWidth/width)).jpeg({quality:95}).toBuffer();
  const normalized=await normalizeViewportRaster(scaled,{width,height,clientWidth},985);
  const {data,info}=await sharp(normalized).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,1425);assert.equal(info.height,985);
  const at=(x:number,y:number)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
  assert(at(150,250)[0]>240&&at(150,250)[1]<15);
  assert(at(50,250).every(value=>value>240));
  assert(at(1410,500).every(value=>value>240));
});

test('raster normalization refuses undeclared scaling, padding and invalid content coverage',async()=>{
  const bytes=await sharp({create:{width:1425,height:989,channels:3,background:'#123456'}}).png().toBuffer();
  await assert.rejects(()=>normalizeViewportRaster(bytes,{width:1440,height:1000,clientWidth:1425},1000),/dimensions/);
  await assert.rejects(()=>normalizeViewportRaster(bytes,{width:1440,height:1000,clientWidth:1425},1001),/content viewport/);
});
