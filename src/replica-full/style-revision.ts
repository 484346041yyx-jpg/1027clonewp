import {fullReplicaHash} from './contract.js';
import type {FullReplicaRemoteSnapshot} from './driver.js';
import {createHash} from 'node:crypto';import{canonicalV2}from'../replica-v2/journal.js';
/** Reconcile a completed native receipt without repeating the write. */
export function assertCompletedStyleRevision(before:FullReplicaRemoteSnapshot,current:FullReplicaRemoteSnapshot,input:{operationId:string;payloadHash:string;css:string}){
 const fail=():never=>{throw Error('replica_full_style_revision_recovery_changed');},digest=(v:unknown)=>createHash('sha256').update(canonicalV2(v)).digest('hex'),same=(a:unknown,b:unknown)=>digest(a)===digest(b);
 const a=before.page,b=current.page,r=current.receipts[input.operationId];
 if(!a||!b||a.status!=='draft'||b.status!=='draft'||!a.headerId||a.pageId!==b.pageId||a.runId!==b.runId||a.headerId!==b.headerId||r?.state!=='complete'||r.action!=='style'||r.payloadHash!==input.payloadHash||input.payloadHash!==fullReplicaHash({pageId:a.pageId,css:input.css})||!same(r.result,{pageId:a.pageId})||before.receipts[input.operationId]||b.settings.custom_css!==input.css)fail();
 const expected=structuredClone(before);expected.page!.settings.custom_css=input.css;expected.page!.bodyHash=b!.bodyHash;expected.hash=current.hash;expected.header.hash=current.header.hash;
 const oldPage=expected.header.snapshot.module?.pages[String(a!.pageId)],newPage=current.header.snapshot.module?.pages[String(a!.pageId)];if(!oldPage||!newPage)fail();
 oldPage!.bodyHash=newPage!.bodyHash;oldPage!.snapshotHash=newPage!.snapshotHash;expected.receipts[input.operationId]=r!;
 if(!same(expected,current))fail();
}
