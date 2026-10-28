import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import * as css from 'css-tree';
import { z } from 'zod';
import { native44ModuleClass } from './adapters.js';

const ref = z.object({path:z.string().min(1).max(4096),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const formWidthLayoutSchema = z.object({
  version:z.literal(1),kind:z.literal('native44-form-width-layout'),componentKey:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),css:ref,
  fields:z.array(z.object({customId:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/),sourceFieldFactIds:z.array(z.string().min(1).max(240)).length(2)}).strict()).min(1).max(30),
}).strict();
const fail=(code:string):never=>{throw Error(`native44_form_width_layout_${code}`);};
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
async function readBound(root:string,reference:z.infer<typeof ref>):Promise<Buffer>{
  ref.parse(reference);const base=await realpath(root),file=await realpath(path.resolve(root,reference.path)),relative=path.relative(base,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))fail('path_escape');
  const bytes=await readFile(file);if(bytes.length>1_048_576||sha(bytes)!==reference.sha256)fail('hash');return bytes;
}
type Rule={selector:string;min:number;max:number;declarations:Array<{property:string;value:string;important:boolean}>};
const layoutProperties=new Set(['width','min-width','max-width','flex','flex-basis','all','box-sizing','padding','padding-top','padding-right','padding-bottom','padding-left','border','border-top','border-right','border-bottom','border-left','border-width','border-top-width','border-right-width','border-bottom-width','border-left-width','transform','scale','zoom']);
/** Deliberately narrow grammar: unsupported cascade constructs cannot attest layout. */
function rulesOf(text:string):Rule[]{
  let ast:css.CssNode;try{ast=css.parse(text,{parseValue:true,parseCustomProperty:true,onParseError:()=>fail('css_parse')});}catch{return fail('css_parse');}
  const rules:Rule[]=[];
  const visit=(nodes:css.List<css.CssNode>,min:number,max:number,unsupported=false):void=>{
    nodes.forEach(node=>{
      if(node.type==='Atrule'){
        if(node.name.toLowerCase()==='import')fail('css_import');
        if(!node.block)return;
        if(node.name.toLowerCase()!=='media'){visit(node.block.children,min,max,true);return;}
        const query=node.prelude?css.generate(node.prelude):'';
        let lo=min,hi=max;const clauses=query.split(/\s+and\s+/i);
        let valid=clauses.length>0;
        for(const clause of clauses){const match=/^\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)$/i.exec(clause.trim());if(!match){valid=false;continue;}if(match[1].toLowerCase()==='min')lo=Math.max(lo,Number(match[2]));else hi=Math.min(hi,Number(match[2]));}
        visit(node.block.children,lo,hi,unsupported||!valid);return;
      }
      if(node.type!=='Rule')return;
      node.block.children.forEach(child=>{if(child.type==='Rule'||child.type==='Atrule')fail('nested_cascade');});
      const declarations:Array<{property:string;value:string;important:boolean}>=[];
      node.block.children.forEach(d=>{if(d.type==='Declaration'&&layoutProperties.has(d.property.toLowerCase()))declarations.push({property:d.property.toLowerCase(),value:css.generate(d.value),important:!!d.important});});
      if(!declarations.length)return;
      const selector=css.generate(node.prelude);
      if(unsupported&&selector.includes('elementor-field-group'))fail('unsupported_cascade');
      rules.push({selector,min,max,declarations});
    });
  };
  if(ast.type!=='StyleSheet')return fail('stylesheet');visit(ast.children,0,10000);return rules;
}
function px(value:string):number{const match=/^(\d+(?:\.\d+)?)px$/.exec(value);if(!match||!Number.isFinite(Number(match[1]))||Number(match[1])<=0)return fail('literal_px_required');return Number(match[1]);}
/** Also exported for focused pure cascade tests; production always uses the bound loader below. */
export function formWidthAt(cssText:string,componentKey:string,customId:string,viewportWidth:number,ancestorKeys:readonly string[]=[]):number{
  const prefix=`:page .${native44ModuleClass(componentKey)}`,target=`${prefix} .elementor-field-group-${customId}`,generic=`${prefix} .elementor-field-group`;
  const ancestorClasses=ancestorKeys.map(key=>'.'+native44ModuleClass(key));
  if(new Set(ancestorClasses).size!==ancestorClasses.length)fail('ancestor_identity');
  const values=new Map<string,string>(),priorities=new Map<string,number>();
  for(const rule of rulesOf(cssText)){
    // Width declarations in other fields are unrelated. Any potentially matching
    // unknown selector is rejected rather than guessed through specificity.
    const selectors=rule.selector.split(',');
    for(const rawSelector of selectors){
      let selector=rawSelector,ancestorCount=0;
      const formClass='.'+native44ModuleClass(componentKey),formIndex=selector.indexOf(formClass);
      if(formIndex>=0&&selector.includes('elementor-field-group')){
        const before=selector.slice(0,formIndex);
        if(before!==':page '){
          if(!before.startsWith(':page '))fail('ancestor_scope');
          const chain=before.slice(6).trim().split(' ');let previous=-1;
          for(const token of chain){const index=ancestorClasses.indexOf(token);if(index<0||index<=previous)fail('ancestor_scope');previous=index;}
          ancestorCount=chain.length;selector=prefix+selector.slice(formIndex+formClass.length);
        }
      }
      const specificity=3+ancestorCount;
      const set=(property:string,value:string)=>{if((priorities.get(property)??-1)<=specificity){values.set(property,value);priorities.set(property,specificity);}};
      // Compiler-owned module classes belong to containers/widgets, never a
      // Form repeater group. These exact native wrappers are likewise distinct
      // from .elementor-field-group; wildcard/type-div selectors are not.
      if(/(?:^|[ >])\.cwp-n44-[a-f0-9]{12}$/.test(selector)||/(?:^|[ >])\.(?:e-con-inner|elementor-widget-icon|elementor-widget-container|elementor-icon-wrapper|elementor-icon|elementor-heading-title|wd-image|elementor-form-fields-wrapper|elementor-select-wrapper)$/.test(selector)){
        if(rule.declarations.some(d=>['transform','scale','zoom'].includes(d.property)&&!['none','1','normal'].includes(d.value)))fail('ancestor_transform');
        continue;
      }
      // These native control/decoration leaves cannot be the field-group div.
      if(/(?:^|[ >])(?:input|select|textarea|button|img|svg|p|h[1-6])(?:\.[A-Za-z_-][\w-]*)?$/.test(selector)||/(?:^|[ >])(?:textarea)?\.elementor-field$/.test(selector)||/(?:^|[ >])\.elementor-field-label$/.test(selector)||/::(?:before|after)$/.test(selector))continue;
      if(selector===prefix||/^:page \.cwp-n44-[a-f0-9]{12}$/.test(selector)){
        if(rule.declarations.some(d=>['transform','scale','zoom'].includes(d.property)&&!['none','1','normal'].includes(d.value)))fail('ancestor_transform');
        continue;
      }
      // Only a simple terminal sibling field selector is demonstrably unrelated.
      if(selector.startsWith(prefix+' .elementor-field-group-')){
        const tail=selector.slice((prefix+' .elementor-field-group-').length);
        if(/^[A-Za-z][A-Za-z0-9_]*$/.test(tail)&&tail!==customId)continue;
      }
      const isTarget=selector===target,isGeneric=selector===generic||selector==='.elementor-field-group';
      if(!isTarget&&!isGeneric)fail('selector_scope');
      if(selectors.length!==1)fail('selector_list');
      if(viewportWidth<rule.min||viewportWidth>rule.max)continue;
      for(const declaration of rule.declarations){
        if(declaration.important)fail('important');
        if(!isTarget){
          // Global generic selectors have lower specificity. Component generic
          // selectors have equal specificity and participate in source order.
          if(selector==='.elementor-field-group')continue;
        }
        if(declaration.property==='all'||declaration.property==='min-width'||declaration.property==='zoom'||/^border(?:-(?:top|right|bottom|left))?$/.test(declaration.property))fail('unsupported_layout_property');
        if(declaration.property==='scale'&&!['none','1'].includes(declaration.value))fail('scale');
        if(declaration.property==='flex'){
          const match=/^0 0 (\d+(?:\.\d+)?px)$/.exec(declaration.value);if(!match)return fail('fixed_flex_required');set('flex-basis',match[1]);
        }else if(declaration.property==='padding'||declaration.property==='border-width'){
          const pieces=declaration.value.split(/\s+/);if(!pieces.length||pieces.length>4||pieces.some(value=>!/^0(?:px)?$/.test(value)))fail('zero_box_insets_required');
          for(const side of ['top','right','bottom','left'])set(declaration.property==='padding'?`padding-${side}`:`border-${side}-width`,'0');
        }else set(declaration.property,declaration.value);
      }
    }
  }
  if(!['width','max-width','flex-basis'].every(k=>values.has(k)))fail('complete_width_required');
  if(values.get('box-sizing')!=='border-box'||values.get('transform')!=='none'||['top','right','bottom','left'].some(side=>!/^0(?:px)?$/.test(values.get(`padding-${side}`)??'')||!/^0(?:px)?$/.test(values.get(`border-${side}-width`)??'')))fail('border_box_required');
  const width=px(values.get('width')!),maximum=px(values.get('max-width')!),basis=px(values.get('flex-basis')!);
  if(Math.abs(width-basis)>.001||maximum<width)fail('inconsistent_layout');return width;
}
export async function prepareFormWidthLayout(input:{root:string;reference:{path:string;sha256:string};componentKey:string;ancestorKeys?:readonly string[];css?:string;fields:Array<{custom_id:string}>;sourceControls:Array<{snapshotId:string;fieldFactIds:string[]}>}){
  const proof=formWidthLayoutSchema.parse(JSON.parse((await readBound(input.root,input.reference)).toString('utf8')));
  if(proof.componentKey!==input.componentKey)fail('component');
  const bound=(await readBound(input.root,proof.css)).toString('utf8');
  const actualCSS=input.css;
  if(typeof actualCSS!=='string'||!actualCSS.includes(bound)||!bound.trim())return fail('actual_css_required');
  if(new Set(proof.fields.map(f=>f.customId)).size!==proof.fields.length)fail('duplicate_field');
  const seen=new Set<string>();
  for(const field of proof.fields){
    const index=input.fields.findIndex(f=>f.custom_id===field.customId);if(index<0)fail('field');
    const expected=input.sourceControls.map(row=>row.fieldFactIds[index]);
    if(new Set(field.sourceFieldFactIds).size!==2||expected.some(id=>!field.sourceFieldFactIds.includes(id)))fail('source_ownership');
    for(const id of field.sourceFieldFactIds){if(seen.has(id))fail('duplicate_fact');seen.add(id);}
  }
  const verified=new Set<string>();
  return {
    cssHash:sha(actualCSS),references:[input.reference,proof.css],
    verify(customId:string,factId:string,viewportWidth:number,sourceWidth:number):boolean{
      const field=proof.fields.find(f=>f.customId===customId);if(!field)return false;
      if(!field.sourceFieldFactIds.includes(factId))fail('source_field');
      const actual=formWidthAt(actualCSS,input.componentKey,customId,viewportWidth,input.ancestorKeys),boundWidth=formWidthAt(bound,input.componentKey,customId,viewportWidth,input.ancestorKeys);
      if(Math.abs(actual-boundWidth)>.001||!Number.isFinite(sourceWidth)||sourceWidth<=0||Math.abs(actual-sourceWidth)>1)fail('source_footprint');
      verified.add(factId);return true;
    },
    complete(){if([...seen].some(id=>!verified.has(id)))fail('incomplete_source');},
  };
}
export const formWidthCSSHash=sha;
