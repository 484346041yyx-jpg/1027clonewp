import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WordPressClient, WordPressError, getAssetImportFailure, type ElementorElement } from '../src/wordpress/client.js';
import { importAssetAttemptV2 } from '../src/assets/import-attempt.js';
import { decodeToolResult } from '../src/wordpress/mcp.js';
import { zipEntries } from '../src/wordpress/bootstrap.js';
import { createNative44CSSModel, compileNative44CSSModel } from '../src/native44/css-model.js';
import { prepareNative44RevisionSnapshot } from '../src/native44/revision-snapshot.js';
import { fingerprintMediaTransformationBytes } from '../src/assets/media-transformation.js';
import { applyNative44CurrentCSSCorrections } from '../src/native44/current-css-patch.js';
import { documentHashV2 } from '../src/replica-v2/journal.js';
import { sourceFontFixture } from './fixtures/source-font.js';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { LegacySchema } from '../src/wordpress/types.js';
import { currentProductFixture } from './fixtures/current-product.js';

async function fakeWordPress(options: { productRead?: () => unknown; native44?: boolean; adminAccess?: boolean; adminRedirectPath?: string;networkRoute?:'direct'; registeredSchemas?: Record<string, LegacySchema>; compressedCapabilities?: boolean } = {}) {
  const state = { calls: [] as Array<{ name: string; args: Record<string, unknown> }>, phpCodes: [] as string[], elements: [] as ElementorElement[], settings: {} as Record<string, unknown>, title: 'Fixture', runId: '', exists: false, failSave: false, corruptSave: false, changeBeforeSave: false, atomic: false, cachedMediaValid: true, catalogOverride: undefined as unknown, postsOverride: undefined as unknown, reviewStatusOverride: undefined as unknown,existingMedia:false,mediaIdentityValid:true,mediaOverride:undefined as unknown, failMediaLookupCount: 0, loseUploadResponse: false, loseRegisterResponse: false, stagedBytes: 0, uploads: 0, pendingAttachmentIds: [] as number[] };
  const schemas: Record<string, LegacySchema> = {
    container: { type: 'container', class: 'Elementor\\Container', controls: { content_width: { type: 'select', options: { full: 'Full Width', boxed: 'Boxed' } }, flex_direction: { type: 'choose', options: { row: {}, column: {} } }, width: { type: 'slider', responsive: { max: 'desktop' }, size_units: ['px', '%', 'custom'] }, width_tablet: { type: 'slider', responsive: { max: 'tablet' }, size_units: ['px', '%', 'custom'] }, width_mobile: { type: 'slider', responsive: { max: 'mobile' }, size_units: ['px', '%', 'custom'] } } },
    heading: { type: 'heading', class: 'Elementor\\Widget_Heading', controls: { title: { type: 'textarea' }, header_size: { type: 'select', options: { h1: 'H1', h2: 'H2' } } } },
  };
  const json = (response: ServerResponse, status: number, value?: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(value === undefined ? undefined : JSON.stringify(value));
  };
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.authorization !== `Basic ${Buffer.from('fixture:secret').toString('base64')}`) return json(response, 401, { code: 'rest_not_logged_in' });
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    if (request.url === '/wp-json/mcp/novamira') {
      if (request.method === 'GET') return json(response, 405, { code: 'method_not_allowed' });
      if (request.method === 'DELETE') return json(response, 204);
      const rpc = body ? JSON.parse(body) : {};
      if (!('id' in rpc)) return json(response, 202);
      const result = (value: unknown) => json(response, 200, { jsonrpc: '2.0', id: rpc.id, result: value });
      if (rpc.method === 'initialize') return result({ protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Novamira fixture', version: '1.12.8' } });
      if (rpc.method === 'tools/list') return result({ tools: [
        { name: 'mcp-adapter-discover-abilities', inputSchema: { type: 'object', properties: {} } },
        { name: 'mcp-adapter-get-ability-info', inputSchema: { type: 'object', properties: { ability_name: { type: 'string' } }, required: ['ability_name'] }, outputSchema: { type: 'object', properties: { input_schema: { type: 'object' }, output_schema: { type: 'object' } } } },
        { name: 'mcp-adapter-execute-ability', inputSchema: { type: 'object', properties: { ability_name: { type: 'string' }, parameters: { type: 'object', additionalProperties: true } }, required: ['ability_name', 'parameters'] } },
      ] });
      if (rpc.method !== 'tools/call') return result({});
      const call = rpc.params as { name: string; arguments: Record<string, unknown> };
      state.calls.push({ name: call.name, args: call.arguments });
      const output = (data: unknown) => result({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
      const names = ['novamira/execute-php', 'novamira/agent-context', 'novamira/create-upload-link', ...(options.adminAccess ? ['novamira/create-admin-access-link'] : []), ...(state.atomic ? ['elementor/build-composition', 'elementor/get-widget-schema', 'elementor/list-widget-schemas'] : [])];
      if (call.name.endsWith('discover-abilities')) return output({ novamira_instructions: 'Fixture only.', abilities: names.map(name => ({ name, label: name, description: name })) });
      if (call.name.endsWith('get-ability-info')) return output({ name: call.arguments.ability_name, input_schema: call.arguments.ability_name === 'novamira/agent-context' ? [] : { type: 'object', properties: call.arguments.ability_name === 'novamira/create-admin-access-link' ? { admin_path: { type: 'string' }, session_expires_in: { type: 'integer' } } : { code: { type: 'string' } } }, output_schema: { type: 'object' } });
      const args = call.arguments.parameters as Record<string, unknown>;
      if (call.arguments.ability_name === 'novamira/create-upload-link') return output({ success: true, data: { upload_url: `http://${request.headers.host}/wp-json/novamira/v1/upload`, upload_token: 'fixture-upload-token', token_header: 'X-Novamira-Upload-Token' } });
      if (call.arguments.ability_name === 'novamira/create-admin-access-link') return output({ success: true, data: { url: `http://${request.headers.host}/fixture-one-time-login`, redirect_url: new URL(options.adminRedirectPath ?? String(args.admin_path), `http://${request.headers.host}/wp-admin/`).href } });
      if (call.arguments.ability_name !== 'novamira/execute-php') return output({ success: true, data: { success: true } });
      const code = args.code as string; state.phpCodes.push(code);
      let value: unknown = true;
      if (code.includes('$mediaTransformationRead=true')) {
        const operation = code.match(/'operationId'=>json_decode\(base64_decode\('([^']+)'\)/)!, digest = code.match(/get_post_meta\(\$a,'_clonewp_sha256',true\)!==json_decode\(base64_decode\('([^']+)'\)/)!;
        value = state.mediaOverride ?? { owner: { pageId: 101, runId: state.runId }, operationId: JSON.parse(Buffer.from(operation[1], 'base64').toString()), attachmentId: 201, observedAt: new Date().toISOString(), actual: { sha256: JSON.parse(Buffer.from(digest[1], 'base64').toString()), bytes: 3, mimeType: 'image/svg+xml' } };
      }
      else if (code.includes('$reviewStatusProbe=true')) { const owner = code.match(/\$run=json_decode\(base64_decode\('([^']+)'\)/); value = state.reviewStatusOverride ?? { pageId: 101, runId: owner ? JSON.parse(Buffer.from(owner[1], 'base64').toString()) : '', exists: true, postType: 'page', status: 'draft', ownerMatches: true, canEdit: true, uniqueRunPage: true, documentExists: true, builtWithElementor: true }; }
      else if (code.includes("return ['snapshot'=>")) { const owner = code.match(/\$run=json_decode\(base64_decode\('([^']+)'\)/), types = code.match(/\}\)\(json_decode\(base64_decode\('([^']+)'\)/); value = { snapshot: { pageId: 101, runId: owner ? JSON.parse(Buffer.from(owner[1], 'base64').toString()) : '', title: state.title, status: 'draft', elements: state.elements, settings: state.settings }, proof: { version: 1, sha256: 'f'.repeat(64), types: types ? JSON.parse(Buffer.from(types[1], 'base64').toString()) : [] } }; }
      else if (code.includes("return ['previewUrl'")) value = { previewUrl: `http://${request.headers.host}/?page_id=101&preview=true`, editUrl: `http://${request.headers.host}/wp-admin/post.php?post=101&action=elementor` };
      else if (code.includes('$catalogProducts=wc_get_products')) value = state.catalogOverride ?? [{ id: 501, name: 'Our own catalog product', permalink: `http://${request.headers.host}/product/our-product/`, imageUrl: `http://${request.headers.host}/wp-content/uploads/own.png`, imageVariants: [`http://${request.headers.host}/wp-content/uploads/own-thumb.png`, 'https://media.example/own-medium.png'], priceText: '$29.99' }];
      else if (code.includes('$targetPostsObservation=true')) value = state.postsOverride ?? [{ id: 601, status: 'publish', date: '2026-07-10T08:12:01+00:00', title: 'Actual target article', excerpt: 'Existing public article excerpt.', permalink: `http://${request.headers.host}/actual-article/`, featuredMediaId: 701, imageUrl: `http://${request.headers.host}/wp-content/uploads/article.png`, imageVariants: [`http://${request.headers.host}/wp-content/uploads/article.png`, 'https://media.example/article-small.png'], categoryIds: [4], tagIds: [9] }];
      else if (code.includes('$clonewpProductRead=true')) value = options.productRead?.();
      else if (code.includes("'sourceProof'")) {
        const projection = code.match(/\$item=\[\];foreach \(\[([^\]]+)\] as \$field\)/)!;
        const fields = new Set([...projection[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
        const projectedSchemas = Object.fromEntries(Object.entries(options.registeredSchemas ?? schemas).map(([key, schema]) => [key, { ...schema, controls: Object.fromEntries(Object.entries(schema.controls).map(([name, control]) => [name, Object.fromEntries(Object.entries(control).filter(([field]) => fields.has(field)))])) }]));
        value = { versions: { elementor: '3.33.2' }, schemas: projectedSchemas, sourceProof: { save: { sha256: 'fixture', source: 'Fixture source evidence.' } }, atomicActive: state.atomic };
      }
      else if (code.includes('wp_insert_post(')) {
        const owner = code.match(/'meta_value'=>json_decode\(base64_decode\('([^']+)'\)/);
        if (owner) state.runId = JSON.parse(Buffer.from(owner[1], 'base64').toString());
        state.exists = true; value = { pageId: 101, editUrl: 'http://127.0.0.1/wp-admin/post.php?post=101&action=elementor', status: 'draft' };
      } else if (code.includes('$input=json_decode')) {
        if (state.changeBeforeSave) { state.changeBeforeSave = false; state.elements[0].settings.content_width = 'boxed'; }
        if (code.includes('$expectedCurrent=json_decode')) {
          const encodedExpected = code.match(/\$expectedCurrent=json_decode\(base64_decode\('([^']+)'\)/)![1];
          const expected = JSON.parse(Buffer.from(encodedExpected, 'base64').toString());
          if (JSON.stringify(expected) !== JSON.stringify({ elements: state.elements, settings: state.settings })) return output({ success: true, data: { success: false, error_class: 'RuntimeException', error_message: 'concurrent_document_change' } });
        }
        const encoded = code.match(/\$input=json_decode\(base64_decode\('([^']+)'\)/)![1];
        const input = JSON.parse(Buffer.from(encoded, 'base64').toString());
        if (state.failSave) { state.failSave = false; return output({ success: true, data: { success: false, error_class: 'RuntimeException', error_message: 'Fixture rejection' } }); }
        state.elements = input.elements; state.settings = input.settings;
        if (state.corruptSave) { state.corruptSave = false; state.elements[0].id = 'bb99999'; }
        value = { saved: true, elements: state.elements, settings: state.settings };
      } else if (code.includes('$doc->get_elements_data()')) value = { pageId: 101, runId: state.runId, title: state.title, status: 'draft', elements: state.elements, settings: state.settings };
      else if(code.includes('$assetMetadata=')){
        if (!code.includes('media_handle_sideload') && state.failMediaLookupCount > 0) { state.failMediaLookupCount--; response.destroy(); return; }
        if(!state.mediaIdentityValid)return output({success:true,data:{success:false,error_class:'RuntimeException',error_message:'owned_attachment_identity_changed'}});
        const media=()=>state.mediaOverride??{attachmentId:201,url:`http://${request.headers.host}/wp-content/uploads/original.png`,variants:[`http://${request.headers.host}/wp-content/uploads/metadata-thumbnail.png`,'https://unrelated.example/thumbnail.png'],width:1,height:1,mimeType:'image/png'};
        if(code.includes('media_handle_sideload')||code.includes('wp_insert_attachment')){state.existingMedia=true;state.stagedBytes=0;if(state.loseRegisterResponse){state.loseRegisterResponse=false;response.destroy();return;}value=media();}else value=state.existingMedia?media():null;
      }
      else if (code.includes('$pendingAssetInspection=')) { const match = code.match(/\$expectedDigest=json_decode\(base64_decode\('([^']+)'\)/); value = { status: state.pendingAttachmentIds.length ? 'attachment-present' : state.stagedBytes ? 'staged' : 'absent', sha256: match ? JSON.parse(Buffer.from(match[1], 'base64').toString()) : '', bytes: state.stagedBytes, ...(state.pendingAttachmentIds.length ? { attachmentIds: state.pendingAttachmentIds } : {}) }; }
      else if (code.includes('media_handle_sideload')) value = 201;
      else if (code.includes('wp_get_attachment_metadata($a)')) value = { attachmentId: 201, url: `http://${request.headers.host}/wp-content/uploads/original.png`, variants: [`http://${request.headers.host}/wp-content/uploads/metadata-thumbnail.png`, 'https://unrelated.example/thumbnail.png'], width: 1, height: 1, mimeType: 'image/png' };
      else if (code.includes('cached_media_bytes_changed')) value = state.cachedMediaValid;
      else if (code.includes("'_clonewp_sha256'")) value = null;
      if (options.compressedCapabilities && code.includes("'sourceProof'")) {
        const raw = Buffer.from(JSON.stringify(value));
        value = { __clonewpCapabilityPayload: 'gzip-base64-v1', rawBytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), data: gzipSync(raw).toString('base64') };
      }
      return output({ success: true, data: { success: true, return_value: value, output: '', errors: [], execution_time_ms: 1 } });
    }
    if (request.url === '/wp-json/novamira/v1/upload') {
      if (request.method !== 'PUT' || request.headers['x-novamira-upload-token'] !== 'fixture-upload-token') return json(response, 403, { code: 'upload_forbidden' });
      state.uploads++; state.stagedBytes = Buffer.concat(chunks).length;
      if (state.loseUploadResponse) { state.loseUploadResponse = false; response.destroy(); return; }
      return json(response, 200, { path: '/verified/fixture.png' });
    }
    if (request.url === '/wp-json/?_fields=namespaces') return json(response, 200, { namespaces: ['mcp', 'wp-abilities/v1'] });
    if (request.url === '/wp-json/wp/v2/users/me?context=edit&_fields=id,capabilities') return json(response, 200, { id: 1, capabilities: { edit_pages: true, upload_files: true } });
    if (request.url === '/wp-json/wp/v2/plugins?_fields=plugin,name,version,status') return json(response, 200, [{ plugin: 'novamira/novamira', status: 'active', version: '1.12.8', name: 'Novamira' }, { plugin: 'elementor/elementor', status: 'active', version: '3.33.2', name: 'Elementor' }]);
    if (request.url?.startsWith('/wp-json/wp/v2/themes')) return json(response, 200, [{ stylesheet: 'fixture-theme', version: '1', status: 'active' }]);
    if (request.url?.includes('core/get-environment-info/run')) return json(response, 200, { wp_version: '7.1.3', php_version: '8.0.30', environment: 'test' });
    return json(response, 404, { code: 'rest_no_route' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as { port: number };
  const client = new WordPressClient({ targetUrl: `http://127.0.0.1:${address.port}`, username: 'fixture', applicationPassword: 'secret', timeoutMs: 5_000,networkRoute:options.networkRoute, ...(options.native44 ? { executionStrategy: 'native44-css-handoff' } : {}) });
  return { client, state, origin: `http://127.0.0.1:${address.port}`, close: async () => { await client.close(); server.close(); await once(server, 'close'); } };
}

const tree: ElementorElement[] = [{ id: 'aa00001', elType: 'container', settings: { content_width: 'full', flex_direction: 'column' }, elements: [{ id: 'aa00002', elType: 'widget', widgetType: 'heading', settings: { title: 'Native fixture', header_size: 'h1' }, elements: [] }] }];
test('target product reader uses the existing authenticated read transport and rejects bad IDs before transport', async () => {
  let result: unknown;
  const fixture = await fakeWordPress({ native44: true, productRead: () => result });
  try {
    const snapshot = currentProductFixture(fixture.origin, true); result = { product: snapshot.product, woocommerceVersion: snapshot.woocommerceVersion, currency: snapshot.currency };
    const observed = await fixture.client.readTargetProduct(snapshot.product.id);
    assert.deepEqual(observed.product, snapshot.product); assert.equal(observed.targetOrigin, fixture.origin);
    const calls = fixture.state.calls.length; await assert.rejects(() => fixture.client.readTargetProduct(0)); assert.equal(fixture.state.calls.length, calls);
    assert.equal(fixture.state.phpCodes.filter(code => code.includes('$clonewpProductRead=true')).length, 1);
    assert.equal(fixture.client.diagnostics().documentSaves, 0); assert.equal(fixture.client.diagnostics().mediaImportCalls, 0);
    result = { ...result as object, product: { ...snapshot.product, permalink: 'https://source.example/product/source/' } };
    await assert.rejects(() => fixture.client.readTargetProduct(snapshot.product.id), /Invalid public target product/);
    result = []; await assert.rejects(() => fixture.client.readTargetProduct(snapshot.product.id), /Invalid public target product/);
  } finally { await fixture.close(); }
});
test('direct route carries real MCP JSON, REST and guarded native save/readback without changing global fetch',async()=>{
 const f=await fakeWordPress({networkRoute:'direct'});try{assert.deepEqual((await f.client.preflight()).blockers,[]);await f.client.discoverCapabilities();const page=await f.client.createDraft('direct-run','Direct fixture');const result=await f.client.buildDraft(page.pageId,{elements:tree});assert.deepEqual(result.elements,tree);assert.equal(result.runId,'direct-run');}finally{await f.close();}
});

test('target article reader observes dynamic published posts and preserves query and public media evidence', async () => {
  const fixture = await fakeWordPress({ native44: true });
  try {
    const query = { itemsPerPage: 4, orderby: 'date', order: 'desc', categoryIds: [4] } as const;
    const posts = await fixture.client.readTargetPosts({ ...query, categoryIds: [...query.categoryIds] });
    assert.equal(posts.posts[0].id, 601); assert.equal(posts.posts[0].status, 'publish'); assert.equal(posts.posts[0].featuredMediaId, 701);
    assert.equal(new URL(posts.posts[0].permalink).origin, fixture.client.origin); assert.deepEqual(posts.evidence, []);
    assert.deepEqual(posts.query, { ...query, offset: 0, tagIds: [] });
    assert.equal(fixture.state.phpCodes.length, 1); assert.match(fixture.state.phpCodes[0], /new WP_Query/);
    assert.doesNotMatch(fixture.state.phpCodes[0], /wp_insert_post|wp_update_post|update_option|update_post_meta|post__in/);
    fixture.state.postsOverride = []; assert.deepEqual((await fixture.client.readTargetPosts({ itemsPerPage: 4, orderby: 'date', order: 'desc' })).posts, []);
  } finally { await fixture.close(); }
});

test('target article reader rejects malformed queries before authentication and invalid target observations', async () => {
  const fixture = await fakeWordPress({ native44: true });
  try {
    const query = { itemsPerPage: 4, orderby: 'date', order: 'desc' } as const;
    await assert.rejects(fixture.client.readTargetPosts({ ...query, itemsPerPage: Infinity }), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_posts_query');
    assert.equal(fixture.state.calls.length, 0);
    const valid = (await fixture.client.readTargetPosts(query)).posts[0];
    for (const patch of [{ status: 'draft' }, { permalink: 'https://source.example/article/' }, { id: 0 }, { imageUrl: 'javascript:alert(1)' }, { date: 'not-a-date' }]) {
      fixture.state.postsOverride = [{ ...valid, ...patch }];
      await assert.rejects(fixture.client.readTargetPosts(query), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_posts_response');
    }
  } finally { await fixture.close(); }
});

test('CSS-only adapter requires attestation, exact native body and page metadata, guarded CAS and readback', async () => {
  const f = await fakeWordPress({ native44: true });
  try {
    f.state.runId = 'css-adapter'; f.state.elements = structuredClone(tree); f.state.elements[0].settings.css_classes = 'cwp-panel'; f.state.settings = { custom_css: '' };
    const before = (await f.client.readOwnedReviewCheckpoint(101, f.state.runId, ['container', 'heading'])).snapshot, modules = [{ key: 'panel', className: 'cwp-panel' }], corrections = [{ moduleKey: 'panel', selector: '.label', declarations: { 'column-gap': '8px' }, reason: 'Observed spacing', evidence: [{ path: 'source.json', sha256: 'a'.repeat(64) }] }];
    const settings = { ...before.settings, custom_css: applyNative44CurrentCSSCorrections(before, modules, corrections) }, expected = { ...structuredClone(before), settings, hash: documentHashV2(before.elements, settings) }, bad = structuredClone(expected);
    bad.elements[0].elements![0].settings.title = 'Body replacement'; bad.hash = documentHashV2(bad.elements, bad.settings);
    await assert.rejects(f.client.saveOwnedCSSRevision(before, bad, modules, corrections), /non_css_change/); assert.equal(f.client.diagnostics().documentSaves, 0);
    const saved = await f.client.saveOwnedCSSRevision(before, expected, modules, corrections); assert.equal(saved.hash, expected.hash); assert.deepEqual(saved.elements, before.elements); assert.equal(f.client.diagnostics().documentSaves, 1); assert.equal(f.client.diagnostics().documentRestores, 0);
    const code = f.state.phpCodes.find(code => code.includes('css_revision_save_failed'))!; assert.match(code, /ambiguous_run_pages/); assert.match(code, /expectedCurrent/); assert.match(code, /page_custom_css_unregistered/);
    const fresh = await fakeWordPress({ native44: true }); try { await assert.rejects(fresh.client.saveOwnedCSSRevision(before, expected, modules, corrections), /fresh server-read/); assert.equal(fresh.state.phpCodes.length, 0); } finally { await fresh.close(); }
  } finally { await f.close(); }
});

test('revision adapter requires an attested draft and native responsibility, uses registered controls and reads back exact save', async () => {
  const f = await fakeWordPress({ native44: true });
  try {
    f.state.runId = 'revision-adapter'; f.state.elements = structuredClone(tree); f.state.elements[0].elements![0].settings.css_classes = 'cwp-heading'; f.state.settings = { custom_css: '' };
    const before = (await f.client.readOwnedReviewCheckpoint(101, f.state.runId, ['container', 'heading'])).snapshot;
    const model = createNative44CSSModel({ taskId: 'revision-task', runId: before.runId, pageId: 101, modules: [{ key: 'heading', className: 'cwp-heading' }], rules: [{ id: 'native-heading', moduleKey: 'heading', slot: 'type', property: 'font-size', responsibility: 'native', native: { elementId: 'aa00002', controlId: 'header_size', expectedValue: 'h2' }, reason: 'Correct the native heading hierarchy.', evidence: ['source-layout'] }] });
    const expected = prepareNative44RevisionSnapshot(before, [{ kind: 'set-controls', elementId: 'aa00002', controls: { header_size: 'h2' }, reason: 'Use native heading control.', evidence: ['source-heading'] }], compileNative44CSSModel(model).css);
    await assert.rejects(f.client.saveOwnedRevision(before, expected, { ...model, rules: [] }), /native control must belong/);
    const after = await f.client.saveOwnedRevision(before, expected, model); assert.equal(after.hash, expected.hash); assert.equal(f.state.elements[0].elements![0].settings.header_size, 'h2'); assert.equal(f.client.diagnostics().documentSaves, 1); assert.equal(f.client.diagnostics().documentRestores, 0);
    const save = f.state.phpCodes.find(code => code.includes('revision_save_failed'))!; assert.match(save, /ambiguous_run_pages/); assert.match(save, /expectedCurrent/); assert.match(save, /->save\(\$input\)/);
    const fresh = await fakeWordPress({ native44: true }); try { await assert.rejects(fresh.client.saveOwnedRevision(before, expected, model), /current server-read owned draft/); assert.equal(fresh.state.phpCodes.length, 0); } finally { await fresh.close(); }
  } finally { await f.close(); }
});

test('revision adapter preserves a concurrent server edit without attempting restoration', async () => {
  const f = await fakeWordPress({ native44: true });
  try {
    f.state.runId = 'revision-race'; f.state.elements = structuredClone(tree); f.state.elements[0].elements![0].settings.css_classes = 'cwp-heading'; f.state.settings = { custom_css: '' };
    const before = (await f.client.readOwnedReviewCheckpoint(101, f.state.runId, ['container', 'heading'])).snapshot;
    const model = createNative44CSSModel({ taskId: 'revision-task', runId: before.runId, pageId: 101, modules: [{ key: 'heading', className: 'cwp-heading' }], rules: [{ id: 'heading-color', moduleKey: 'heading', slot: 'color', property: 'color', responsibility: 'css', value: '#123456', reason: 'Observed source color.', evidence: ['source-color'] }] });
    const expected = prepareNative44RevisionSnapshot(before, [], compileNative44CSSModel(model, { elements: before.elements }).css); f.state.changeBeforeSave = true;
    await assert.rejects(f.client.saveOwnedRevision(before, expected, model), /bounded Novamira WordPress operation failed/); assert.equal(f.state.elements[0].settings.content_width, 'boxed'); assert.equal(f.state.settings.custom_css, ''); assert.equal(f.client.diagnostics().documentRestores, 0);
  } finally { await f.close(); }
});

test('media transformation adapter reads existing owned bytes and reports unknown SVG sanitation without uploads or registration', async () => {
  const f = await fakeWordPress({ native44: true }), directory = await mkdtemp(path.join(tmpdir(), 'clonewp-transform-')), filename = path.join(directory, 'submitted.svg'); await writeFile(filename, 'svg');
  try {
    f.state.runId = 'media-transform-run'; await f.client.readOwnedReviewCheckpoint(101, f.state.runId, ['container']);
    const original = fingerprintMediaTransformationBytes(Buffer.from('svg'), 'image/svg+xml'), owner = { pageId: 101, runId: f.state.runId }, contract = { version: 1 as const, kind: 'media-transformation-contract' as const, owner, operationId: 'media-op-one', original, submitted: original };
    const exact = await f.client.reconcileOwnedMediaTransformation({ contract, attachmentId: 201, submittedPath: filename }); assert.equal(exact.status, 'verified-exact');
    f.state.mediaOverride = { owner, operationId: contract.operationId, attachmentId: 201, observedAt: new Date().toISOString(), actual: fingerprintMediaTransformationBytes(Buffer.from('sanitized-svg'), 'image/svg+xml') };
    const changed = await f.client.reconcileOwnedMediaTransformation({ contract, attachmentId: 201, submittedPath: filename }); assert.equal(changed.status, 'needs-reconciliation'); assert.equal(changed.automaticRetryAllowed, false); assert.equal(changed.attachmentId, 201); assert.equal(f.state.uploads, 0);
    f.state.mediaOverride = { owner, operationId: contract.operationId, attachmentId: 202, observedAt: new Date().toISOString(), actual: original };
    await assert.rejects(f.client.reconcileOwnedMediaTransformation({ contract, attachmentId: 201, submittedPath: filename }), /different existing attachment/);
    const codes = f.state.phpCodes.filter(code => code.includes('$mediaTransformationRead=true')); assert.equal(codes.length, 3); assert.ok(codes.every(code => !/media_handle|update_post_meta|->save\s*\(/.test(code)));
    await writeFile(filename, 'edited'); const requests = f.state.phpCodes.length; await assert.rejects(f.client.reconcileOwnedMediaTransformation({ contract, attachmentId: 201, submittedPath: filename }), /local transformation contract/); assert.equal(f.state.phpCodes.length, requests);
  } finally { await f.close(); await unlink(filename); await rmdir(directory); }
});

test('native44 cookie authentication targets its owned frontend preview and preserves the separate edit URL', async () => {
  const fixture = await fakeWordPress({ native44: true, adminAccess: true });
  try {
    await fixture.client.readOwnedReviewCheckpoint(101, 'owned-preview-run', ['heading']); const preview = await fixture.client.getPreviewAccess(101);
    const request = fixture.state.calls.find(call => call.name.endsWith('execute-ability') && call.args.ability_name === 'novamira/create-admin-access-link')!, parameters = request.args.parameters as Record<string, unknown>;
    assert.equal(parameters.admin_path, '../?page_id=101&preview=true'); assert.equal(new URL(String(parameters.admin_path), `${fixture.client.origin}/wp-admin/`).href, preview.previewUrl); assert.match(preview.editUrl, /\/wp-admin\/post\.php\?post=101&action=elementor$/); assert.ok(preview.adminAccessUrl); assert.equal(fixture.state.exists, false); assert.equal(fixture.client.diagnostics().documentSaves, 0); assert.equal(fixture.state.calls.filter(call => call.name.endsWith('execute-ability') && call.args.ability_name === 'novamira/create-admin-access-link').length, 1);
  } finally { await fixture.close(); }
});

test('historical cookie authentication retains its Elementor editor-relative admin path', async () => {
  const fixture = await fakeWordPress({ adminAccess: true });
  try {
    await fixture.client.readOwnedReviewCheckpoint(101, 'legacy-preview-run', ['heading']); const preview = await fixture.client.getPreviewAccess(101);
    const request = fixture.state.calls.find(call => call.name.endsWith('execute-ability') && call.args.ability_name === 'novamira/create-admin-access-link')!, parameters = request.args.parameters as Record<string, unknown>;
    assert.equal(parameters.admin_path, 'post.php?post=101&action=elementor'); assert.match(preview.editUrl, /action=elementor$/); assert.ok(preview.adminAccessUrl); assert.equal(fixture.state.exists, false);
  } finally { await fixture.close(); }
});

test('native44 rejects an ignored frontend redirect before returning any editor or foreign authentication landing', async () => {
  for (const adminRedirectPath of ['post.php?post=101&action=elementor', 'https://outside.example/']) {
    const fixture = await fakeWordPress({ native44: true, adminAccess: true, adminRedirectPath });
    try {
      await fixture.client.readOwnedReviewCheckpoint(101, 'owned-preview-reject', ['heading']);
      await assert.rejects(() => fixture.client.getPreviewAccess(101), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_preview_redirect'); assert.equal(fixture.state.exists, false); assert.equal(fixture.client.diagnostics().documentSaves, 0);
    } finally { await fixture.close(); }
  }
});

test('reviewed checkpoint reads owned document and native/global proof once without discovery, preview authentication or any record write', async () => {
  const fixture = await fakeWordPress();
  try {
    const result = await fixture.client.readOwnedReviewCheckpoint(101, 'owned-review-test', ['heading', 'container']);
    assert.equal(result.snapshot.pageId, 101); assert.equal(result.snapshot.runId, 'owned-review-test'); assert.deepEqual(result.proof.types, ['container', 'heading']); assert.match(result.snapshot.hash, /^[a-f\d]{64}$/); assert.equal(fixture.client.diagnostics().capabilityDiscoveries, 0); assert.equal(fixture.client.diagnostics().phpCalls, 1); assert.equal(fixture.client.diagnostics().documentReads, 1); assert.equal(fixture.state.exists, false);
    const code = fixture.state.phpCodes[0]; assert.match(code, /owned_draft_guard/); assert.match(code, /ambiguous_run_pages/); assert.match(code, /get_class\(\$obj\)/); assert.match(code, /getParentClass/); assert.match(code, /kitSettings/); assert.match(code, /hash_file\('sha256'/); assert.doesNotMatch(code, /wp_insert_post|wp_update_post|update_post_meta|update_option|delete_post|media_handle|->save\s*\(/);
    await assert.rejects(fixture.client.readOwnedReviewCheckpoint(101, 'owned-review-test', ['bad;code']), /explicit owned/); assert.equal(fixture.state.phpCodes.length, 1);
  } finally { await fixture.close(); }
});

test('fixed review status diagnoses a published owned page without adding it to writable ownership or creating a preview', async () => {
  const fixture = await fakeWordPress({ native44: true });
  try {
    const published = { pageId: 101, runId: 'published-review-run', exists: true, postType: 'page', status: 'publish', ownerMatches: true, canEdit: true, uniqueRunPage: true, documentExists: true, builtWithElementor: true };
    fixture.state.reviewStatusOverride = published;
    assert.deepEqual(await fixture.client.probeOwnedReviewStatus(101, published.runId), published);
    const code = fixture.state.phpCodes[0]; assert.match(code, /\$reviewStatusProbe=true/); assert.match(code, /get_post_status/); assert.match(code, /current_user_can\('edit_post'/); assert.match(code, /_clonewp_run_id/);
    assert.doesNotMatch(code, /wp_insert_post|wp_update_post|update_post_meta|update_option|delete_post|media_handle|->save\s*\(/);
    await assert.rejects(fixture.client.getPreviewAccess(101), (error: unknown) => error instanceof WordPressError && error.code === 'unowned_page');
    await assert.rejects(fixture.client.snapshotDraft(101), (error: unknown) => error instanceof WordPressError && error.code === 'unowned_page');
    assert.equal(fixture.state.phpCodes.length, 1); assert.equal(fixture.client.diagnostics().documentSaves, 0); assert.equal(fixture.state.exists, false);
    await assert.rejects(fixture.client.probeOwnedReviewStatus(101, 'bad;run'), /exact page and run identity/); assert.equal(fixture.state.phpCodes.length, 1);
    fixture.state.reviewStatusOverride = { ...published, pageId: 102 };
    await assert.rejects(fixture.client.probeOwnedReviewStatus(101, published.runId), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_review_status');
    fixture.state.reviewStatusOverride = { ...published, exists: false };
    await assert.rejects(fixture.client.probeOwnedReviewStatus(101, published.runId), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_review_status');
  } finally { await fixture.close(); }
});

test('fixed read-only catalog observation returns actual target identity and public registered media without creating records', async () => {
  const fixture = await fakeWordPress();
  try {
    const catalog = await fixture.client.readTargetCatalog();
    assert.equal(catalog.targetOrigin, fixture.client.origin); assert.deepEqual(catalog.evidence, []);
    assert.equal(catalog.query.limit, 48); assert.equal(catalog.query.status, 'publish'); assert.equal(catalog.query.order, 'DESC');
    assert.deepEqual(catalog.products.map(product => [product.id, product.name, product.priceText]), [[501, 'Our own catalog product', '$29.99']]);
    assert.equal(new URL(catalog.products[0].permalink).origin, fixture.client.origin);
    assert.ok(catalog.products[0].imageVariants.includes('https://media.example/own-medium.png'));
    assert.equal(fixture.state.phpCodes.length, 1); assert.equal(fixture.state.exists, false); assert.deepEqual(fixture.state.elements, []);
    assert.doesNotMatch(fixture.state.phpCodes[0], /wp_insert_post|wp_update_post|update_post_meta|update_option|delete_post|media_handle|wp_set_object_terms|->save\s*\(/);
    assert.match(fixture.state.phpCodes[0], /'status'=>'publish','visibility'=>'visible','limit'=>48,'orderby'=>\['date'=>'DESC','ID'=>'DESC'\],'order'=>'DESC'/);
    assert.deepEqual(catalog.query.tieBreak, {orderby: 'ID', order: 'DESC'});
    assert.match(fixture.state.phpCodes[0], /\$product->is_on_sale\(\)/);
    assert.match(fixture.state.phpCodes[0], /\$product->get_average_rating\(\)/);
    assert.match(fixture.state.phpCodes[0], /\$product->get_rating_count\(\)/);
    fixture.state.catalogOverride=catalog.products.map(product=>({...product,onSale:true,averageRating:4.5,ratingCount:12}));
    const rated = (await fixture.client.readTargetCatalog()).products[0];
    assert.equal(rated.onSale,true); assert.equal(rated.averageRating,4.5); assert.equal(rated.ratingCount,12);
  } finally { await fixture.close(); }
});

test('invalid catalog limits cannot reach authenticated transport or interpolate arbitrary PHP', async () => {
  const fixture = await fakeWordPress();
  try {
    for (const limit of [0, -1, 201, 1.5, NaN, Infinity, '1);wp_delete_post(123);' as unknown as number]) await assert.rejects(fixture.client.readTargetCatalog(limit), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_catalog_limit');
    assert.equal(fixture.state.calls.length, 0); assert.equal(fixture.state.phpCodes.length, 0);
    await fixture.client.readTargetCatalog(1); assert.match(fixture.state.phpCodes[0], /'limit'=>1,/);
  } finally { await fixture.close(); }
});

test('catalog provenance rejects duplicate IDs, foreign products and credential-bearing media instead of passing invented target data', async () => {
  const fixture = await fakeWordPress();
  try {
    const valid = { id: 501, name: 'Our own product', permalink: `${fixture.client.origin}/product/own/`, imageUrl: `${fixture.client.origin}/wp-content/uploads/own.png`, imageVariants: [] as string[], priceText: '$29.99' };
    for (const products of [[valid, valid], [{ ...valid, permalink: 'https://foreign.example/product/source-product/' }], [{ ...valid, imageUrl: 'https://user:password@media.example/own.png' }], [{ ...valid, imageVariants: ['javascript:bad()'] }], [{ ...valid, id: 0 }], [{ ...valid, name: '' }], [{...valid,onSale:'source discount'}]]) {
      fixture.state.catalogOverride = products;
      await assert.rejects(fixture.client.readTargetCatalog(), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_catalog_response');
    }
    fixture.state.catalogOverride = [];
    assert.deepEqual((await fixture.client.readTargetCatalog()).products, [], 'an empty target catalog stays empty rather than borrowing source products');
    assert.equal(fixture.state.exists, false);
  } finally { await fixture.close(); }
});

test('catalog rating evidence must be finite and within actual WooCommerce bounds', async () => {
  const fixture = await fakeWordPress();
  try {
    const catalog = await fixture.client.readTargetCatalog(), valid = catalog.products[0];
    for (const fields of [{averageRating: -1}, {averageRating: 5.1}, {averageRating: '4.5'}, {ratingCount: -1}, {ratingCount: 1.5}, {ratingCount: '12'}]) {
      fixture.state.catalogOverride = [{...valid, ...fields}];
      await assert.rejects(fixture.client.readTargetCatalog(), (error: unknown) => error instanceof WordPressError && error.code === 'invalid_catalog_response');
    }
    fixture.state.catalogOverride = [{...valid, averageRating: 0, ratingCount: 0}];
    assert.equal((await fixture.client.readTargetCatalog()).products[0].ratingCount, 0);
    assert.equal(fixture.state.exists, false);
  } finally { await fixture.close(); }
});

test('real MCP HTTP handshake discovers gateway names, normalizes empty schema maps and unwraps execution', async () => {
  const fixture = await fakeWordPress();
  try {
    const preflight = await fixture.client.preflight(); assert.equal(preflight.phpVersion, '8.0.30'); assert.deepEqual(preflight.blockers, []);
    const capabilities = await fixture.client.discoverCapabilities(); assert.equal(capabilities.mode, 'legacy-verified'); assert.ok(capabilities.legacySchemas.heading.controls.title);
    const context = await fixture.client.abilityInfo('novamira/agent-context'); assert.deepEqual(context.input_schema, { type: 'object', properties: {} });
    const draft = await fixture.client.createDraft('fixture-run-01', 'Fixture'); const readback = await fixture.client.buildDraft(draft.pageId, { elements: tree });
    assert.deepEqual(readback.elements, tree); assert.equal(readback.status, 'draft'); assert.equal(readback.runId, 'fixture-run-01');
  } finally { await fixture.close(); }
});

test('unowned page mutation is rejected before any WordPress request', async () => {
  const fixture = await fakeWordPress();
  try { await assert.rejects(fixture.client.buildDraft(999, { elements: tree }), (e: unknown) => e instanceof WordPressError && e.code === 'unowned_page'); assert.equal(fixture.state.calls.length, 0); }
  finally { await fixture.close(); }
});

test('capability discovery decodes compressed MCP results without a document write', async () => {
  const fixture = await fakeWordPress({ compressedCapabilities: true });
  try {
    const capabilities = await fixture.client.discoverCapabilities();
    assert.equal(capabilities.mode, 'legacy-verified');
    assert.ok(capabilities.legacySchemas.heading.controls.title);
    assert.equal((capabilities.sourceProof?.save as { source: string }).source, 'Fixture source evidence.');
    assert.ok(fixture.state.phpCodes.some(code => code.includes("function_exists('gzencode')") && code.includes("'sha256'=>hash('sha256',$capabilityJSON)")));
    assert.equal(fixture.client.diagnostics().documentSaves, 0);
    assert.equal(fixture.state.exists, false);
  } finally { await fixture.close(); }
});

test('registered multiselect discovery preserves actual true, false and absent flags including repeater fields', async () => {
  const registered: LegacySchema = { type: 'form', class: 'ElementorPro\\Modules\\Forms\\Widgets\\Form', controls: {
    submit_actions: { type: 'select2', multiple: true, options: { email: 'Email', 'save-to-database': 'Collect Submissions' }, default: ['email'] },
    single_action: { type: 'select2', multiple: false, options: { email: 'Email' } },
    implicit_action: { type: 'select2', options: { email: 'Email' } },
    form_fields: { type: 'form-fields-repeater', fields: [
      { name: 'field_options', type: 'select2', multiple: true, options: { first: 'First' } },
      { name: 'single_option', type: 'select2', multiple: false, options: { first: 'First' } },
      { name: 'implicit_option', type: 'select2', options: { first: 'First' } },
    ] },
  } };
  const fixture = await fakeWordPress({ native44: true, registeredSchemas: { form: registered } });
  try {
    const capabilities = await fixture.client.discoverCapabilities(['form']);
    const schema = capabilities.legacySchemas.form;
    assert.deepEqual(schema, registered);
    assert.equal(schema.controls.submit_actions.multiple, true);
    assert.equal(schema.controls.single_action.multiple, false);
    assert.equal(Object.hasOwn(schema.controls.implicit_action, 'multiple'), false);
    assert.deepEqual(schema.controls.form_fields.fields, registered.controls.form_fields.fields);
    assert.equal(fixture.state.exists, false);
  } finally { await fixture.close(); }
});

test('legacy settings require the live control name and a legal enum; failed save restores snapshot', async () => {
  const fixture = await fakeWordPress();
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-02', 'Fixture');
    await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: [{ ...tree[0], settings: { content_width: 'invented' } }] }), (e: unknown) => e instanceof WordPressError && e.code === 'invalid_control_value');
    await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: [{ ...tree[0], settings: { imagined_layout: 'row' } }] }), (e: unknown) => e instanceof WordPressError && e.code === 'unknown_control');
    const before = await fixture.client.snapshotDraft(draft.pageId); fixture.state.failSave = true;
    await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: tree }), (e: unknown) => e instanceof WordPressError && e.code === 'php_execution_failed');
    const after = await fixture.client.readDraft(draft.pageId); assert.equal(after.hash, before.hash);
    await assert.rejects(fixture.client.restoreDraft(draft.pageId, { ...before, hash: 'tampered' }), (e: unknown) => e instanceof WordPressError && e.code === 'invalid_snapshot');
  } finally { await fixture.close(); }
});

test('responsive settings require exact per-device registration; ordinary or inactive-device suffixes are rejected', async () => {
  const fixture = await fakeWordPress();
  try {
    const capabilities = await fixture.client.discoverCapabilities();
    assert.deepEqual(capabilities.legacySchemas.container.controls.width_tablet.responsive, { max: 'tablet' });
    const discovery = fixture.state.phpCodes.find(code => code.includes("'sourceProof'"))!;
    assert.ok(discovery.includes("set_responsive_control_duplication_mode('on')"));
    assert.ok(discovery.includes('set_responsive_control_duplication_mode($originalResponsiveMode)'));
    const draft = await fixture.client.createDraft('fixture-run-responsive', 'Fixture');
    const elements = [{ ...tree[0], settings: { ...tree[0].settings, width_tablet: { unit: 'custom', size: 'min(100%, 480px)' }, width_mobile: { unit: '%', size: 100 } } }];
    const readback = await fixture.client.buildDraft(draft.pageId, { elements });
    assert.deepEqual(readback.elements, elements);
    const calls = fixture.state.calls.length;
    for (const key of ['content_width_tablet', 'width_laptop']) {
      await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: [{ ...tree[0], settings: { [key]: key.startsWith('width_') ? { unit: '%', size: 100 } : 'full' } }] }), (e: unknown) => e instanceof WordPressError && e.code === 'unknown_control');
    }
    assert.equal(fixture.state.calls.length, calls, 'Unknown suffixes fail before any remote operation.');
  } finally { await fixture.close(); }
});

test('native save compiles registered defaults and nested container flags before the actual guarded document API call', async () => {
  const fixture = await fakeWordPress();
  try {
    const capabilities = await fixture.client.discoverCapabilities();
    capabilities.legacySchemas.container.controls.container_type = { type: 'select', default: 'flex', options: { flex: 'Flex', grid: 'Grid' } };
    capabilities.legacySchemas.container.controls.scroll_y = { type: 'text', default: -80 };
    const draft = await fixture.client.createDraft('fixture-canonical-01', 'Fixture');
    const original = structuredClone(tree); original[0].settings.container_type = 'flex';
    original[0].elements = [{ ...structuredClone(tree[0]), id: 'aa00003', isInner: false }];
    const before = await fixture.client.snapshotDraft(draft.pageId);
    const saved = await fixture.client.buildDraft(draft.pageId, { elements: original }, [], { expectedCurrent: before });
    assert.equal(saved.elements[0].settings.scroll_y, -80); assert.equal(saved.elements[0].settings.container_type, undefined);
    assert.equal(saved.elements[0].elements[0].isInner, true);
    assert.equal(original[0].elements[0].isInner, false, 'The model recipe stays unchanged');
    const operation = fixture.state.phpCodes.find(code => code.includes('$input=json_decode'))!;
    assert.ok(operation.includes('$expectedCurrent=json_decode'), 'The actual server save checks the accepted document');
    assert.ok(operation.includes('$doc->save($input)'));
  } finally { await fixture.close(); }
});

test('Atomic payload cannot override owned routing fields', async () => {
  const fixture = await fakeWordPress(); fixture.state.atomic = true;
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-03', 'Fixture');
    await fixture.client.buildDraft(draft.pageId, { xml_structure: '<e-flexbox configuration-id="root"></e-flexbox>', element_config: {}, style: {}, post_id: 999, parent_id: 'unrelated', mode: 'append' } as never);
    const calls = fixture.state.calls.filter(x => x.name.endsWith('execute-ability') && x.args.ability_name === 'elementor/build-composition');
    assert.equal(calls.length, 1); for (const call of calls) { const params = call.args.parameters as Record<string, unknown>; assert.equal(params.post_id, 101); assert.equal(params.parent_id, 'document'); assert.equal(params.mode, 'replace_children'); }
    const write = fixture.state.phpCodes.find(code => code.includes("wp_get_ability('elementor/build-composition')"))!;
    assert.ok(write.includes('$expectedCurrent=json_decode'));
    const encoded = write.match(/\$ability->execute\(json_decode\(base64_decode\('([^']+)'\)/)![1];
    const input = JSON.parse(Buffer.from(encoded, 'base64').toString());
    assert.equal(input.post_id, 101); assert.equal(input.parent_id, 'document'); assert.equal(input.mode, 'replace_children');
  } finally { await fixture.close(); }
});

test('a material save/readback tree change fails and restores the owned document', async () => {
  const fixture = await fakeWordPress();
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-04', 'Fixture');
    const before = await fixture.client.snapshotDraft(draft.pageId); fixture.state.corruptSave = true;
    await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: tree }), (e: unknown) => e instanceof WordPressError && e.code === 'readback_tree_mismatch');
    assert.equal((await fixture.client.readDraft(draft.pageId)).hash, before.hash);
  } finally { await fixture.close(); }
});

test('optimistic restoration checks current state in the same server operation and preserves a concurrent edit', async () => {
  const fixture = await fakeWordPress();
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-restore-guard', 'Fixture');
    const original = await fixture.client.snapshotDraft(draft.pageId);
    const saved = await fixture.client.buildDraft(draft.pageId, { elements: structuredClone(tree) });
    fixture.state.elements[0].settings.content_width = 'boxed';
    await assert.rejects(fixture.client.restoreDraft(draft.pageId, original, { expectedCurrent: saved }), (error: unknown) => error instanceof WordPressError && error.code === 'php_execution_failed');
    assert.equal(fixture.state.elements[0].settings.content_width, 'boxed');
    const current = await fixture.client.snapshotDraft(draft.pageId);
    const restored = await fixture.client.restoreDraft(draft.pageId, original, { expectedCurrent: current });
    assert.equal(restored.hash, original.hash);
  } finally { await fixture.close(); }
});

test('a human edit between snapshot read and PHP save is rejected without rollback overwriting it', async () => {
  const fixture = await fakeWordPress();
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-save-race', 'Fixture');
    const accepted = await fixture.client.buildDraft(draft.pageId, { elements: structuredClone(tree) });
    fixture.state.changeBeforeSave = true;
    const restoreCalls = fixture.state.phpCodes.filter(code => code.includes("RuntimeException('restore_failed')")).length;
    await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: structuredClone(tree) }, undefined, { expectedCurrent: accepted }), (error: unknown) => error instanceof WordPressError && error.code === 'concurrent_document_change');
    assert.equal(fixture.state.elements[0].settings.content_width, 'boxed');
    assert.equal(fixture.state.phpCodes.filter(code => code.includes("RuntimeException('restore_failed')")).length, restoreCalls);
    await assert.rejects(fixture.client.buildDraft(draft.pageId, { elements: tree }, undefined, { expectedCurrent: accepted }), (error: unknown) => error instanceof WordPressError && error.code === 'concurrent_document_change');
  } finally { await fixture.close(); }
});

test('asset hashes and inline provenance are checked before upload authorization', async () => {
  const fixture = await fakeWordPress(); const directory = await mkdtemp(path.join(tmpdir(), 'clonewp-assets-'));
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpX0AAAAASUVORK5CYII=', 'base64');
  const file = path.join(directory, 'fixture.png'); await writeFile(file, bytes);
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-05', 'Fixture');
    await assert.rejects(fixture.client.importAsset(file, { runId: 'fixture-run-05', pageId: draft.pageId, sourceUrl: 'https://source.example/image.png', mimeType: 'image/png', verifiedSha256: 'wrong-hash' }), (e: unknown) => e instanceof WordPressError && e.code === 'asset_hash_mismatch');
    await assert.rejects(fixture.client.importAsset(file, { runId: 'fixture-run-05', pageId: draft.pageId, sourceUrl: 'data:image/png;base64,aW52YWxpZA==', mimeType: 'image/png' }), (e: unknown) => e instanceof WordPressError && e.code === 'inline_asset_mismatch');
    assert.equal(fixture.state.calls.filter(x => x.name.endsWith('execute-ability') && x.args.ability_name === 'novamira/create-upload-link').length, 0);
  } finally { await fixture.close(); await unlink(file); await rmdir(directory); }
});

test('authenticated redirects are rejected and no redirected host receives credentials', async () => {
  let calls = 0;
  const client = new WordPressClient({ targetUrl: 'https://configured.test/', username: 'fixture', applicationPassword: 'secret', fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://other.test/' } }); } });
  await assert.rejects(client.rest('/wp-json/'), (e: unknown) => e instanceof WordPressError && e.code === 'redirect_blocked'); assert.equal(calls, 1);
  await assert.rejects(client.rest('https://other.test/wp-json/'), (e: unknown) => e instanceof WordPressError && e.code === 'invalid_rest_path'); assert.equal(calls, 1);
});

test('import accepts only explicit same-origin metadata variants and never guesses filenames', async () => {
  const fixture = await fakeWordPress(); const directory = await mkdtemp(path.join(tmpdir(), 'clonewp-variants-'));
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpX0AAAAASUVORK5CYII=', 'base64');
  const file = path.join(directory, 'fixture.png'); await writeFile(file, bytes);
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-06', 'Fixture');
    const asset = await fixture.client.importAsset(file, { runId: 'fixture-run-06', pageId: draft.pageId, sourceUrl: `data:image/png;base64,${bytes.toString('base64')}`, mimeType: 'image/png' });
    assert.deepEqual(asset.variants, [`${fixture.client.origin}/wp-content/uploads/metadata-thumbnail.png`]);
    assert.ok(fixture.state.phpCodes.some(code => code.includes("array_keys($m['sizes']??[])") && code.includes('wp_get_attachment_image_src($a,$size)')));
    const storedSource = fixture.state.phpCodes.map(code => code.match(/'_clonewp_source_url'=>json_decode\(base64_decode\('([^']+)'\)/)?.[1]).filter((value): value is string => Boolean(value)).map(value => JSON.parse(Buffer.from(value, 'base64').toString()));
    assert.equal(storedSource.length, 1); assert.match(storedSource[0], /^urn:clonewp:sha256:[a-f0-9]{64}$/);
  } finally { await fixture.close(); await unlink(file); await rmdir(directory); }
});

test('cached media verification is owner scoped, validates identity before requests and batches read-only proof', async () => {
  const fixture = await fakeWordPress();
  try {
    const asset = { attachmentId: 42, sha256: 'a'.repeat(64), sourceUrl: 'https://source.example/image.png', url: `${fixture.client.origin}/wp-content/uploads/image.png`, mimeType: 'image/png' };
    await assert.rejects(fixture.client.verifyImportedAssets(123, [asset]), /not created by this run/i);
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-run-cache', 'Fixture');
    const before = fixture.state.calls.length;
    await assert.rejects(fixture.client.verifyImportedAssets(draft.pageId, [{ ...asset, url: 'https://external.example/image.png' }]), /identity/);
    await assert.rejects(fixture.client.verifyImportedAssets(draft.pageId, [{ ...asset, sha256: 'invalid' }]), /identity/);
    assert.equal(fixture.state.calls.length, before);
    await fixture.client.verifyImportedAssets(draft.pageId, [asset, { ...asset, attachmentId: 43 }]);
    assert.equal(fixture.state.calls.length, before + 1);
    assert.deepEqual(fixture.state.elements, []);
    fixture.state.cachedMediaValid = false;
    await assert.rejects(fixture.client.verifyImportedAssets(draft.pageId, [asset]), /proof did not return success/);
  } finally { await fixture.close(); }
});

test('cold media registration returns guarded metadata in four requests and exact owned reuse needs only one readonly PHP request',async()=>{
  const fixture=await fakeWordPress(),directory=await mkdtemp(path.join(tmpdir(),'clonewp-import-roundtrip-')),file=path.join(directory,'fixture.png'),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpX0AAAAASUVORK5CYII=','base64');await writeFile(file,bytes);
  try{
    await fixture.client.discoverCapabilities();const draft=await fixture.client.createDraft('fixture-import-roundtrip','Fixture'),options={runId:'fixture-import-roundtrip',pageId:draft.pageId,sourceUrl:'https://source.example/current.png',mimeType:'image/png'};
    const before=fixture.client.diagnostics();const imported=await fixture.client.importAsset(file,options),after=fixture.client.diagnostics();assert.equal(after.httpAttempts-before.httpAttempts,4);assert.equal(after.phpCalls-before.phpCalls,2);assert.equal(imported.attachmentId,201);
    const code=fixture.state.phpCodes.find(code=>code.includes('media_handle_sideload'))!;assert.match(code,/return \$assetMetadata\(\(int\)\$attachmentId\)/);assert.match(code,/\(int\)\$media->post_parent!==\$id/);assert.match(code,/'_clonewp_run_id',true\)!==\$run/);assert.match(code,/'_clonewp_sha256',true\)!==\$expectedDigest/);assert.match(code,/'_clonewp_source_url',true\)!==\$expectedSource/);assert.match(code,/hash_file\('sha256',\$real\)!==\$expectedDigest/);assert.match(code,/str_starts_with\(\$real,\$upload\.DIRECTORY_SEPARATOR\)/);
    const reused=await fixture.client.importAsset(file,{...options,requireExisting:true}),reusedMetrics=fixture.client.diagnostics();assert.deepEqual(reused,imported);assert.equal(reusedMetrics.httpAttempts-after.httpAttempts,1);assert.equal(reusedMetrics.phpCalls-after.phpCalls,1);const reusePHP=fixture.state.phpCodes.at(-1)!;assert.doesNotMatch(reusePHP,/media_handle_sideload|update_post_meta|wp_insert_post|->save\s*\(/);assert.match(reusePHP,/'post_parent'=>\$id/);
    fixture.state.mediaIdentityValid=false;const uploadCalls=fixture.state.calls.filter(call=>call.args.ability_name==='novamira/create-upload-link').length;await assert.rejects(fixture.client.importAsset(file,{...options,requireExisting:true}),/bounded Novamira/);assert.equal(fixture.state.calls.filter(call=>call.args.ability_name==='novamira/create-upload-link').length,uploadCalls);
    fixture.state.mediaIdentityValid=true;fixture.state.existingMedia=false;await assert.rejects(fixture.client.importAsset(file,{...options,requireExisting:true}),error=>error instanceof WordPressError&&error.code==='existing_asset_required');assert.equal(fixture.state.calls.filter(call=>call.args.ability_name==='novamira/create-upload-link').length,uploadCalls);
    fixture.state.existingMedia=true;for(const malformed of [{attachmentId:0,url:imported.url,mimeType:'image/png'},{attachmentId:201,url:`http://user:private@${new URL(imported.url).host}/wrong.png`,mimeType:'image/png'},{attachmentId:201,url:imported.url,mimeType:'image/jpeg'}]){fixture.state.mediaOverride=malformed;await assert.rejects(fixture.client.importAsset(file,{...options,requireExisting:true}),WordPressError);}
  }finally{await fixture.close();await unlink(file);await rmdir(directory);}
});

test('MCP errors and malformed archive data remain explicit failures', () => {
  assert.throws(() => decodeToolResult({ content: [{ type: 'text', text: 'not JSON' }] }), WordPressError);
  assert.throws(() => decodeToolResult({ isError: true, structuredContent: { fake: 'success' } }), WordPressError);
  assert.throws(() => zipEntries(Buffer.from('not a ZIP')), WordPressError);
});

test('request diagnostics retain aggregate counts and return isolated copies without authentication or request data',async()=>{
  const fixture=await fakeWordPress();
  try{
    await fixture.client.discoverCapabilities();await fixture.client.getWidgetSchema('container');
    const draft=await fixture.client.createDraft('fixture-diagnostics','Fixture'),before=await fixture.client.snapshotDraft(draft.pageId);
    await fixture.client.buildDraft(draft.pageId,{elements:structuredClone(tree)},undefined,{expectedCurrent:before});
    const metrics=fixture.client.diagnostics();assert.equal(metrics.documentSaves,1);assert.equal(metrics.documentReads,3);assert.equal(metrics.capabilityDiscoveries,1);assert.ok(metrics.schemaCacheHits>=1);assert.ok(metrics.httpAttempts>0);assert.ok(metrics.phpCalls>=4);assert.ok(metrics.httpDurationMs>=0);assert.ok(metrics.registryCacheHits>0);
    assert.doesNotMatch(JSON.stringify(metrics),/authorization|password|cookie|https?:|token|username/i);metrics.documentReads=999;assert.equal(fixture.client.diagnostics().documentReads,3);
  }finally{await fixture.close();}
});

test('media retry is limited to lookup failures with process-local proof that no write started', async () => {
  const fixture = await fakeWordPress(), directory = await mkdtemp('D:/cloneWP/.cache/media-read-retry-'), file = path.join(directory, 'fixture.png');
  await writeFile(file, Buffer.from('verified fixture bytes'));
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-media-retry', 'Fixture');
    fixture.state.failMediaLookupCount = 2;
    const phases: string[] = [];
    await importAssetAttemptV2(fixture.client, file, { runId: 'fixture-media-retry', pageId: draft.pageId, sourceUrl: 'https://source.example/fixture.png', mimeType: 'image/png', onCheckpoint: checkpoint => { phases.push(checkpoint.phase); } });
    assert.equal(phases.filter(phase => phase === 'lookup').length, 3); assert.equal(fixture.state.uploads, 1);
    fixture.state.existingMedia = false; fixture.state.failMediaLookupCount = 3;
    await assert.rejects(importAssetAttemptV2(fixture.client, file, { runId: 'fixture-media-retry', pageId: draft.pageId, sourceUrl: 'https://source.example/other.png', mimeType: 'image/png' }), error => getAssetImportFailure(error)?.remoteWriteStarted === false);
    assert.equal(fixture.state.uploads, 1);
    let calls = 0;
    await assert.rejects(importAssetAttemptV2({ importAsset: async () => { calls++; throw new WordPressError('network_error', 'Fabricated timeout'); } }, file, { runId: 'fixture-media-retry', pageId: draft.pageId, sourceUrl: 'https://source.example/other.png', mimeType: 'image/png' })); assert.equal(calls, 1);
  } finally { await fixture.close(); await unlink(file); await rmdir(directory); }
});

test('lost upload response is inspected then registered from the exact staged bytes without a second PUT', async () => {
  const fixture = await fakeWordPress(), directory = await mkdtemp('D:/cloneWP/.cache/media-upload-recovery-'), file = path.join(directory, 'fixture.png'), bytes = Buffer.from('verified fixture bytes');
  await writeFile(file, bytes);
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-upload-recovery', 'Fixture');
    const options = { runId: 'fixture-upload-recovery', pageId: draft.pageId, sourceUrl: 'https://source.example/fixture.png', mimeType: 'image/png', verifiedSha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex') };
    fixture.state.loseUploadResponse = true;
    await assert.rejects(importAssetAttemptV2(fixture.client, file, options), error => { assert.deepEqual(getAssetImportFailure(error), { phase: 'uploading', remoteWriteStarted: true }); return true; });
    assert.equal(fixture.state.uploads, 1); assert.equal(fixture.state.existingMedia, false);
    const beforeInspect = fixture.client.diagnostics(); assert.equal((await fixture.client.inspectPendingAsset(file, options)).status, 'staged'); assert.equal(fixture.client.diagnostics().mediaUploadBytes, beforeInspect.mediaUploadBytes);
    const imported = await fixture.client.importAsset(file, { ...options, recoverPendingUpload: true }); assert.equal(imported.attachmentId, 201); assert.equal(fixture.state.uploads, 1);
    const registration = fixture.state.phpCodes.find(code => code.includes('media_handle_sideload'))!; assert.match(registration, /'meta_input'=>\['_clonewp_run_id'/); assert.match(registration, /LOCK_EX\|LOCK_NB/); assert.doesNotMatch(registration, /@unlink/);
    fixture.state.existingMedia = false; fixture.state.stagedBytes = 0;
    await assert.rejects(fixture.client.importAsset(file, { ...options, recoverPendingUpload: true }), error => error instanceof WordPressError && error.code === 'pending_asset_absent'); assert.equal(fixture.state.uploads, 1);
    fixture.state.pendingAttachmentIds = [202]; assert.equal((await fixture.client.inspectPendingAsset(file, options)).status, 'attachment-present');
  } finally { await fixture.close(); await unlink(file); await rmdir(directory); }
});

test('lost media registration response resolves through exact current-run metadata without another upload', async () => {
  const fixture = await fakeWordPress(), directory = await mkdtemp('D:/cloneWP/.cache/media-register-recovery-'), file = path.join(directory, 'fixture.png'); await writeFile(file, 'verified fixture bytes');
  try {
    await fixture.client.discoverCapabilities(); const draft = await fixture.client.createDraft('fixture-register-recovery', 'Fixture'), options = { runId: 'fixture-register-recovery', pageId: draft.pageId, sourceUrl: 'https://source.example/fixture.png', mimeType: 'image/png' }; fixture.state.loseRegisterResponse = true;
    await assert.rejects(importAssetAttemptV2(fixture.client, file, options), error => { assert.deepEqual(getAssetImportFailure(error), { phase: 'registering', remoteWriteStarted: true }); return true; }); assert.equal(fixture.state.uploads, 1);
    assert.equal((await fixture.client.importAsset(file, { ...options, requireExisting: true })).attachmentId, 201); assert.equal(fixture.state.uploads, 1);
  } finally { await fixture.close(); await unlink(file); await rmdir(directory); }
});

test('explicit source font registration is owned, hash-bound, recoverable and never enables image-font confusion', async () => {
  const fixture=await fakeWordPress(),directory=await mkdtemp('D:/cloneWP/.cache/ttf-registration-'),file=path.join(directory,'source.ttf'),bytes=sourceFontFixture();await writeFile(file,bytes);
  try {
    await fixture.client.discoverCapabilities();const draft=await fixture.client.createDraft('fixture-source-font','Font fixture'),options={runId:'fixture-source-font',pageId:draft.pageId,sourceUrl:'https://source.example/source.ttf',mimeType:'font/ttf',verifiedSha256:createHash('sha256').update(bytes).digest('hex')};
    fixture.state.mediaOverride={attachmentId:201,url:fixture.origin+'/wp-content/uploads/source.ttf',mimeType:'font/ttf',variants:[]};
    await assert.rejects(fixture.client.importAsset(file,options),/explicitly verified supported media/);
    await assert.rejects(fixture.client.importSourceFont(file,{...options,verifiedSha256:'0'.repeat(64)}),/Local media differs/);assert.equal(fixture.state.uploads,0);
    fixture.state.loseRegisterResponse=true;await assert.rejects(fixture.client.importSourceFont(file,options),error=>getAssetImportFailure(error)?.phase==='registering');assert.equal(fixture.state.uploads,1);
    const result=await fixture.client.importSourceFont(file,{...options,requireExisting:true});assert.equal(result.mimeType,'font/ttf');assert.equal(fixture.state.uploads,1);
    await fixture.client.verifyImportedAssets(draft.pageId,[result]);
    const registration=fixture.state.phpCodes.find(code=>code.includes('wp_insert_attachment'))!;assert.match(registration,/'post_mime_type'=>'font\/ttf'/);assert.match(registration,/'post_parent'=>\$id/);assert.doesNotMatch(registration,/add_filter|upload_mimes|media_handle_sideload/);
    assert.match(registration,/get_post_mime_type\(\$a\)==='font\/ttf'\?get_attached_file\(\$a\)/,'WordPress original-image lookup returns false for a font');
    assert.match(fixture.state.phpCodes.find(code=>code.includes('cached_media_bytes_changed'))!,/get_post_mime_type\(\$a\['id'\]\)==='font\/ttf'\?get_attached_file/);
  }finally{await fixture.close();await unlink(file);await rmdir(directory)}
});
