import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {validateSourceFontBytes} from '../src/wordpress/source-font.js';import {importNative44Media,importNative44SourceFonts} from '../src/native44/media.js';import {sourceFontFixture} from './fixtures/source-font.js';
test('explicit TTF source rejects other formats, truncated or duplicate tables and out-of-file ranges',()=>{
 const bytes=sourceFontFixture();assert.doesNotThrow(()=>validateSourceFontBytes(bytes,'font/ttf'));
 for(const mime of ['image/png','font/woff2','application/octet-stream'])assert.throws(()=>validateSourceFontBytes(bytes,mime));
 for(const mutate of [(b:Buffer)=>b.writeUInt32BE(0x4f54544f,0),(b:Buffer)=>b.writeUInt16BE(129,4),(b:Buffer)=>b.writeUInt32BE(0xffffffff,20),(b:Buffer)=>b.write('head',28,'ascii'),(b:Buffer)=>b.write('xxxx',12,'ascii')]){const bad=Buffer.from(bytes);mutate(bad);assert.throws(()=>validateSourceFontBytes(bad,'font/ttf'));}
 assert.throws(()=>validateSourceFontBytes(bytes.subarray(0,40),'font/ttf'));
});
test('source fonts share durable media intents, unknown-result reconciliation and byte deduplication',async()=>{
 const root=await realpath('D:/cloneWP'),dir=await mkdtemp(path.join(root,'.cache','source-font-')),file=path.join(dir,'font.ttf'),bytes=sourceFontFixture(),sha=createHash('sha256').update(bytes).digest('hex');await writeFile(file,bytes);
 let uploads=0,present=false;const imported={attachmentId:42,url:'https://target.example/font.ttf',mimeType:'font/ttf',sha256:sha,sourceUrl:'https://source.example/font.ttf'};
 const client:any={verifyImportedAssets:async()=>{},inspectPendingAsset:async()=>({status:present?'attachment-present':'absent'}),importSourceFont:async(_file:string,options:any)=>{if(options.requireExisting){if(present)return imported;throw Object.assign(Error('Not found'),{code:'existing_asset_required'})}uploads++;await options.onCheckpoint({phase:'registering',remoteWriteStarted:true});present=true;throw Error('Synthetic response loss')}};
 const options={client,root,jobDir:dir,runDir:dir,runId:'font-fixture',pageId:77,manifest:[{key:'font',localPath:file,sourceUrl:imported.sourceUrl,sha256:sha,mediaType:'font/ttf'},{key:'alias',localPath:file,sourceUrl:imported.sourceUrl,sha256:sha,mediaType:'font/ttf'}],required:['font','alias']};
 try{await assert.rejects(importNative44SourceFonts(options));assert.equal(JSON.parse(await readFile(path.join(dir,'assets','ledger.json'),'utf8')).assets[0].status,'unknown');const result=await importNative44SourceFonts(options);assert.equal(uploads,1);assert.deepEqual(result.map(a=>a.attachmentId),[42,42]);await importNative44SourceFonts(options);assert.equal(uploads,1);
 await assert.rejects(importNative44Media({...options,runDir:path.join(dir,'image-only'),client:{...client,importAsset:client.importSourceFont}}));
 }finally{const actual=await realpath(dir);assert.ok(actual.toLowerCase().startsWith(root.toLowerCase()+path.sep));assert.equal(actual.toLowerCase(),dir.toLowerCase());await rm(actual,{recursive:true,force:true})}
});
