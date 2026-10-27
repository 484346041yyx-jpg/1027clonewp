export const NATIVE_VIEWPORT_CAPTURE = 'native-viewport-scaled' as const;
/** Some connected browsers return the complete viewport scaled to clientWidth.
 * Preserve those original bytes. Only an explicit, near-unity uniform viewport
 * mapping can explain a shorter raster; cropped or arbitrary images still fail. */
export function nativeViewportRasterMapping(raster:{width?:number;height?:number},viewport:{width:number;height:number},mode?:unknown):{x:number;y:number}|null{
 if(mode!==undefined&&mode!==NATIVE_VIEWPORT_CAPTURE)return null;
 const w=raster.width,h=raster.height;if(!w||!h||w>viewport.width||w<viewport.width-24)return null;
 if(h>=viewport.height)return {x:1,y:1};
 const scale=w/viewport.width;
 if(mode!==NATIVE_VIEWPORT_CAPTURE||scale<.9||scale>1||Math.abs(h-viewport.height*scale)>1)return null;
 return {x:scale,y:h/viewport.height};
}
