import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

const rooms = new Map();
const send = (socket, data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
export function attachRelay(server) {
  // Only handle our own endpoint. Vite's HMR WebSocket must receive every other upgrade.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url || '/', 'http://localhost').pathname !== '/ws') return;
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });
  wss.on('connection', (socket) => {
    let room = null;
    let role = null;
    socket.on('message', (raw) => {
      if (raw.length > 2048) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!room && msg.type === 'host') {
        let code;
        do { code = randomBytes(5).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
        room = { code, host: socket, guest: null };
        rooms.set(code, room);
        role = 'host';
        send(socket, { type: 'ready', code, role });
      } else if (!room && msg.type === 'join') {
        const target = rooms.get(String(msg.code || '').trim().toUpperCase());
        if (!target || target.guest) { send(socket, { type: 'error', message: 'Room unavailable or full.' }); return; }
        room = target;
        role = 'guest';
        room.guest = socket;
        send(socket, { type: 'ready', code: room.code, role });
        send(room.host, { type: 'peer', connected: true });
      } else if (room && (msg.type === 'position' || msg.type === 'chat' || msg.type === 'shot')) {
        if (msg.type === 'position' && (!Array.isArray(msg.position) || msg.position.length !== 3 || !msg.position.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10000))) return;
        if (msg.type === 'chat' && (typeof msg.text !== 'string' || !msg.text.trim())) return;
        if (msg.type === 'shot' && (![msg.origin, msg.direction].every(v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10000)))) return;
        send(role === 'host' ? room.guest : room.host, msg.type === 'shot' ? { type: 'shot', origin: msg.origin, direction: msg.direction } : msg.type === 'chat'
          ? { type: 'chat', text: msg.text.slice(0, 240), role }
          : { type: 'position', position: msg.position, yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0 });
      }
    });
    socket.on('close', () => {
      if (!room) return;
      if (role === 'host') { send(room.guest, { type: 'closed' }); room.guest?.close(); rooms.delete(room.code); }
      else { room.guest = null; send(room.host, { type: 'peer', connected: false }); }
    });
  });
  return wss;
}
