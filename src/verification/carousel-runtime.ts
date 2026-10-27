import type { Locator } from 'playwright';

export async function carouselState(widget: Locator) {
  return widget.evaluate(element => {
    const track = element.querySelector('.swiper-wrapper,.slick-track');
    const windowElement = element.querySelector('.swiper,.swiper-container,.slick-list') ?? element;
    const windowBox = windowElement.getBoundingClientRect();
    const slides = Array.from(track?.children ?? []).filter(slide => slide.matches('.swiper-slide,.slick-slide'));
    const original = slides.filter(slide => !slide.closest('.swiper-slide-duplicate,.slick-cloned'));
    const sourceIndices = new Set(original.map(slide => slide.getAttribute('data-swiper-slide-index') ?? slide.getAttribute('data-slick-index')).filter((index):index is string=>index!==null));
    const physicalVisible = slides.filter(slide => { const box = slide.getBoundingClientRect(), css = getComputedStyle(slide); return box.width > 1 && box.height > 1 && css.display !== 'none' && css.visibility !== 'hidden' && box.right > windowBox.left + 2 && box.left < windowBox.right - 2; });
    const visibleWrappers = physicalVisible.map(slide => {
      const box=slide.getBoundingClientRect(),clone=!!slide.closest('.swiper-slide-duplicate,.slick-cloned'),index=slide.getAttribute('data-swiper-slide-index')??slide.getAttribute('data-slick-index');
      // A clone contributes only when its actual source index is proved among this track's originals.
      const sourceId=index!==null&&sourceIndices.has(index)?`index:${index}`:!clone?`original:${original.indexOf(slide)}`:undefined;
      return{sourceId,index,clone,classes:slide.className,rect:{x:box.x,y:box.y,width:box.width,height:box.height}};
    });
    const visibleSourceIds=[...new Set(visibleWrappers.map(wrapper=>wrapper.sourceId).filter((id):id is string=>!!id))];
    const runtime=(windowElement as HTMLElement&{swiper?:{initialized?:boolean;destroyed?:boolean;animating?:boolean;params?:{slidesPerView?:unknown};currentBreakpoint?:unknown;autoplay?:{running?:boolean;paused?:boolean}}}).swiper;
    const initialized=runtime?.initialized===true&&runtime.destroyed!==true;
    const activeSlides=slides.filter(slide=>slide.matches('.swiper-slide-active,.slick-current'));
    const activeSourceIds=[...new Set(activeSlides.map(slide=>{const index=slide.getAttribute('data-swiper-slide-index')??slide.getAttribute('data-slick-index');return index!==null&&sourceIndices.has(index)?`index:${index}`:original.includes(slide)?`original:${original.indexOf(slide)}`:undefined;}).filter((id):id is string=>!!id))];
    const activeIdentityVerified=activeSlides.length>0&&activeSlides.every(slide=>{const index=slide.getAttribute('data-swiper-slide-index')??slide.getAttribute('data-slick-index');return index!==null&&sourceIndices.has(index)||original.includes(slide);});
    const active = original.filter(slide => slide.matches('.swiper-slide-active,.slick-current')).map(slide => `${slide.getAttribute('data-swiper-slide-index') ?? slide.getAttribute('data-slick-index') ?? original.indexOf(slide)}:${slide.textContent?.trim().replace(/\s+/g, ' ').slice(0, 500)}`);
    // Keep serialized browser callbacks self-contained. A named local function can
    // acquire tsx/esbuild's module-only __name helper, absent on ordinary pages.
    const visibleControls=Array.from(element.querySelectorAll('.elementor-swiper-button-next,.swiper-button-next,.slick-next,[aria-label="Next slide"],[aria-label="Next Slide"],[aria-label="Next"],.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"],[aria-label="Previous"]')).filter(control=>{const box=control.getBoundingClientRect();for(let ancestor:Element|null=control;ancestor;ancestor=ancestor.parentElement){const css=getComputedStyle(ancestor);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;if(ancestor===element)break;}return box.width>0&&box.height>0;});
    const next = visibleControls.find(control=>control.matches('.elementor-swiper-button-next,.swiper-button-next,.slick-next,[aria-label="Next slide"],[aria-label="Next Slide"],[aria-label="Next"]'));
    const previous = visibleControls.find(control=>control.matches('.elementor-swiper-button-prev,.swiper-button-prev,.slick-prev,[aria-label="Previous slide"],[aria-label="Previous Slide"],[aria-label="Previous"]'));
    const settingsValue = element.getAttribute('data-settings'); let settings: Record<string, unknown> = {};
    try { settings = settingsValue ? JSON.parse(settingsValue) as Record<string, unknown> : {}; } catch { /* Invalid DOM declaration is not behavior proof. */ }
    const pagination = element.querySelector('.swiper-pagination,.slick-dots,.elementor-swiper-pagination');
    const transform = track ? getComputedStyle(track).transform : '';
    const transitionDuration=track?getComputedStyle(track).transitionDuration:'',transitionProperty=track?getComputedStyle(track).transitionProperty:'';
    return { slideCount: original.length, visibleSlides: visibleSourceIds.length, visibleSourceIds, visibleWrappers, visibilityVerified:visibleWrappers.every(wrapper=>!!wrapper.sourceId), activeSourceIds,activeIdentityVerified,initialized, animating:runtime?.animating===true, transitionDuration,transitionProperty,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,runtimeSlidesPerView:runtime?.params?.slidesPerView,runtimeBreakpoint:runtime?.currentBreakpoint,cssSlidesToDisplay:getComputedStyle(element).getPropertyValue('--e-n-carousel-swiper-slides-to-display'),windowRect:{x:windowBox.x,y:windowBox.y,width:windowBox.width,height:windowBox.height},active, transform, token: JSON.stringify([active, transform]), next: !!next, previous: !!previous, pagination: !!pagination, autoplayDeclared: Object.hasOwn(settings, 'autoplay') ? settings.autoplay === 'yes' : undefined,pauseOnHoverDeclared:Object.hasOwn(settings,'pause_on_hover')?settings.pause_on_hover==='yes':undefined,autoplayRunning:runtime?.autoplay?.running,autoplayPaused:runtime?.autoplay?.paused, autoplaySpeed: typeof settings.autoplay_speed === 'number' ? settings.autoplay_speed : typeof settings.autoplay_speed === 'string' && /^\d+$/.test(settings.autoplay_speed) ? Number(settings.autoplay_speed) : undefined, loopDeclared: Object.hasOwn(settings, 'infinite') ? settings.infinite === 'yes' : undefined };
  });
}
/** SSR wrappers precede real Swiper initialization; wait for a live, settled instance and proved visible source identities. */
export async function waitForNativeCarouselReady(widget:Locator,timeoutMs=20_000){
  const started=Date.now();let previous='',stable=0,lastState:Awaited<ReturnType<typeof carouselState>>|undefined;
  while(Date.now()-started<timeoutMs){
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>{reject(new NativeCarouselReadinessError(lastState,Date.now()-started));},Math.max(1,timeoutMs-(Date.now()-started)));
    });
    const state=await Promise.race([carouselState(widget),deadline]).finally(()=>{if(timer)clearTimeout(timer);});
    lastState=state;
    const signature=JSON.stringify([state.visibleSourceIds,state.transform,state.windowRect,state.visibleWrappers.map(wrapper=>wrapper.rect)]);
    if(state.initialized&&!state.animating&&state.visibilityVerified&&state.visibleSlides>0&&state.windowRect.width>0&&state.windowRect.height>0){stable=signature===previous?stable+1:1;if(stable>=3)return{elapsedMs:Date.now()-started,state};}else stable=0;
    previous=signature;await widget.page().waitForTimeout(100);
  }
  throw new NativeCarouselReadinessError(lastState,Date.now()-started);
}
class NativeCarouselReadinessError extends Error{constructor(readonly lastState:Awaited<ReturnType<typeof carouselState>>|undefined,readonly elapsedMs:number){super('Native carousel did not initialize with stable, source-identified visible slides within its bounded readiness window');}}
export function sameLogicalCarouselPosition(before:Awaited<ReturnType<typeof carouselState>>,after:Awaited<ReturnType<typeof carouselState>>):boolean{
  return before.initialized&&after.initialized&&!before.animating&&!after.animating&&before.visibilityVerified&&after.visibilityVerified&&before.activeIdentityVerified&&after.activeIdentityVerified&&JSON.stringify(before.activeSourceIds)===JSON.stringify(after.activeSourceIds)&&JSON.stringify(before.visibleSourceIds)===JSON.stringify(after.visibleSourceIds);
}
/** Only real pointer movement may exercise the native, explicitly declared pause-on-hover behavior. */
