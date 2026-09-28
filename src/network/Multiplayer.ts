export class Multiplayer {
  private socket: WebSocket | null = null;
  public code = '';
  public role: 'host' | 'guest' | null = null;
  public onStatus: (text: string) => void = () => {};
  public onChat: (text: string, sender: string) => void = () => {};
  public onPosition: (position: number[], yaw: number) => void = () => {};
  public onDisconnect: () => void = () => {};

  connect(action: 'host' | 'join', code = ''): void {
    this.disconnect();
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    this.socket = socket;
    this.onStatus('Connecting to relay…');
    socket.onopen = () => socket.send(JSON.stringify({ type: action, code }));
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ready') { this.code = msg.code; this.role = msg.role; this.onStatus(`${msg.role === 'host' ? 'Hosting' : 'Joined'} room ${msg.code} · ${msg.role === 'host' ? 'Share this code with a friend' : 'Connected to host'}`); }
      if (msg.type === 'peer') { this.onStatus(msg.connected ? 'Partner connected · Room ' + this.code : 'Partner disconnected · Room ' + this.code); if (!msg.connected) this.onDisconnect(); }
      if (msg.type === 'position') this.onPosition(msg.position, msg.yaw);
      if (msg.type === 'chat') this.onChat(msg.text, msg.role === 'host' ? 'HOST' : 'GUEST');
      if (msg.type === 'error') this.onStatus(msg.message);
      if (msg.type === 'closed') { this.onStatus('Host ended the session.'); this.disconnect(); }
    };
    socket.onerror = () => this.onStatus('Connection failed. Check that the websocket relay is running.');
    socket.onclose = () => { if (this.socket === socket) { this.socket = null; this.role = null; this.onDisconnect(); } };
  }
  sendPosition(position: number[], yaw: number): void { this.send({ type: 'position', position, yaw }); }
  chat(text: string): void { if (this.socket?.readyState === WebSocket.OPEN && this.role) { this.send({ type: 'chat', text: text.slice(0, 240) }); this.onChat(text.slice(0, 240), 'YOU'); } }
  private send(data: object): void { if (this.socket?.readyState === WebSocket.OPEN && this.role) this.socket.send(JSON.stringify(data)); }
  disconnect(): void { this.socket?.close(); this.socket = null; this.role = null; this.code = ''; this.onDisconnect(); }
}
