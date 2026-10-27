import test from 'node:test';
import assert from 'node:assert/strict';
import { redactor } from '../src/core/config.js';

test('browser timeout errors strip session cookies and draft authentication query tokens', () => {
  const error = new Error('route.fetch: Timeout\n - cookie: wordpress_logged_in_test=private-session; tracking=visitor\n - Set-Cookie: secret=another-private-session\n GET https://own.example/?preview_nonce=private-preview&_wpnonce=private-nonce\n - Authorization: Basic private-auth');
  const masked = redactor()(error);
  assert.doesNotMatch(masked, /private-session|another-private-session|private-preview|private-nonce|private-auth|tracking=visitor/);
  assert.match(masked, /route.fetch: Timeout/);
  assert.match(masked, /cookie: \[REDACTED\]/);
});
