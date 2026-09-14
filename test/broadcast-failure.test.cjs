const { test } = require('node:test');
const assert = require('node:assert/strict');
const { default: app } = require('../dist/index.js');

for (const failure of ['rejected', 'unavailable']) {
  test(`HTTP broadcast reports stored event and failure when mesh is ${failure}`, async () => {
    const stored = [];
    const response = await app.request('/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-ID': 'roadie-1' },
      body: JSON.stringify({ payload: 'hello' }),
    }, {
      EVENTS: { put: async (...entry) => stored.push(entry) },
      MESH: { idFromName: name => name, get: () => ({ fetch: async () => {
        if (failure === 'unavailable') throw new Error('unavailable');
        return new Response('rejected', { status: 500 });
      } }) },
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(stored.length, 1);
    assert.equal(body.event.id, JSON.parse(stored[0][1]).id);
  });
}
