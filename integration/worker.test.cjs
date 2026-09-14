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
    host: '127.0.0.1', port: 0, modules: true, scriptPath: 'dist/worker/index.js',
    compatibilityDate: config.compatibility_date,
    durableObjects: Object.fromEntries(config.durable_objects.bindings.map(binding =>
      [binding.name, { className: binding.class_name, useSQLite: true }])),
    kvNamespaces: config.kv_namespaces.map(binding => binding.binding),
  }));
  await mf.ready;
});
after(async () => { await mf?.dispose(); });

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
