import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { decodeStoredCredentials } from '../src/core/config.js';
const envelope = {version:1,kind:'clonewp-windows-dpapi-credentials',ciphertext:'a'.repeat(64)};
const credentials = {wp_user:'dpapi-test-user',wp_app_password:'dummy-test-value-中文'};

test('stored plaintext credentials retain their original validation and shape',async()=>{
 assert.deepEqual(await decodeStoredCredentials(credentials),credentials);
 await assert.rejects(decodeStoredCredentials({wp_user:'user',wp_app_password:''}));
});
test('encrypted credentials decrypt only on Windows and parse the credentials JSON in memory',async()=>{
 let calls=0;
 const decrypt=async(cipher:string)=>{calls++;assert.equal(cipher,envelope.ciphertext);return JSON.stringify(credentials);};
 assert.deepEqual(await decodeStoredCredentials(envelope,{platform:'win32',decrypt}),credentials);
 await assert.rejects(decodeStoredCredentials(envelope,{platform:'linux',decrypt}),/require Windows/);assert.equal(calls,1);
});
test('malformed envelopes never invoke decryption and encrypted failures redact subprocess and decrypted content',async()=>{
 const decrypt=async()=>{throw Error('private-password-and-ciphertext');};
 for(const patch of [{version:2},{ciphertext:'not ciphertext'},{extra:'forbidden'}])await assert.rejects(decodeStoredCredentials({...envelope,...patch},{platform:'win32',decrypt}),/^Error: Invalid encrypted credential envelope \[REDACTED\]$/);
 await assert.rejects(decodeStoredCredentials(envelope,{platform:'win32',decrypt}),/^Error: DPAPI credential decryption failed \[REDACTED\]$/);
 for(const text of ['secret malformed JSON','{"wp_user":"secret-user","wp_app_password":""}'])await assert.rejects(decodeStoredCredentials(envelope,{platform:'win32',decrypt:async()=>text}),/^Error: DPAPI credential decryption failed \[REDACTED\]$/);
});
test('real Windows DPAPI roundtrip stays in subprocess pipes without a credential file',{skip:process.platform!=='win32'},async()=>{
 const script="$ErrorActionPreference='Stop'; [Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false); $s=ConvertTo-SecureString -String ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString -SecureString $s));";
 const ciphertext=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify(credentials),encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PSModulePath:undefined},stdio:['pipe','pipe','pipe']}).trim();
 assert.deepEqual(await decodeStoredCredentials({...envelope,ciphertext}),credentials);
 await assert.rejects(decodeStoredCredentials(envelope),/^Error: DPAPI credential decryption failed \[REDACTED\]$/);
});
