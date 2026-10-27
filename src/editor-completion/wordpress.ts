import { readFile } from 'node:fs/promises';
import { canonicalFullReplicaJson } from '../replica-full/json.js';
import type { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { checkEditorObservation, editorHash, type EditorDocument, type EditorIntent, type EditorScope } from './contract.js';
import type { EditorDriver } from './store.js';

export class WordPressEditorCompletion implements EditorDriver {
  constructor(private transport: Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>) {}
  private async code(scope: EditorScope, data: object) {
    if (scope.targetOrigin !== this.transport.origin) throw Error('editor_completion_target_changed');
    const encoded = Buffer.from(canonicalFullReplicaJson({ scope, ...data })).toString('base64');
    const [helper, comparison] = await Promise.all([readFile(new URL('./wordpress.php', import.meta.url), 'utf8'), readFile(new URL('./settings-equivalence.php', import.meta.url), 'utf8')]);
    const marker = '/* native-settings-equivalence */';
    if (helper.split(marker).length !== 2) throw Error('editor_completion_comparison_adapter_changed');
    return `$input=json_decode(base64_decode('${encoded}'),true);\n${helper.replace(marker, comparison)}`;
  }
  private result(value: any, scope: EditorScope) { if (value?.ok !== true) throw Error(/^editor_completion_[a-z_]+$/.test(value?.code) ? value.code : 'editor_completion_response_unconfirmed'); return checkEditorObservation(value.value, scope); }
  async inspect(scope: EditorScope, expected: EditorDocument, previous: EditorDocument[]) { return this.result(await this.transport.readPHP({ name: 'editor-completion.inspect', trustedLocalCode: true, code: await this.code(scope, { action: 'inspect', expected, previous }) }), scope); }
  async align(intent: EditorIntent, intentHash: string) {
    if (editorHash(intent) !== intentHash) throw Error('editor_completion_intent_changed');
    return this.result(await this.transport.executePHP({ name: 'editor-completion.align', trustedLocalCode: true, intent: { runId: intent.scope.runId, operationId: intent.operationId, resource: `page/${intent.scope.pageId}/autosaves`, expectedSnapshotSha256: editorHash(intent.before), persistedIntentSha256: intentHash }, code: await this.code(intent.scope, { action: 'align', expected: intent.expected, previous: intent.previous, before: intent.before, operationId: intent.operationId }) }), intent.scope);
  }
}
