import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachRelay } from '../server/relay.js';

const message = (socket) => new Promise((resolve, reject) => {
  socket.once('message', (raw) => resolve(JSON.parse(raw.toString())));
  socket.once('error', reject);
});

test('host code, join, chat, shot and disconnect', async () => {
  const server = createServer();
  const wss = attachRelay(server);
  server.listen(0);
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const host = new WebSocket(url);
  await once(host, 'open');
  host.send(JSON.stringify({ type: 'host' }));
  const ready = await message(host);
  assert.match(ready.code, /^[A-F0-9]{6}$/);
  const guest = new WebSocket(url);
  await once(guest, 'open');
  guest.send(JSON.stringify({ type: 'join', code: ready.code.toLowerCase() }));
  assert.equal((await message(guest)).role, 'guest');
  assert.deepEqual(await message(host), { type: 'peer', connected: true });
  guest.send(JSON.stringify({ type: 'chat', text: 'hello' }));
  assert.deepEqual(await message(host), { type: 'chat', text: 'hello', role: 'guest' });
  host.send(JSON.stringify({ type: 'shot', origin: [1, 2, 3], direction: [0, 0, -1] }));
  assert.deepEqual(await message(guest), { type: 'shot', origin: [1, 2, 3], direction: [0, 0, -1] });
  guest.close();
  assert.deepEqual(await message(host), { type: 'peer', connected: false });
  host.close();
  wss.close();
  server.close();
});
