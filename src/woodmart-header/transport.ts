import { createHash } from 'node:crypto';
import { NovamiraTransport } from '../wordpress/mcp.js';
import { WordPressError } from '../wordpress/errors.js';
import {createWordPressNetwork} from '../wordpress/network.js';
import type {WordPressConnection} from '../wordpress/connection.js';
import type { WordPressCredentials } from '../wordpress/types.js';

export class WoodMartHeaderTransportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WoodMartHeaderTransportError';
  }
}

/** Only reviewed, fixed local helpers belong here. Website content must be encoded as data. */
export interface HeaderPHPReadOperation {
  name: string;
  code: string;
  trustedLocalCode: true;
}

/** The caller must persist the exact intent before submitting a mutation. */
export interface HeaderPHPWriteIntent {
  runId: string;
  operationId: string;
  resource: string;
  expectedSnapshotSha256: string;
  persistedIntentSha256: string;
}

export interface HeaderPHPMutationOperation extends HeaderPHPReadOperation {
  intent: HeaderPHPWriteIntent;
}

export interface HeaderPHPOperationEvidence {
  name: string;
  kind: 'read-only' | 'mutation';
  codeSha256: string;
  state: 'started' | 'succeeded' | 'unconfirmed';
  phase: 'ability-contract' | 'php-execution';
  failureCode?: string;
}

export interface HeaderTransportCounts {
  httpAttempts: number;
  httpCompleted: number;
  httpFailed: number;
  phpReads: number;
  phpMutations: number;
}

function fail(code: string, message: string): never { throw new WoodMartHeaderTransportError(code, message); }
const identity = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const digest = /^[a-f0-9]{64}$/;
const validIdentity = (value: unknown): value is string => typeof value === 'string' && identity.test(value);
const safeGatewayCodes = new Set(['invalid_mcp_response', 'mcp_tool_error', 'novamira_tools_missing', 'mcp_connection_failed', 'mcp_tool_missing', 'mcp_call_failed', 'invalid_discovery', 'invalid_ability_schema', 'ability_execution_failed']);

/**
 * Independent transport for the opt-in WHB path. It does not confer resource ownership,
 * classify PHP semantics, or replace the caller's server-side guards and read-back.
 * A successful request is transport evidence only; a failed mutation is never retried.
 */
export class WoodMartHeaderTransport {
  readonly origin: string;
  readonly targetUrl: string;
  private readonly transport: NovamiraTransport;
  private readonly sharedConnection?:WordPressConnection;
  private readonly network?:ReturnType<typeof createWordPressNetwork>;
  private mutationInFlight = false;
  private abilityReady?: Promise<void>;
  private readonly evidence: HeaderPHPOperationEvidence[] = [];
  private readonly counts: HeaderTransportCounts = { httpAttempts: 0, httpCompleted: 0, httpFailed: 0, phpReads: 0, phpMutations: 0 };

  constructor(options: Pick<WordPressCredentials, 'targetUrl' | 'username' | 'applicationPassword' | 'fetch' | 'timeoutMs'|'networkRoute'>,connection?:WordPressConnection) {
    let target: URL;
    try { target = new URL(options.targetUrl); } catch { throw new WoodMartHeaderTransportError('invalid_target', 'A valid HTTPS WordPress target is required.'); }
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
      fail('invalid_target', 'A credential-free HTTPS WordPress target is required.');
    }
    if (!options.username?.trim() || !options.applicationPassword?.trim()) fail('invalid_credentials', 'WordPress credentials are required.');
    const timeoutMs = options.timeoutMs ?? 45_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail('invalid_timeout', 'The request timeout must be between 1 and 120000 milliseconds.');
    this.origin = target.origin;
    this.targetUrl = `${this.origin}/`;
    const authorization = `Basic ${Buffer.from(`${options.username}:${options.applicationPassword}`).toString('base64')}`;
    if(connection){connection.assertMatches(options);this.sharedConnection=connection;}
    else this.network=createWordPressNetwork(this.origin,options.networkRoute,options.fetch);
    const fetchImpl = connection?.fetch ?? this.network!.fetch;
    const authenticatedFetch: typeof globalThis.fetch = async (input, init = {}) => {
      let url: URL;
      try { url = new URL(input instanceof Request ? input.url : input.toString(), this.origin); }
      catch { return fail('invalid_request', 'The WordPress request URL is invalid.'); }
      if (url.origin !== this.origin || url.username || url.password || url.pathname !== '/wp-json/mcp/novamira' || url.search || url.hash) {
        fail('request_boundary_blocked', 'The WordPress request left the exact same-origin Novamira endpoint.');
      }
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      headers.set('Authorization', authorization);
      const inputSignal = input instanceof Request ? input.signal : undefined;
      const signals = [init.signal, inputSignal, AbortSignal.timeout(timeoutMs)].filter((value): value is AbortSignal => Boolean(value));
      const signal = AbortSignal.any(signals);
      this.counts.httpAttempts++;
      let response: Response;
      try {
        response = await fetchImpl(input instanceof Request ? new Request(url, input) : url, { ...init, headers, redirect: 'manual', signal });
        this.counts.httpCompleted++;
      } catch {
        this.counts.httpFailed++;
        return fail('network_error', 'The configured WordPress server did not complete the request.');
      }
      if (response.status >= 300 && response.status < 400) fail('redirect_blocked', 'Authenticated WordPress redirects are blocked.');
      return response;
    };
    this.transport = connection?.mcp ?? new NovamiraTransport(new URL('/wp-json/mcp/novamira', this.origin), authenticatedFetch);
  }

  diagnostics(): { counts: HeaderTransportCounts; operations: HeaderPHPOperationEvidence[] } {
    return { counts: { ...this.counts }, operations: this.evidence.map(entry => ({ ...entry })) };
  }

  private validateOperation(operation: HeaderPHPReadOperation): void {
    if (!operation || operation.trustedLocalCode !== true || !validIdentity(operation.name) || typeof operation.code !== 'string' || !operation.code.trim() || Buffer.byteLength(operation.code, 'utf8') > 2 * 1024 * 1024) {
      fail('invalid_php_operation', 'A named, bounded, trusted local PHP helper is required.');
    }
  }

  private validateIntent(intent: HeaderPHPWriteIntent): void {
    if (!intent || !validIdentity(intent.runId) || !validIdentity(intent.operationId) || !validIdentity(intent.resource) || !digest.test(intent.expectedSnapshotSha256) || !digest.test(intent.persistedIntentSha256)) {
      fail('invalid_write_intent', 'A mutation requires a named persisted intent and expected snapshot digests.');
    }
  }

  private async ready(): Promise<void> {
    if (!this.abilityReady) this.abilityReady = (async () => {
      const abilities = await this.transport.discover();
      if (!abilities.some(ability => ability.name === 'novamira/execute-php')) fail('php_ability_missing', 'The target does not expose the required PHP ability.');
      const info = await this.transport.info('novamira/execute-php');
      const properties = info.input_schema?.properties as Record<string, unknown> | undefined;
      if (info.input_schema?.type !== 'object' || !properties?.code || (properties.code as Record<string, unknown>).type !== 'string') {
        fail('php_schema_changed', 'The target PHP ability schema does not match the supported contract.');
      }
    })().catch(error=>{this.abilityReady=undefined;throw error;});
    await this.abilityReady;
  }

  private async submit<T>(operation: HeaderPHPReadOperation, kind: HeaderPHPOperationEvidence['kind']): Promise<T> {
    const proof: HeaderPHPOperationEvidence = { name: operation.name, kind, codeSha256: createHash('sha256').update(operation.code).digest('hex'), state: 'started', phase: 'ability-contract' };
    this.evidence.push(proof);
    try {
      await this.ready();
      proof.phase = 'php-execution';
      if (kind === 'read-only') this.counts.phpReads++; else this.counts.phpMutations++;
      const value = await this.transport.execute('novamira/execute-php', { code: operation.code });
      if (!value || typeof value !== 'object' || (value as Record<string, unknown>).success !== true || !Object.hasOwn(value, 'return_value')) {
        fail('php_operation_rejected', 'The bounded WordPress PHP operation did not return a confirmed result.');
      }
      proof.state = 'succeeded';
      return (value as { return_value: T }).return_value;
    } catch (error) {
      proof.state = 'unconfirmed';
      if (error instanceof WoodMartHeaderTransportError) { proof.failureCode = error.code; throw error; }
      if (error instanceof WordPressError && safeGatewayCodes.has(error.code)) {
        proof.failureCode = `gateway_${error.code}`;
        fail(proof.failureCode, `The WordPress ${proof.phase} request was not confirmed (${error.code}); reconcile before any mutation retry.`);
      }
      // Remote error text, PHP output, URLs and causes may contain credentials or tokens.
      proof.failureCode = 'php_transport_failed';
      fail('php_transport_failed', 'The WordPress PHP request was not confirmed; reconcile before any mutation retry.');
    }
  }

  async readPHP<T = unknown>(operation: HeaderPHPReadOperation): Promise<T> {
    this.validateOperation(operation);
    return this.submit<T>(operation, 'read-only');
  }

  async executePHP<T = unknown>(operation: HeaderPHPMutationOperation): Promise<T> {
    this.validateOperation(operation);
    this.validateIntent(operation.intent);
    if (this.mutationInFlight) fail('concurrent_mutation_blocked', 'Header and menu mutations must be submitted serially.');
    this.mutationInFlight = true;
    try { return await this.submit<T>(operation, 'mutation'); }
    finally { this.mutationInFlight = false; }
  }

  async close(): Promise<void> {
    if(this.sharedConnection)return;
    try { try{await this.transport.close();}finally{await this.network?.close();} }
    catch { fail('close_failed', 'The WordPress transport did not close cleanly.'); }
  }
}
