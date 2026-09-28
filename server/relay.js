import { WebSocketServer, WebSocket } from 'ws';

const rooms = new Map();
const send = (socket, data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
export function attachRelay(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    let room = null;
    let role = null;
    socket.on('message', (raw) => {
      if (raw.length > 2048) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!room && msg.type === 'host') {
        let code;
        do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(code));
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
      } else if (room && (msg.type === 'position' || msg.type === 'chat')) {
        if (msg.type === 'position' && (!Array.isArray(msg.position) || msg.position.length !== 3 || !msg.position.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10000))) return;
        if (msg.type === 'chat' && (typeof msg.text !== 'string' || !msg.text.trim())) return;
        send(role === 'host' ? room.guest : room.host, msg.type === 'chat'
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
