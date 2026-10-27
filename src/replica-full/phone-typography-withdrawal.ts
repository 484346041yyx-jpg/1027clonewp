import {fullReplicaHash} from './contract.js';
import type {FullReplicaManifest} from './types.js';
import type {Native44Program} from '../native44/types.js';
const fail=(reason:string):never=>{throw Error('replica_full_phone_typography_withdrawal_'+reason);};
const ids=['phone390:text:phone390-t367','phone430:text:phone430-t367'];
const controls=['typography_font_size_mobile','typography_line_height_mobile'];
/** A single literal correction: withdraw two falsely universal mobile native
 * plans, preserving their original rows and all range CSS/source metadata. */
export function assertPhoneTypographyWithdrawal(beforeProgram:Native44Program,afterProgram:Native44Program,before:FullReplicaManifest['responsive'],after:FullReplicaManifest['responsive'],withdrawn:unknown[]) {
 if(fullReplicaHash(beforeProgram)!==fullReplicaHash(afterProgram)||!before||!after)fail('program_or_responsive_identity');
 const expected=structuredClone(before!),section=expected.sections.find(s=>s.key==='workshops');if(!section) return fail('section');
 const rows=(section.nativeStyleSettings??[]).filter(row=>row.componentKey==='workshops_heading'&&controls.includes(row.setting.controlId));
 if(rows.length!==2||fullReplicaHash(rows)!==fullReplicaHash(withdrawn))fail('exact_removed_rows');
 for(const [index,row] of rows.entries())if(row.setting.controlId!==controls[index]||row.setting.minWidth!==1||row.setting.maxWidth!==768||fullReplicaHash(row.setting.value)!==fullReplicaHash({size:index===0?20:28,unit:'px'})||fullReplicaHash(row.setting.sourceFactIds)!==fullReplicaHash([ids[0]]))fail('exact_previous_value');
 for(const [index,id]of ids.entries())if(!section.styleBindings?.some(row=>row.componentKey==='workshops_heading'&&row.binding.sourceFactId===id&&row.binding.selector===' .elementor-heading-title'&&row.binding.minWidth===(index===0?1:410)&&row.binding.maxWidth===(index===0?409:768)&&['font-size','line-height'].every(property=>row.binding.properties.includes(property))))fail('retained_source_range_binding');
 section.nativeStyleSettings=section.nativeStyleSettings!.filter(row=>!rows.includes(row));
 if(fullReplicaHash(expected)!==fullReplicaHash(after))fail('other_responsive_change');
}
export function assertPhoneTypographyWithdrawalSource(source:any) {
 for(const [index,id] of ids.entries()){
  const fact=source?.facts?.[id],snapshot=source?.snapshots?.find((row:any)=>row.id===fact?.snapshotId);
  if(!fact||snapshot?.viewport?.width!==(index===0?390:430)||fact.kind!=='text'||fact.nodeId!==`phone${index===0?390:430}-n691`||fact.value?.style?.['font-size']!==(index===0?'20px':'24px')||fact.value?.style?.['line-height']!==(index===0?'28px':'33.6px'))fail('actual_phone_source');
 }
}
