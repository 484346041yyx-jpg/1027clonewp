import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { previewCookies } from '../src/wordpress/preview-session.js';

async function localServer(listener: http.RequestListener) {
  const server = http.createServer(listener); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local fixture server did not bind');
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve,reject) => { server.closeAllConnections(); server.close(error=>error?reject(error):resolve()); }) };
}
test('preview login never forwards a raw one-time URL or cookie-bearing network error when navigation fails', async () => {
  const fixture = await localServer((_request,response)=>{ response.destroy(); });
  try {
    await assert.rejects(previewCookies(`${fixture.origin}/login?access_token=private-fixture-access&novamira_nonce=private-fixture-nonce`,fixture.origin),error=>{
      assert.equal((error as Error).message,'One-time owned preview login navigation failed; authentication details omitted');
      assert.doesNotMatch(String(error),/private-fixture|access_token|novamira_nonce|127\.0\.0\.1|Cookie:/i); return true;
    });
  } finally { await fixture.close(); }
});
test('same-origin one-time preview returns only exact host-scoped WordPress session cookies in memory', async () => {
  const target=await localServer((_request,response)=>{ response.setHeader('Set-Cookie',['wordpress_logged_in_fixture=private-fixture-session; Path=/; HttpOnly','unrelated_fixture=private-fixture-other; Path=/']); response.setHeader('Content-Type','text/html'); response.end('<html><body>Owned fixture preview</body></html>'); });
  try {
    const cookies=await previewCookies(`${target.origin}/login?access_token=private-fixture-access`,target.origin);
    assert.equal(cookies.length,1); assert.equal(cookies[0].name,'wordpress_logged_in_fixture'); assert.equal(cookies[0].domain,'127.0.0.1');
    assert.equal(cookies[0].path,'/'); assert.equal(cookies[0].httpOnly,true);
  } finally { await target.close(); }
});
test('preview authentication rejects cross-origin and credential-bearing links before making a browser request', async () => {
  await assert.rejects(previewCookies('https://another.example/login?access_token=private-fixture-access','https://target.example/'),/credential-free configured target origin/);
  await assert.rejects(previewCookies('https://private-fixture-user:private-fixture-password@target.example/login','https://target.example/'),error=>{ assert.doesNotMatch(String(error),/private-fixture/); return /credential-free configured target origin/.test(String(error)); });
});
