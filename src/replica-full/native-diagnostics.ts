import type { HeaderModuleDriver } from '../woodmart-header/generic/wordpress.js';

const transportCodes = new Set([
  'network_error', 'redirect_blocked', 'request_boundary_blocked', 'concurrent_mutation_blocked',
  'php_ability_missing', 'php_schema_changed', 'php_operation_rejected', 'php_transport_failed',
  'invalid_php_operation', 'invalid_write_intent', 'invalid_request',
  ...['invalid_mcp_response', 'mcp_tool_error', 'novamira_tools_missing', 'mcp_connection_failed', 'mcp_tool_missing', 'mcp_call_failed', 'invalid_discovery', 'invalid_ability_schema', 'ability_execution_failed'].map(code => `gateway_${code}`),
]);
export interface NativeHeaderMutationFailure { code: string; operationId: string | null; action: string }

/** Preserve bounded diagnostics across the legacy service's intentional unknown-write catch. */
export function captureNativeHeaderFailure(delegate: HeaderModuleDriver): { driver: HeaderModuleDriver; failure(): NativeHeaderMutationFailure | null } {
  let failure: NativeHeaderMutationFailure | null = null;
  return {
    failure: () => failure && { ...failure },
    driver: {
      inspect: (...args) => delegate.inspect(...args),
      async mutate(identity, request, intent) {
        try { return await delegate.mutate(identity, request, intent); }
        catch (error) {
          const value = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown } : {};
          const code = typeof value.message === 'string' && /^woodmart_header_driver_[a-z0-9_]{1,100}$/.test(value.message) ? value.message
            : typeof value.code === 'string' && transportCodes.has(value.code) ? `replica_full_native_header_${value.code}`
              : 'replica_full_native_header_mutation_unconfirmed';
          failure = { code, operationId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(request.operationId) ? request.operationId : null, action: request.action };
          throw error;
        }
      },
    },
  };
}
