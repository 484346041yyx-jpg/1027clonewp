import {nativeProductRequestPHP} from '../wordpress/native-product-request.js';
import type {CurrentProductSelection} from '../native44/current-product.js';
import { WordPressHeaderModuleDriver } from '../woodmart-header/generic/wordpress.js';
import type { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { normalizeFullReplicaHeaderHelper } from './native-helper.js';
import type { HeaderMenuContentClient } from '../woodmart-header/generic/menu-content.js';

type NativeTransport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;

/** Reuse native contracts, ownership and CAS; normalize only the new flow's helper. */
export class FullReplicaHeaderModuleDriver extends WordPressHeaderModuleDriver {
  constructor(transport: NativeTransport, contentClient?: HeaderMenuContentClient,currentRecord?:CurrentProductSelection) {
    const scoped=(code:string)=>{const normalized=normalizeFullReplicaHeaderHelper(code,!!currentRecord);return currentRecord?nativeProductRequestPHP(currentRecord.productId,normalized):normalized;};
    super({
      origin: transport.origin,
      readPHP: operation => transport.readPHP({ ...operation, code: scoped(operation.code) }),
      executePHP: operation => transport.executePHP({ ...operation, code: scoped(operation.code) }),
    }, contentClient);
  }
}
