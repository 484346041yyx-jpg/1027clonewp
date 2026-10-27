import sharp from 'sharp';

/** Normalize an explicitly recorded CUA viewport raster into CSS coordinates.
 * CUA's ordinary viewport JPEG can be uniformly downsampled to clientWidth.
 * Preserve the raw JPEG and verify its exact dimensions; never pad pixels or
 * treat a reflowed full-page image as a viewport raster. */
export async function normalizeViewportRaster(bytes: Uint8Array, viewport: {width:number;height:number;clientWidth:number}, contentHeight:number): Promise<Buffer> {
  const metadata=await sharp(bytes).metadata();
  if(!Number.isInteger(contentHeight)||contentHeight<1||contentHeight>viewport.height||!metadata.width||!metadata.height)throw Error('Invalid observed content viewport/raster');
  const oneToOne=metadata.width===viewport.width&&metadata.height===viewport.height;
  const downsampled=metadata.width===viewport.clientWidth&&metadata.height===Math.round(viewport.height*metadata.width/viewport.width);
  if(!oneToOne&&!downsampled)throw Error('Viewport raster dimensions do not match the recorded 1:1 or uniform CUA scale');
  const decoded=sharp(bytes).ensureAlpha();
  const normalized=oneToOne?await decoded.png().toBuffer():await decoded.resize(viewport.width,viewport.height,{fit:'fill',kernel:'lanczos3'}).png().toBuffer();
  return sharp(normalized).extract({left:0,top:0,width:viewport.clientWidth,height:contentHeight}).png().toBuffer();
}
