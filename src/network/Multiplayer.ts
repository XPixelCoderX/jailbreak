const configuredRelay = import.meta.env.VITE_MULTIPLAYER_WS_URL as string | undefined;

export class Multiplayer {
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private generation = 0;
  public onSignal: (code: string) => void = () => {};
  public code = '';
  public role: 'host' | 'guest' | null = null;
  public onStatus: (text: string) => void = () => {};
  public onChat: (text: string, sender: string) => void = () => {};
  public onPosition: (position: number[], yaw: number) => void = () => {};
  public onShot: (origin: number[], direction: number[]) => void = () => {};
  public onDisconnect: () => void = () => {};

  connect(action: 'host' | 'join', code = ''): void {
    this.disconnect();
    const url = configuredRelay || localStorage.getItem('suppression-relay-url') ||
      (location.hostname.endsWith('github.io') ? '' : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    if (!/^wss?:\/\//.test(url) || (location.protocol === 'https:' && !url.startsWith('wss://'))) {
      this.onStatus('Set a secure WSS relay URL to play from GitHub Pages.');
      return;
    }
    const socket = new WebSocket(url);
    this.socket = socket;
    this.onStatus('Connecting to relay…');
    socket.onopen = () => socket.send(JSON.stringify({ type: action, code }));
    socket.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'ready') { this.code = msg.code; this.role = msg.role; this.onStatus(`${msg.role === 'host' ? 'Hosting' : 'Joined'} room ${msg.code} · ${msg.role === 'host' ? 'Share this code with a friend' : 'Connected to host'}`); }
      if (msg.type === 'peer') { this.onStatus(msg.connected ? 'Partner connected · Room ' + this.code : 'Partner disconnected · Room ' + this.code); if (!msg.connected) this.onDisconnect(); }
      if (msg.type === 'position' || msg.type === 'shot' || msg.type === 'chat') this.receive(msg);
      if (msg.type === 'error') this.onStatus(msg.message);
      if (msg.type === 'closed') { this.onStatus('Host ended the session.'); this.disconnect(); }
    };
    socket.onerror = () => this.onStatus('Connection failed. Check the WSS relay URL and server.');
    socket.onclose = () => { if (this.socket === socket) { this.socket = null; this.role = null; this.onDisconnect(); } };
  }
  private receive(msg: any): void {
    if (msg.type === 'position' && Array.isArray(msg.position) && msg.position.length === 3 && msg.position.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) this.onPosition(msg.position, msg.yaw);
    if (msg.type === 'shot' && Array.isArray(msg.origin) && Array.isArray(msg.direction) && [msg.origin, msg.direction].every(v => v.length === 3 && v.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))) this.onShot(msg.origin, msg.direction);
    if (msg.type === 'chat' && typeof msg.text === 'string') this.onChat(msg.text.slice(0, 240), msg.role === 'host' ? 'HOST' : 'GUEST');
  }

  private createPeer(role: 'host' | 'guest'): RTCPeerConnection {
    this.disconnect();
    this.role = role;
    // STUN helps browsers discover a direct route; it never carries game traffic.
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.peer = peer;
    peer.ondatachannel = (event) => this.attachChannel(event.channel);
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
        this.onStatus(`Direct connection ${peer.connectionState}. Try new codes or use a relay room.`);
        this.disconnect();
      }
    };
    return peer;
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => this.onStatus('Direct peer connection established · Chat and positions online');
    channel.onclose = () => { if (this.channel === channel) { this.onStatus('Peer disconnected'); this.disconnect(); } };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 2048) return;
      try { this.receive(JSON.parse(event.data)); } catch { /* ignore invalid peer data */ }
    };
  }

  private async gather(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      const done = () => { peer.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
      const check = () => { if (peer.iceGatheringState === 'complete') done(); };
      const timer = window.setTimeout(done, 12000);
      peer.addEventListener('icegatheringstatechange', check);
      check();
    });
  }

  private encode(description: RTCSessionDescription | null): string {
    if (!description) throw new Error('No connection description available.');
    return btoa(JSON.stringify({ type: description.type, sdp: description.sdp }));
  }

  private decode(code: string, type: 'offer' | 'answer'): RTCSessionDescriptionInit {
    let data: unknown;
    try { const compact = code.replace(/\s/g, ''); if (compact.length > 150000) throw new Error('too long'); data = JSON.parse(atob(compact)); } catch { throw new Error('Invalid connection code. Copy the entire code.'); }
    if (!data || typeof data !== 'object' || !('type' in data) || data.type !== type || !('sdp' in data) || typeof data.sdp !== 'string' || data.sdp.length > 100000) throw new Error(`Expected a valid ${type} code.`);
    return data as RTCSessionDescriptionInit;
  }

  async hostDirect(): Promise<void> {
    const peer = this.createPeer('host');
    const generation = this.generation;
    try {
      this.attachChannel(peer.createDataChannel('game'));
      await peer.setLocalDescription(await peer.createOffer());
      this.onStatus('Generating offer code…');
      await this.gather(peer);
      if (this.generation !== generation) return;
      this.onSignal(this.encode(peer.localDescription));
      this.onStatus('Send the offer to your friend, then paste their answer below.');
    } catch (error) { if (this.generation === generation) { this.onStatus(String(error)); this.disconnect(); } }
  }

  async joinDirect(offer: string): Promise<void> {
    let remote: RTCSessionDescriptionInit;
    try { remote = this.decode(offer, 'offer'); } catch (error) { this.onStatus(String(error)); return; }
    const peer = this.createPeer('guest');
    const generation = this.generation;
    try {
      await peer.setRemoteDescription(remote);
      await peer.setLocalDescription(await peer.createAnswer());
      this.onStatus('Generating answer code…');
      await this.gather(peer);
      if (this.generation !== generation) return;
      this.onSignal(this.encode(peer.localDescription));
      this.onStatus('Send the answer to the host. Waiting for direct connection…');
    } catch (error) { if (this.generation === generation) { this.onStatus(String(error)); this.disconnect(); } }
  }

  async acceptAnswer(answer: string): Promise<void> {
    if (!this.peer || this.role !== 'host' || this.peer.signalingState !== 'have-local-offer') { this.onStatus('Generate a host offer first.'); return; }
    try { await this.peer.setRemoteDescription(this.decode(answer, 'answer')); this.onStatus('Connecting directly to peer…'); }
    catch (error) { this.onStatus(String(error)); }
  }

  sendPosition(position: number[], yaw: number): void { this.send({ type: 'position', position, yaw }); }
  shoot(origin: number[], direction: number[]): void { this.send({ type: 'shot', origin, direction }); }
  chat(text: string): void { if (this.connected && this.role) { this.send({ type: 'chat', text: text.slice(0, 240) }); this.onChat(text.slice(0, 240), 'YOU'); } }
  private get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN || this.channel?.readyState === 'open'; }
  private send(data: object): void {
    if (!this.role) return;
    const payload = JSON.stringify(data);
    if (this.channel?.readyState === 'open') this.channel.send(payload);
    else if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload);
  }
  disconnect(): void {
    this.generation++;
    this.socket?.close(); this.socket = null;
    if (this.channel) { this.channel.onclose = null; this.channel.close(); }
    this.channel = null;
    this.peer?.close(); this.peer = null;
    this.role = null; this.code = '';
    this.onDisconnect();
  }
}
