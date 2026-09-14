const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { unstable_readConfig } = require('wrangler');

let mf;
before(async () => {
  const config = unstable_readConfig({ config: 'wrangler.local.toml' });
  assert.equal(config.account_id, undefined);
  assert.ok(config.kv_namespaces.every(binding => binding.remote === false && !binding.id));
  mf = new Miniflare(convertV4MiniflareOptions({
    name: config.name, host: '127.0.0.1', port: 0, modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: config.compatibility_date,
    durableObjects: Object.fromEntries(config.durable_objects.bindings.map(binding =>
      [binding.name, { className: binding.class_name, useSQLite: true }])),
    kvNamespaces: config.kv_namespaces.map(binding => binding.binding),
  }));
  await mf.ready;
});
after(async () => { await mf?.dispose(); });

test('sessions and message routing survive repeated Worker hibernation', async () => {
  const a = await connect('/room/recovery/ws?agent=recover-a&name=Alpha');
  const b = await connect('/room/recovery/ws?agent=recover-b&name=Beta');
  try {
    await a.receive(m => m.type === 'presence');
    await b.receive(m => m.type === 'presence');
    const before = await (await mf.dispatchFetch('http://mesh/room/recovery/presence')).json();
    for (let cycle = 0; cycle < 2; cycle++) {
      await mf.unsafeEvictDurableObject('blackroad-mesh-local', 'MeshRoom', { name: 'recovery', webSockets: 'hibernate' });
      const after = await (await mf.dispatchFetch('http://mesh/room/recovery/presence')).json();
      assert.equal(after.count, 2);
      assert.deepEqual(after.agents.map(a => [a.agentId, a.name, a.joinedAt]).sort(),
        before.agents.map(a => [a.agentId, a.name, a.joinedAt]).sort());
      a.socket.send(JSON.stringify({ type: 'direct', to: 'recover-b', payload: cycle }));
      assert.equal((await b.receive(m => m.type === 'direct' && m.payload === cycle)).from, 'recover-a');
      a.socket.send(JSON.stringify({ type: 'heartbeat' }));
      assert.equal((await a.receive(m => m.type === 'heartbeat')).payload.received, true);
    }
  } finally { a.socket.close(); b.socket.close(); }
});

test('binary UTF-8 JSON WebSocket messages are decoded', async () => {
  const client = await connect('/room/binary/ws?agent=binary-roadie');
  try {
    await client.receive(m => m.type === 'presence');
    client.socket.send(new TextEncoder().encode(JSON.stringify({ type: 'heartbeat' })));
    assert.equal((await client.receive(m => m.type === 'heartbeat')).payload.received, true);
  } finally { client.socket.close(); }
});

test('closing one of two sessions does not announce an agent departure', async () => {
  const first = await connect('/room/disconnect/ws?agent=shared');
  const second = await connect('/room/disconnect/ws?agent=shared');
  const observer = await connect('/room/disconnect/ws?agent=observer');
  const departures = [];
  observer.socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'leave' && message.from === 'shared') departures.push(message);
  });
  try {
    await observer.receive(m => m.type === 'presence');
    first.socket.close(1000, 'first closed');
    let presence;
    for (let i = 0; i < 100; i++) {
      presence = await (await mf.dispatchFetch('http://mesh/room/disconnect/presence')).json();
      if (presence.count === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(presence.count, 2);
    assert.equal(departures.length, 0);
    second.socket.send(JSON.stringify({ type: 'heartbeat' }));
    await second.receive(m => m.type === 'heartbeat');
    second.socket.close(1000, 'last closed');
    await observer.receive(m => m.type === 'leave' && m.from === 'shared');
    assert.equal(departures.length, 1);
  } finally {
    for (const client of [first, second, observer]) {
      if (client.socket.readyState === 1) client.socket.close();
    }
  }
});

async function connect(path) {
  const response = await mf.dispatchFetch(`http://mesh${path}`, { headers: { Upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  const messages = [];
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  socket.accept();
  async function receive(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected WebSocket message did not arrive');
  }
  return { socket, receive };
}

test('local Worker serves health and writes/reads actual local KV', async () => {
  const health = await mf.dispatchFetch('http://mesh/health');
  assert.equal(health.status, 200);
  const response = await mf.dispatchFetch('http://mesh/broadcast', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-ID': 'roadie-kv' },
    body: JSON.stringify({ payload: { text: 'local event' } }),
  });
  assert.equal(response.status, 200);
  const { event } = await response.json();
  const listing = await mf.dispatchFetch('http://mesh/events');
  assert.ok((await listing.json()).events.some(stored => stored.id === event.id));
});

test('real WebSockets exchange heartbeats and broadcasts using session identity', async () => {
  const a = await connect('/ws?agent=roadie-a&name=A');
  const b = await connect('/ws?agent=roadie-b&name=B');
  try {
    await a.receive(m => m.type === 'presence');
    await b.receive(m => m.type === 'presence');
    a.socket.send(JSON.stringify({ type: 'heartbeat' }));
    assert.equal((await a.receive(m => m.type === 'heartbeat')).payload.received, true);
    a.socket.send(JSON.stringify({ type: 'broadcast', from: 'spoofed', payload: 'hello' }));
    const message = await b.receive(m => m.type === 'broadcast' && m.payload === 'hello');
    assert.equal(message.from, 'roadie-a');
  } finally { a.socket.close(); b.socket.close(); }
});

test('named rooms retain their identity and isolate direct messages', async () => {
  const a = await connect('/room/team-a/ws?agent=sender');
  const b = await connect('/room/team-a/ws?agent=recipient');
  try {
    a.socket.send(JSON.stringify({ type: 'direct', to: 'recipient', payload: 'private' }));
    assert.equal((await b.receive(m => m.type === 'direct')).payload, 'private');
    const response = await mf.dispatchFetch('http://mesh/room/team-a/presence');
    const body = await response.json();
    assert.equal(body.room, 'team-a');
    assert.equal(body.count, 2);
    const other = await mf.dispatchFetch('http://mesh/room/team-b/presence');
    assert.equal((await other.json()).count, 0);
  } finally { a.socket.close(); b.socket.close(); }
});

test('HTTP broadcasts reach a connected WebSocket client', async () => {
  const client = await connect('/ws?agent=http-listener');
  try {
    await client.receive(m => m.type === 'presence');
    const response = await mf.dispatchFetch('http://mesh/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-ID': 'http-sender' },
      body: JSON.stringify({ payload: 'from-http' }),
    });
    assert.equal(response.status, 200);
    const message = await client.receive(m => m.type === 'broadcast' && m.payload === 'from-http');
    assert.equal(message.from, 'http-sender');
  } finally { client.socket.close(); }
});
