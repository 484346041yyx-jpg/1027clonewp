import { readFile } from 'node:fs/promises';
import { fullReplicaHash } from './contract.js';
import { assertNative44Compilation } from '../native44/compiler.js';
import type { Native44Compiled } from '../native44/types.js';
import { compileEditorElements } from '../wordpress/editor-serialization.js';
import type { LegacySchema } from '../wordpress/types.js';
import type { WoodMartHeaderTransport, HeaderPHPWriteIntent } from '../woodmart-header/transport.js';

export type PublicAction='create-preview'|'adopt-preview'|'create-footer'|'save-footer'|'save-preview';
export type PublicDocument={id:number;title:string;status:'draft';slug:string;content:string;elements:any[];settings:Record<string,unknown>;template:string;headerId:string|null;editUrl:string;previewUrl:string};
export interface PublicSnapshot {preview:PublicDocument|null;footer:PublicDocument|null;globalHash:string;receipts:Record<string,{action:PublicAction;state:'started'|'complete';payloadHash:string;result?:{id:number}}>}
export interface PublicInspection {snapshot:PublicSnapshot;hash:string}
/** json_decode(..., true) represents empty JSON objects as empty PHP arrays. */
export function publicPayloadHash(value:unknown):string{const normalize=(v:unknown):unknown=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.keys(v).length?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):[]:v;return fullReplicaHash(normalize(value));}
export class PublicResourceDriver {
  constructor(private transport:Pick<WoodMartHeaderTransport,'origin'|'readPHP'|'executePHP'>,private identity:{targetOrigin:string;runId:string;contractHash:string}){
    if(transport.origin!==identity.targetOrigin)throw Error('replica_full_public_target');
  }
  private async code(data:Record<string,unknown>){const json=JSON.stringify({...this.identity,...data});return `$input=json_decode(base64_decode('${Buffer.from(json).toString('base64')}'),true);\n${await readFile(new URL('./public-driver.php',import.meta.url),'utf8')}`;}
  private unwrap(value:any):PublicInspection{if(!value?.ok||!value.value?.snapshot||!/^[a-f0-9]{64}$/.test(value.value.hash))throw Error('replica_full_'+(/^public_[a-z0-9_]+$/.test(value?.code)?value.code:'public_response'));return value.value;}
  async inspect(){return this.unwrap(await this.transport.readPHP({name:'full-public.inspect',code:await this.code({action:'inspect'}),trustedLocalCode:true}));}
  async mutate(action:PublicAction,payload:Record<string,unknown>,before:PublicInspection,intent:HeaderPHPWriteIntent,compiled?:Native44Compiled,schemas?:Record<string,LegacySchema>){
    if(intent.runId!==this.identity.runId||intent.resource!==`public-resources/${this.identity.runId}`||intent.expectedSnapshotSha256!==before.hash||!/^[a-f0-9]{64}$/.test(intent.persistedIntentSha256))throw Error('replica_full_public_intent');
    if(Object.values(before.snapshot.receipts).some(r=>r.state!=='complete'))throw Error('replica_full_public_reconcile_required');
    if(action==='save-footer'){if(!compiled||!schemas)throw Error('replica_full_public_compiler_required');assertNative44Compilation(compiled,compiled.composition);if(fullReplicaHash(payload.elements)!==fullReplicaHash(compileEditorElements(compiled.composition.elements,schemas,{executionStrategy:'native44-css-handoff'})))throw Error('replica_full_public_compilation_changed');}
    return this.unwrap(await this.transport.executePHP({name:`full-public.${action}`,code:await this.code({action,payload,expectedHash:before.hash,operationId:intent.operationId}),trustedLocalCode:true,intent}));
  }
}
