const { test } = require('node:test');
const assert = require('node:assert/strict');
const { default: app, MeshRoom } = require('../dist/index.js');

test('health endpoint returns service identity without storage bindings', async () => {
  const response = await app.request('/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'healthy');
  assert.equal(body.service, 'blackroad-mesh');
});

test('WebSocket endpoints require an upgrade before accessing bindings', async () => {
  for (const path of ['/ws', '/room/test/ws']) {
    const response = await app.request(path);
    assert.equal(response.status, 426);
    assert.deepEqual(await response.json(), { error: 'Expected WebSocket upgrade' });
  }
});

test('broadcast requires an agent identity before writing an event', async () => {
  const response = await app.request('/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
  });
  assert.equal(response.status, 400);
});

test('broadcast persists the event under its returned identifier', async () => {
  const writes = [];
  const response = await app.request('/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-ID': 'roadie-1' },
    body: JSON.stringify({ payload: { message: 'hello' } }),
  }, { EVENTS: { put: async (...args) => writes.push(args) },
    MESH: { idFromName: name => name, get: () => ({ fetch: async request => {
      assert.equal(new URL(request.url).pathname, '/broadcast');
      const message = await request.json();
      assert.equal(message.from, 'roadie-1');
      assert.deepEqual(message.payload, { message: 'hello' });
      return Response.json({ success: true });
    } }) } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], `event:${body.event.id}`);
  assert.deepEqual(JSON.parse(writes[0][1]), body.event);
  assert.equal(body.event.actor, 'roadie-1');
  assert.deepEqual(body.event.data, { message: 'hello' });
  assert.match(body.event.hash, /^sha256_[0-9a-f]{32}$/);
});

test('presence forwards to the global Durable Object', async () => {
  const agents = [{ agentId: 'roadie-1' }];
  const env = { MESH: {
    idFromName(name) { assert.equal(name, 'global'); return 'global-id'; },
    get(id) {
      assert.equal(id, 'global-id');
      return { async fetch(request) {
        assert.equal(new URL(request.url).pathname, '/presence');
        return Response.json({ agents, count: 1 });
      } };
    },
  } };
  const response = await app.request('/presence', undefined, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { agents, count: 1 });
});

test('empty mesh room reports zero presence and rejects unknown routes', async () => {
  const room = new MeshRoom({ id: { toString: () => 'room-id' } }, {});
  const presence = await room.fetch(new Request('https://mesh/presence'));
  const body = await presence.json();
  assert.deepEqual(body.agents, []);
  assert.equal(body.count, 0);
  assert.equal((await room.fetch(new Request('https://mesh/missing'))).status, 404);
});
