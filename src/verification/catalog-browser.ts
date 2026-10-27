import path from 'node:path';
import type { Locator,Page } from 'playwright';
import { writeJson } from '../core/files.js';
import type { CatalogRenderEvidence,TargetCatalogEvidence } from '../wordpress/catalog-contract.js';

export interface CatalogRuntimeState {
  initialized:boolean;animating:boolean;selector?:string;activeIds:number[];visibleIds:number[];
  nextSelector?:string;previousSelector?:string;loop?:boolean;windowRect?:{x:number;y:number;width:number;height:number};
  cards:Array<{id:number;clone:boolean;fraction:number;rect:{x:number;y:number;width:number;height:number}}>;
}
/** Swiper may clone an entire nested Elementor widget, including its data-id.
 * Exclude only the standard clone markers or a live enclosing runtime's actual
 * duplicate class. Never select the first duplicate or discard hidden owners. */
export async function nativeCatalogOriginalWidgetSelector(page:Page,selector:string):Promise<string>{
  const custom=await page.locator('html').evaluate((root,selector)=>{
    const exclusions:string[]=[];
    const domPath=(element:Element)=>{const parts:string[]=[];for(let node:Element|null=element;node;node=node.parentElement){const siblings=node.parentElement?Array.from(node.parentElement.children).filter(sibling=>sibling.tagName===node!.tagName):[node];parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`);}return parts.join(' > ');};
    for(const candidate of root.querySelectorAll(selector))for(let ancestor:Element|null=candidate;ancestor;ancestor=ancestor.parentElement){
      const runtime=(ancestor as Element&{swiper?:{initialized?:boolean;destroyed?:boolean;wrapperEl?:Element;params?:{slideDuplicateClass?:string}}}).swiper;
      const name=runtime?.params?.slideDuplicateClass;
      if(runtime?.initialized!==true||runtime.destroyed===true||!(runtime.wrapperEl instanceof Element)||!runtime.wrapperEl.contains(candidate)||typeof name!=='string'||!/^[\w-]+$/.test(name))continue;
      // The custom marker belongs only to this runtime's direct slide owner.
      // A same-named class elsewhere on the page is not clone evidence.
      let slide:Element|null=candidate;while(slide&&slide.parentElement!==runtime.wrapperEl)slide=slide.parentElement;
      if(slide?.classList.contains(name)){const owner=`:is(${domPath(runtime.wrapperEl)}) > .${name}`;exclusions.push(`:not(${owner}):not(${owner} *)`);}
    }
    return [...new Set(exclusions)];
  },selector);
  return `:is(${selector})${['swiper-slide-duplicate','slick-cloned'].map(name=>`:not(.${name}):not(.${name} *)`).join('')}${custom.join('')}`;
}
/** Read public Swiper DOM references; a native widget name or declared layout is never initialization proof. */
export async function nativeCatalogRuntime(widget:Locator):Promise<CatalogRuntimeState>{
  return widget.evaluate(root=>{
    const domPath=(element:Element)=>{const parts:string[]=[];let node:Element|null=element;while(node&&node!==root){const parent:Element|null=node.parentElement;if(!parent)return undefined;const siblings=Array.from(parent.children).filter(item=>item.tagName===node!.tagName);parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`);node=parent;}return node===root?parts.length?`:scope > ${parts.join(' > ')}`:':scope':undefined;};
    type Runtime={initialized?:boolean;destroyed?:boolean;animating?:boolean;activeIndex?:number;wrapperEl?:Element;slides?:ArrayLike<Element>;navigation?:{nextEl?:string|Element|Element[];prevEl?:string|Element|Element[]};params?:{loop?:boolean;slideDuplicateClass?:string;navigation?:{nextEl?:string|Element|Element[];prevEl?:string|Element|Element[]}}};
    const instances=[root,...root.querySelectorAll('*')].flatMap(element=>{const runtime=(element as Element&{swiper?:Runtime}).swiper;return runtime?.initialized===true&&runtime.destroyed!==true&&runtime.wrapperEl instanceof Element&&root.contains(runtime.wrapperEl)&&Array.from(runtime.wrapperEl.querySelectorAll('.product-grid-item.product[data-id]')).some(card=>card.closest('[data-widget_type]')===root)?[{element,runtime}]:[];});
    const engine=instances.length===1?instances[0]:undefined;if(!engine)return{initialized:false,animating:false,activeIds:[],visibleIds:[],cards:[]};
    const{element,runtime}=engine,window=element.getBoundingClientRect(),slides=Array.from(runtime.slides??runtime.wrapperEl!.children);
    const products=Array.from(root.querySelectorAll('.product-grid-item.product[data-id]')).filter(card=>card.closest('[data-widget_type]')===root);
    const duplicateClass=runtime.params?.slideDuplicateClass,cloneSelector=duplicateClass&&/^[\w-]+$/.test(duplicateClass)?`.${duplicateClass},.swiper-slide-duplicate,.slick-cloned`:'.swiper-slide-duplicate,.slick-cloned';
    const rows=products.map(card=>{const box=card.getBoundingClientRect(),style=getComputedStyle(card),id=Number(card.getAttribute('data-id')),intersection=Math.max(0,Math.min(box.right,window.right)-Math.max(box.left,window.left));return{id,clone:!!card.closest(cloneSelector),fraction:box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'?intersection/box.width:0,rect:{x:box.x,y:box.y,width:box.width,height:box.height}};});
    const active=Number.isInteger(runtime.activeIndex)&&runtime.activeIndex!>=0&&runtime.activeIndex!<slides.length?[slides[runtime.activeIndex!]]:slides.filter(slide=>slide.classList.contains('swiper-slide-active'));
    const visibleIds=[...new Set(rows.filter(card=>card.fraction>=.6).map(card=>card.id))],activeIds=[...new Set(active.flatMap(slide=>Array.from(slide.matches('.product-grid-item.product[data-id]')?[slide]:slide.querySelectorAll('.product-grid-item.product[data-id]')).map(card=>Number(card.getAttribute('data-id')))))];
    const nav=(value:string|Element|Element[]|undefined)=>{let elements:Element[]=[];try{elements=typeof value==='string'?Array.from(root.querySelectorAll(value)):value instanceof Element?[value]:Array.isArray(value)?value:[];}catch{return undefined;}const candidates=elements.filter(element=>root.contains(element));return candidates.length===1?domPath(candidates[0]):undefined;};
    return{initialized:true,animating:runtime.animating===true,selector:domPath(element),activeIds,visibleIds,nextSelector:nav(runtime.navigation?.nextEl??runtime.params?.navigation?.nextEl),previousSelector:nav(runtime.navigation?.prevEl??runtime.params?.navigation?.prevEl),loop:runtime.params?.loop,windowRect:{x:window.x,y:window.y,width:window.width,height:window.height},cards:rows};
  });
}

export async function waitForNativeCatalogReady(widget:Locator,timeoutMs=5000):Promise<CatalogRuntimeState>{
  const deadline=Date.now()+timeoutMs;let previous='',stable=0,last=await nativeCatalogRuntime(widget);
  while(Date.now()<deadline){const signature=JSON.stringify([last.activeIds,last.visibleIds,last.cards.map(card=>card.rect),last.windowRect]);stable=last.initialized&&!last.animating&&last.activeIds.length>0&&last.visibleIds.length>0?(signature===previous?stable+1:1):0;if(stable>=3)return last;previous=signature;await widget.page().waitForTimeout(100);last=await nativeCatalogRuntime(widget);}
  throw Error('Native target product carousel has no stable initialized runtime and physically visible product identities');
}

/** Only the source-proved Woodmart product card and an exact native widget root supply observed fields. */
export async function collectNativeCatalogRender(options:{page:Page;blockId:string;widgetKey:string;elementId:string;widgetSelector?:string;viewport:string;catalog:TargetCatalogEvidence;runDir?:string;carouselExpected?:boolean;timeoutMs?:number}):Promise<CatalogRenderEvidence&{runtime:CatalogRuntimeState}>{
  const{page,blockId,widgetKey,elementId,viewport,catalog}=options;
  if(!/^[a-f\d]{7}$/.test(elementId))throw Error('Invalid native catalog widget identity');
  if(new URL(page.url()).origin!==catalog.targetOrigin)throw Error('Actual catalog preview is outside its target origin');
  const canonicalSelector=await nativeCatalogOriginalWidgetSelector(page,`[data-id="${elementId}"]`),canonicalWidget=page.locator(canonicalSelector);
  if(await canonicalWidget.count()!==1)throw Error('A unique native product widget is required; missing or duplicate non-clone identity');
  const widget=options.widgetSelector?page.locator(`:is(${options.widgetSelector}):is(${canonicalSelector})`):canonicalWidget;
  if(await widget.count()!==1||await widget.getAttribute('data-id')!==elementId)throw Error('The exact native product widget scope differs from its canonical identity');
  if(!await widget.evaluate(root=>root.getAttribute('data-widget_type')==='wd_products.default'))throw Error('The catalog root is not the registered native wd_products widget');
  const products=await widget.evaluate(root=>{
    const domPath=(element:Element)=>{const parts:string[]=[];for(let node:Element|null=element;node;node=node.parentElement){const siblings=node.parentElement?Array.from(node.parentElement.children).filter(sibling=>sibling.tagName===node!.tagName):[node];parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`);}return parts.join(' > ');};
    const cssVisible=(element:Element)=>{const box=element.getBoundingClientRect();if(box.width<=1||box.height<=1||element.closest('.screen-reader-text,[hidden]'))return false;for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;}return true;};
    const paint=(element:Element)=>{const css=getComputedStyle(element),box=element.getBoundingClientRect();let left=box.left,right=box.right,top=box.top,bottom=box.bottom;for(let node=element.parentElement;node;node=node.parentElement){const style=getComputedStyle(node),clip=node.getBoundingClientRect();if(/^(hidden|clip|auto|scroll)$/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}if(/^(hidden|clip|auto|scroll)$/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}}return{color:css.color,fontSize:css.fontSize,fontWeight:css.fontWeight,lineHeight:css.lineHeight,fontFamily:css.fontFamily,rect:{x:box.x+scrollX,y:box.y+scrollY,width:box.width,height:box.height},domPath:domPath(element),visible:cssVisible(element)&&right>left&&bottom>top};};
    const metric=(value:string)=>{const parsed=Number.parseFloat(value);return Number.isFinite(parsed)?parsed:undefined;};
    const stylePaint=(element:Element)=>{const css=getComputedStyle(element),box=element.getBoundingClientRect(),radius=css.borderTopLeftRadius;return{color:css.color,backgroundColor:css.backgroundColor,borderColor:css.borderTopColor,borderWidth:metric(css.borderTopWidth),borderRadius:radius.endsWith('%')?(metric(radius)??0)*Math.min(box.width,box.height)/100:metric(radius),opacity:metric(css.opacity),fontSize:metric(css.fontSize),lineHeight:metric(css.lineHeight),fontWeight:css.fontWeight,fontFamily:css.fontFamily,textAlign:css.textAlign,boxShadow:css.boxShadow};};
    const textLines=(element:Element)=>{
      const full:number[]=[],visible:number[]=[],walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),range=document.createRange();
      const add=(rows:number[],top:number)=>{if(!rows.some(row=>Math.abs(row-top)<=2))rows.push(top);};
      for(let text=walker.nextNode();text;text=walker.nextNode()){
        if(!text.textContent?.trim()||!text.parentElement||!cssVisible(text.parentElement))continue;
        range.selectNodeContents(text);
        for(const rect of Array.from(range.getClientRects()).filter(rect=>rect.width>.1&&rect.height>.1)){
          add(full,rect.top);let left=rect.left,right=rect.right,top=rect.top,bottom=rect.bottom;
          for(let ancestor:Element|null=text.parentElement;ancestor;ancestor=ancestor.parentElement){
            const style=getComputedStyle(ancestor),clip=ancestor.getBoundingClientRect();
            if(/^(hidden|clip|auto|scroll)$/.test(style.overflowX)){left=Math.max(left,clip.left+ancestor.clientLeft);right=Math.min(right,clip.left+ancestor.clientLeft+ancestor.clientWidth);}
            if(/^(hidden|clip|auto|scroll)$/.test(style.overflowY)){top=Math.max(top,clip.top+ancestor.clientTop);bottom=Math.min(bottom,clip.top+ancestor.clientTop+ancestor.clientHeight);}
          }
          // Partially exposed glyphs still count: half a third line is a real defect.
          if(right-left>.1&&bottom-top>.1)add(visible,rect.top);
        }
      }
      return{full:full.length,visible:visible.length};
    };
    const cardLayout=(card:Element,image:HTMLImageElement|null,heading:Element|undefined,price:Element|null)=>{
      const wrappers=card.querySelectorAll(".product-wrapper"),surface=wrappers.length===1?wrappers[0]:card;const box=surface.getBoundingClientRect();let left=box.left,right=box.right,top=box.top,bottom=box.bottom;
      for(let node=card.parentElement;node;node=node.parentElement){const css=getComputedStyle(node),clip=node.getBoundingClientRect();if(/^(hidden|clip|auto|scroll)$/.test(css.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}if(/^(hidden|clip|auto|scroll)$/.test(css.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}}
      type Role='image'|'name'|'rating'|'price'|'badge';
      const entries:Array<{role:Role;element:Element|null|undefined;image?:HTMLImageElement|null}>=[{role:'image',element:image,image},{role:'name',element:heading?.closest('.wd-entities-title')??heading},{role:'rating',element:card.querySelector('.star-rating')},{role:'price',element:price},{role:'badge',element:card.querySelector('.product-labels')}];
      const slots=entries.flatMap(({role,element,image})=>{if(!element)return[];const rect=element.getBoundingClientRect(),css=getComputedStyle(element),imageCSS=image?getComputedStyle(image):undefined,layout=textLines(element);return[{role,rect:{x:rect.x-box.x,y:rect.y-box.y,width:rect.width,height:rect.height},allocationRect:{x:rect.x-box.x-(metric(css.marginLeft)??0),y:rect.y-box.y-(metric(css.marginTop)??0),width:rect.width+(metric(css.marginLeft)??0)+(metric(css.marginRight)??0),height:rect.height+(metric(css.marginTop)??0)+(metric(css.marginBottom)??0)},allocationProof:{kind:"computed-margin-box" as const,domPath:domPath(element),marginTop:metric(css.marginTop)??0,marginRight:metric(css.marginRight)??0,marginBottom:metric(css.marginBottom)??0,marginLeft:metric(css.marginLeft)??0},visible:paint(element).visible,paint:stylePaint(element),domPath:domPath(element),lineCount:layout.visible,fullLineCount:layout.full,overflow:css.overflow,...imageCSS?{fit:imageCSS.objectFit,objectPosition:imageCSS.objectPosition}:{}}];});
      const area=box.width*box.height,shown=Math.max(0,right-left)*Math.max(0,bottom-top);
      return{rect:{x:box.x+scrollX,y:box.y+scrollY,width:box.width,height:box.height},domPath:domPath(surface),visibleFraction:cssVisible(surface)&&area>0?Math.min(1,shown/area):0,paint:stylePaint(surface),slots,order:slots.filter(slot=>slot.visible).sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x).map(slot=>slot.role)};
    };
    const classes=[root,...root.querySelectorAll('*')].map(element=>(element as Element&{swiper?:{initialized?:boolean;params?:{slideDuplicateClass?:string}}}).swiper).filter(runtime=>runtime?.initialized===true).map(runtime=>runtime?.params?.slideDuplicateClass).filter((value):value is string=>typeof value==='string'&&/^[\w-]+$/.test(value));const cloneSelector=['.swiper-slide-duplicate','.slick-cloned',...classes.map(name=>`.${name}`)].join(',');
    return Array.from(root.querySelectorAll('.product-grid-item.product[data-id]')).filter(card=>card.closest('[data-widget_type]')===root&&!card.closest(cloneSelector)).map(card=>{
    const anchors=Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')),heading=card.querySelector<HTMLAnchorElement>('h3.wd-entities-title a[href],.wd-entities-title a[href]')??anchors.find(anchor=>anchor.closest('h1,h2,h3,h4,h5,h6'))??anchors.find(anchor=>anchor.textContent?.trim());
    const imageAnchor=anchors.find(anchor=>anchor.href===heading?.href&&anchor.querySelector('img')),image=(imageAnchor?.querySelector('img')??card.querySelector('img'))as HTMLImageElement|null;
    const price=card.querySelector('.price'),priceState=(element:Element):'old'|'sale'|'regular'=>element.closest('del')?'old':element.closest('ins')?'sale':'regular';
    const amountNodes=price?Array.from(price.querySelectorAll('.woocommerce-Price-amount bdi,.amount bdi,.woocommerce-Price-amount,.amount')).filter(element=>cssVisible(element)&&!!element.textContent?.trim()):[];
    const leaves=amountNodes.filter(element=>!amountNodes.some(child=>child!==element&&element.contains(child))),current=leaves.find(element=>!!element.closest('ins'))??leaves.find(element=>!element.closest('del'));
    const fallback=price?Array.from(price.querySelectorAll('*')).find(element=>cssVisible(element)&&!element.closest('del')&&Array.from(element.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&!!node.textContent?.trim()))??(cssVisible(price)&&Array.from(price.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&!!node.textContent?.trim())?price:undefined):undefined;
    const priceNode=current??fallback,parts=price?Array.from(new Set([...leaves,...leaves.flatMap(element=>Array.from(element.querySelectorAll('*')).filter(child=>cssVisible(child)&&Array.from(child.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&!!node.textContent?.trim())))])):[];
    return{id:Number(card.getAttribute('data-id')),name:heading?.textContent?.replace(/\s+/g,' ').trim()??'',permalink:heading?.href??'',imageUrl:image?.currentSrc||image?.src||'',priceText:price?.textContent?.replace(/\s+/g,' ').trim()??'',onSale:card.classList.contains('sale'),namePaint:heading?paint(heading):undefined,pricePaint:priceNode?{...paint(priceNode),priceState:priceState(priceNode),parts:parts.map(element=>({...paint(element),priceState:priceState(element)}))}:undefined,cardLayout:cardLayout(card,image,heading,price)};
  });});
  let runtime=await nativeCatalogRuntime(widget),previous='',stable=0;
  if(options.carouselExpected){const deadline=Date.now()+(options.timeoutMs??5000);while(Date.now()<deadline){const signature=JSON.stringify([runtime.activeIds,runtime.visibleIds,runtime.cards.map(card=>card.rect),runtime.windowRect]);stable=runtime.initialized&&!runtime.animating&&runtime.visibleIds.length>0?(signature===previous?stable+1:1):0;if(stable>=3)break;previous=signature;await page.waitForTimeout(100);runtime=await nativeCatalogRuntime(widget);}if(stable<3)runtime={...runtime,initialized:false};}
  const evidencePath=options.runDir?path.join(options.runDir,'verification/catalog',viewport,`${blockId}.json`):`observed-dom:${elementId}:${viewport}`;
  const result:CatalogRenderEvidence&{runtime:CatalogRuntimeState}={viewport,blockId,widgetKey,widgetType:'wd_products',elementId,evidence:[evidencePath],catalog,products:products.map(product=>({...product,cardLayout:{...product.cardLayout,evidence:[evidencePath]}})),runtime,...options.carouselExpected?{carousel:{selector:runtime.selector??'',initialized:runtime.initialized,visibleColumns:runtime.visibleIds.length,slideCount:products.length,loop:runtime.loop,cardWidth:runtime.cards.find(card=>card.fraction>=.6)?.rect.width}}:{}};
  if(options.runDir)await writeJson(evidencePath,result);return result;
}
