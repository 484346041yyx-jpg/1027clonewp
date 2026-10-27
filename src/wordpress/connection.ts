import {createHash} from 'node:crypto';
import {NovamiraTransport} from './mcp.js';
import {createWordPressNetwork} from './network.js';
import {WordPressError} from './errors.js';
import type {WordPressCredentials} from './types.js';

type Options=Pick<WordPressCredentials,'targetUrl'|'username'|'applicationPassword'|'fetch'|'timeoutMs'|'networkRoute'>;
const identities=new WeakMap<WordPressConnection,string>();
const identity=(o:Options)=>createHash('sha256').update(JSON.stringify([new URL(o.targetUrl).origin,o.username,o.applicationPassword,o.timeoutMs??45000,o.networkRoute??'environment'])).digest('hex');
/** One command/session shares only the gateway contract and socket pool, never WordPress resource snapshots. */
export class WordPressConnection {
  readonly origin:string;
  readonly mcp:NovamiraTransport;
  readonly fetch:typeof fetch;
  private readonly network:ReturnType<typeof createWordPressNetwork>;
  private closing?:Promise<void>;
  private metrics={httpAttempts:0,httpCompleted:0,httpFailed:0,httpDurationMs:0};
  constructor(options:Options){
    const target=new URL(options.targetUrl),timeout=options.timeoutMs??45000;
    if((target.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(target.hostname))||target.username||target.password||target.search||target.hash||!options.username?.trim()||!options.applicationPassword?.trim()||!Number.isInteger(timeout)||timeout<1||timeout>120000)throw new WordPressError('connection_options_invalid','Invalid WordPress connection options.');
    this.origin=target.origin;identities.set(this,identity(options));
    this.network=createWordPressNetwork(this.origin,options.networkRoute,options.fetch);
    this.fetch=async(input,init)=>{const start=performance.now();this.metrics.httpAttempts++;try{const response=await this.network.fetch(input,init);this.metrics.httpCompleted++;return response;}catch(error){this.metrics.httpFailed++;throw error;}finally{this.metrics.httpDurationMs+=Math.round(performance.now()-start);}};
    const authorization=`Basic ${Buffer.from(`${options.username}:${options.applicationPassword}`).toString('base64')}`;
    const gatewayFetch:typeof fetch=async(input,init={})=>{
      const url=new URL(input instanceof Request?input.url:input.toString(),this.origin);
      if(url.origin!==this.origin||url.pathname!=='/wp-json/mcp/novamira'||url.search||url.hash||url.username||url.password)throw new WordPressError('cross_origin_blocked','Shared gateway requests must stay on the exact configured endpoint.');
      const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((v,k)=>headers.set(k,v));headers.set('Authorization',authorization);
      const signals=[init.signal,input instanceof Request?input.signal:undefined,AbortSignal.timeout(timeout)].filter((s):s is AbortSignal=>Boolean(s));
      let response:Response;try{response=await this.fetch(input,{...init,headers,redirect:'manual',signal:AbortSignal.any(signals)});}catch{throw new WordPressError('network_error','The configured WordPress server did not complete the request.');}
      if(response.status>=300&&response.status<400)throw new WordPressError('redirect_blocked','Authenticated WordPress requests cannot follow redirects.');return response;
    };
    this.mcp=new NovamiraTransport(new URL('/wp-json/mcp/novamira',this.origin),gatewayFetch);
  }
  assertMatches(options:Options):void{if(identities.get(this)!==identity(options))throw new WordPressError('connection_identity_mismatch','Shared WordPress connection target or credentials changed.');}
  diagnostics(){return{route:this.network.route,...this.metrics,gateway:this.mcp.diagnostics()};}
  async close():Promise<void>{return this.closing??=(async()=>{try{await this.mcp.close();}finally{await this.network.close();}})();}
}
