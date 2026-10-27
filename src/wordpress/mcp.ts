import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WordPressError } from './errors.js';
import type { AbilityInfo } from './types.js';

/** Parse MCP structured output, or the JSON text emitted by WordPress MCP Adapter. */
export function decodeToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') throw new WordPressError('invalid_mcp_response', 'MCP returned no structured result.');
  const value = result as Record<string, unknown>;
  if (value.isError) throw new WordPressError('mcp_tool_error', 'The WordPress MCP tool reported an error.');
  if (value.structuredContent !== undefined) return value.structuredContent;
  const content = Array.isArray(value.content) ? value.content as Array<Record<string, unknown>> : [];
  const texts = content.filter(x => x.type === 'text' && typeof x.text === 'string');
  for (const item of texts) {
    try { return JSON.parse(item.text as string); } catch { /* Inspect the next text block. */ }
  }
  throw new WordPressError('invalid_mcp_response', 'MCP did not return machine-readable JSON.');
}

export class NovamiraTransport {
  private client?: Client;
  private connecting?: Promise<void>;
  private closing?:Promise<void>;
  private registry?:Promise<AbilityInfo[]>;
  private readonly schemas=new Map<string,Promise<AbilityInfo>>();
  private metrics={connections:0,registryReads:0,schemaReads:0,executions:0};
  private discoverTool?: string;
  private infoTool?: string;
  private executeTool?: string;
  constructor(private readonly endpoint: URL, private readonly fetcher: typeof globalThis.fetch) {}

  diagnostics(){return {...this.metrics};}

  async connect(): Promise<void> {
    if(this.closing)await this.closing;
    if (this.client) return;
    if(this.connecting)return this.connecting;
    this.connecting=this.open();
    try{await this.connecting;}finally{this.connecting=undefined;}
  }
  private async open():Promise<void>{
    this.metrics.connections++;
    const client = new Client({ name: 'clonewp', version: '0.1.0' }, { capabilities: {} });
    // WordPress represents an absent input schema as [], while MCP requires an object.
    // Canonicalize only these empty schema maps before the SDK validates tool output.
    const normalizeFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await this.fetcher(input, init);
      if (!(response.headers.get('content-type') ?? '').includes('application/json')) return response;
      const wire = await response.clone().json().catch(() => undefined) as { result?: { structuredContent?: Record<string, unknown> } } | undefined;
      const structured = wire?.result?.structuredContent;
      let normalized = false;
      for (const key of ['input_schema', 'output_schema']) {
        if (Array.isArray(structured?.[key]) && (structured![key] as unknown[]).length === 0) {
          structured![key] = { type: 'object', properties: {} }; normalized = true;
        }
      }
      if (!normalized) return response;
      const headers = new Headers(response.headers); headers.delete('content-length');
      return new Response(JSON.stringify(wire), { status: response.status, headers });
    };
    const transport = new StreamableHTTPClientTransport(this.endpoint, { fetch: normalizeFetch });
    try {
      await client.connect(transport);
      const listing = await client.listTools();
      const find = (role: string) => listing.tools.find(x => x.name.replace(/[^a-z]/gi, '').toLowerCase().endsWith(role))?.name;
      this.discoverTool = find('discoverabilities');
      this.infoTool = find('getabilityinfo');
      this.executeTool = find('executeability');
      if (!this.discoverTool || !this.infoTool || !this.executeTool) {
        throw new WordPressError('novamira_tools_missing', 'Novamira did not expose the three WordPress ability gateway tools.');
      }
      this.client = client;
    } catch (error) {
      await client.close().catch(() => undefined);
      if (error instanceof WordPressError) throw error;
      throw new WordPressError('mcp_connection_failed', 'Could not establish the configured Novamira MCP connection.');
    }
  }

  private async call(name: string | undefined, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    if (!name) throw new WordPressError('mcp_tool_missing', 'An expected discovered gateway tool is unavailable.');
    try { return decodeToolResult(await this.client!.callTool({ name, arguments: args })); }
    catch (error) {
      if (error instanceof WordPressError) throw error;
      throw new WordPressError('mcp_call_failed', 'The authenticated WordPress MCP request failed.');
    }
  }

  async discover(): Promise<AbilityInfo[]> {
    await this.connect();
    if(!this.registry){this.metrics.registryReads++;this.registry=this.call(this.discoverTool,{}).then(value=>{const output=value as Record<string,unknown>;if(!Array.isArray(output.abilities))throw new WordPressError('invalid_discovery','Novamira did not return an abilities registry.');return output.abilities.filter(x=>x&&typeof x==='object'&&typeof x.name==='string') as AbilityInfo[];}).catch(error=>{this.registry=undefined;throw error;});}
    return structuredClone(await this.registry);
  }

  async info(name: string): Promise<AbilityInfo> {
    await this.connect();
    let pending=this.schemas.get(name);if(!pending){this.metrics.schemaReads++;pending=this.call(this.infoTool,{ability_name:name}).then(output=>{if(!output||typeof output!=='object')throw new WordPressError('invalid_ability_schema','The live ability schema is missing.');return{name,...output as Record<string,unknown>};}).catch(error=>{this.schemas.delete(name);throw error;});this.schemas.set(name,pending);}return structuredClone(await pending);
  }

  async execute(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    this.metrics.executions++;
    const output = await this.call(this.executeTool, { ability_name: name, parameters });
    if (output && typeof output === 'object' && 'success' in output && 'data' in output) {
      const wrapped = output as Record<string, unknown>;
      if (wrapped.success !== true) throw new WordPressError('ability_execution_failed', 'WordPress rejected the requested ability execution.');
      return wrapped.data;
    }
    return output;
  }

  async close(): Promise<void> {
    if(this.closing)return this.closing;
    this.closing=(async()=>{await this.connecting?.catch(()=>undefined);const client=this.client;this.client=undefined;this.registry=undefined;this.schemas.clear();await client?.close();})();
    try{await this.closing;}finally{this.closing=undefined;}
  }
}
