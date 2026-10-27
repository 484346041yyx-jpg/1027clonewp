import {z} from 'zod';

/** WoodMart menu-item settings, independent from a page or brand. */
export const headerDropdownSchema=z.object({
  design:z.enum(['default','full-width','sized']),
  width:z.number().int().min(200).max(2560).optional(),
  height:z.number().int().min(100).max(1600).optional(),
  padding:z.number().int().min(0).max(200).optional(),
  colorScheme:z.enum(['default','light','dark']),
  event:z.enum(['hover','click']),
}).strict().superRefine((v,c)=>{if(v.design==='sized'&&!v.width)c.addIssue({code:'custom',message:'Sized dropdown requires width'});if(v.design!=='sized'&&(v.width!==undefined||v.height!==undefined))c.addIssue({code:'custom',message:'Dimensions belong to sized dropdowns'});});
export type HeaderDropdownSettings=z.infer<typeof headerDropdownSchema>;
export function compileHeaderDropdown(input:HeaderDropdownSettings):Record<string,string>{
  const d=headerDropdownSchema.parse(input);
  return {'_menu_item_design':d.design,'_menu_item_width':d.width===undefined?'':String(d.width),'_menu_item_height':d.height===undefined?'':String(d.height),'_menu_item_padding':d.padding===undefined?'':String(d.padding),'_menu_item_colorscheme':d.colorScheme==='default'?'':d.colorScheme,'_menu_item_event':d.event,'_menu_item_dropdown-ajax':'no'};
}
