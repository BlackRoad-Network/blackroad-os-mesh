const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MeshRoom } = require('../dist/index.js');

function socket(attachment) {
  return { readyState: 1, sent: [], closes: [], attachment,
    deserializeAttachment() { return structuredClone(this.attachment); },
    serializeAttachment(value) { this.attachment = structuredClone(value); },
    send(value) { this.sent.push(JSON.parse(value)); },
    close(code, reason) { this.closes.push({ code, reason }); this.readyState = 3; },
  };
}
const saved = () => ({ version: 1, agentId: 'roadie', name: 'Roadie',
  joinedAt: '2026-09-14T00:00:00.000Z', lastSeen: 12345 });
const room = sockets => new MeshRoom({ getWebSockets: () => sockets, id: { toString: () => 'room' } }, {});
const presence = async mesh => (await (await mesh.fetch(new Request('https://mesh/presence'))).json()).agents;

test('presence restores stored timestamps without inventing fresh activity', async () => {
  const ws = socket(saved()); const mesh = room([ws]);
  const first = await presence(mesh); const second = await presence(mesh);
  assert.equal(first[0].lastSeen, 12345);
  assert.deepEqual(first, second);
  assert.equal(first[0].joinedAt, saved().joinedAt);
});

test('heartbeat state survives reconstruction from socket attachment', async () => {
  const ws = socket(saved()); room([ws]).webSocketMessage(ws, '{"type":"heartbeat"}');
  assert.ok(ws.attachment.lastSeen > 12345);
  assert.equal((await presence(room([ws])))[0].lastSeen, ws.attachment.lastSeen);
  assert.equal(ws.sent[0].type, 'heartbeat');
});

test('legacy and corrupt attachments require reconnection without made-up identity', async () => {
  const sockets = [null, {}, { ...saved(), version: 2 }, { ...saved(), lastSeen: 'yesterday' }].map(socket);
  assert.deepEqual(await presence(room(sockets)), []);
  for (const ws of sockets) assert.equal(ws.closes[0].code, 1012);
});

test('one unreadable attachment does not prevent valid peers from recovering', async () => {
  const broken = socket(null); broken.deserializeAttachment = () => { throw new Error('bad attachment'); };
  const good = socket(saved());
  assert.equal((await presence(room([broken, good]))).length, 1);
  assert.equal(broken.closes[0].code, 1012);
});

test('closing a peer does not refresh the remaining peer timestamp', async () => {
  const first = socket(saved()); const second = socket({ ...saved(), lastSeen: 54321 });
  const mesh = room([first, second]); mesh.webSocketClose(first, 1000, 'done', true);
  assert.equal((await presence(mesh))[0].lastSeen, 54321);
  assert.deepEqual(second.sent, []);
  assert.equal(first.closes[0].code, 1000);
});

test('received-only close code is not sent back on the wire', () => {
  const ws = socket(saved()); room([ws]).webSocketClose(ws, 1006, 'lost', false);
  assert.equal(ws.closes[0].code, 1011);
});
