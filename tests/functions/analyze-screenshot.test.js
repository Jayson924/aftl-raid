// The screenshot analyzer's per-IP limit; no API key is set, so allowed calls stop at the key check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../../netlify/functions/analyze-screenshot.js';

delete process.env.ANTHROPIC_API_KEY;
const post = (ip) => handler({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': ip }, body: JSON.stringify({ image: 'x' }) });

test('an IP gets six reads per window, then 429; other IPs are unaffected', async () => {
  for (let i = 0; i < 6; i += 1) assert.equal((await post('10.0.0.1')).statusCode, 500);
  const blocked = await post('10.0.0.1');
  assert.equal(blocked.statusCode, 429);
  assert.match(JSON.parse(blocked.body).error, /try again/);
  assert.equal((await post('10.0.0.2')).statusCode, 500);
});
