import { getAssetImportFailure, type WordPressClient, type RecoverableAssetImportOptions, type ImportedAsset } from '../wordpress/client.js';

export async function importAssetAttemptV2(client: Pick<WordPressClient, 'importAsset'>, localPath: string, options: RecoverableAssetImportOptions): Promise<ImportedAsset> {
  for (let attempt = 0; ; attempt++) try { return await client.importAsset(localPath, options); }
  catch (error) { const state = getAssetImportFailure(error), value = error as { code?: string; message?: string; status?: number }; if (state?.remoteWriteStarted !== false || attempt >= 2 || !/network_error|timeout|temporar|ECONNRESET|fetch failed|invalid.*(?:json|response)|machine-readable JSON|unexpected token/i.test(`${value.code ?? ''} ${value.message ?? ''}`)) throw error; }
}
