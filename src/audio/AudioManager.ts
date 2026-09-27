import type { GameSettings } from '../types';

export type MusicState = 'silence' | 'exploration' | 'tension' | 'nearby' | 'chase' | 'danger' | 'puzzle' | 'finale';

interface LoopVoice {
  source: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioManager {
  private readonly context = new AudioContext();
  private readonly master = this.context.createGain();
  private readonly music = this.context.createGain();
  private readonly sfx = this.context.createGain();
  private readonly ambient = this.context.createGain();
  private readonly voice = this.context.createGain();
  private readonly ui = this.context.createGain();
  private readonly noiseBuffer = this.createNoiseBuffer();
  private musicDrone: LoopVoice | null = null;
  private musicPulse: LoopVoice | null = null;
  private musicState: MusicState = 'silence';
  private breathingTimer = 0;
  private heartbeatTimer = 0;
  private initialized = false;

  constructor(settings: GameSettings) {
    this.master.connect(this.context.destination);
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.ambient.connect(this.master);
    this.voice.connect(this.master);
    this.ui.connect(this.master);
    this.applySettings(settings);
  }

  public async ensureStarted(): Promise<void> {
    if (this.context.state !== 'running') {
      await this.context.resume();
    }
    if (!this.initialized) {
      this.startAmbientLoops();
      this.initialized = true;
    }
  }

  public applySettings(settings: GameSettings): void {
    this.master.gain.value = settings.audio.master;
    this.music.gain.value = settings.audio.music;
    this.sfx.gain.value = settings.audio.sfx;
    this.ambient.gain.value = settings.audio.ambient;
    this.voice.gain.value = settings.audio.voice;
    this.ui.gain.value = settings.audio.ui;
  }

  public setPaused(paused: boolean): void {
    const now = this.context.currentTime;
    this.music.gain.cancelScheduledValues(now);
    this.ambient.gain.cancelScheduledValues(now);
    this.music.gain.linearRampToValueAtTime(paused ? 0.15 : this.music.gain.value || 0.65, now + 0.1);
    this.ambient.gain.linearRampToValueAtTime(paused ? 0.2 : this.ambient.gain.value || 0.8, now + 0.1);
  }

  public update(dt: number, fear: number, lowHealth: number): void {
    this.breathingTimer -= dt;
    this.heartbeatTimer -= dt;

    if (fear > 0.42 && this.breathingTimer <= 0) {
      this.breathingTimer = 1.3 - fear * 0.7;
      this.playBreath(0.08 + fear * 0.18);
    }

    const heartbeatIntensity = Math.max(fear * 0.7, lowHealth);
    if (heartbeatIntensity > 0.35 && this.heartbeatTimer <= 0) {
      this.heartbeatTimer = 1.2 - heartbeatIntensity * 0.7;
      this.playHeartbeat(0.06 + heartbeatIntensity * 0.16);
    }
  }

  public setMusicState(state: MusicState): void {
    if (this.musicState === state) {
      return;
    }
    this.musicState = state;

    const now = this.context.currentTime;
    const targetDrone = this.getDroneLevel(state);
    const targetPulse = this.getPulseLevel(state);

    if (this.musicDrone) {
      this.musicDrone.gain.gain.cancelScheduledValues(now);
      this.musicDrone.gain.gain.linearRampToValueAtTime(targetDrone, now + 1.5);
      if (this.musicDrone.source instanceof OscillatorNode) {
        this.musicDrone.source.frequency.linearRampToValueAtTime(this.getDroneFrequency(state), now + 1.5);
      }
    }
    if (this.musicPulse) {
      this.musicPulse.gain.gain.cancelScheduledValues(now);
      this.musicPulse.gain.gain.linearRampToValueAtTime(targetPulse, now + 1.0);
      if (this.musicPulse.source instanceof OscillatorNode) {
        this.musicPulse.source.frequency.linearRampToValueAtTime(this.getPulseFrequency(state), now + 0.8);
      }
    }
  }

  public playFootstep(surface: string, sprint: boolean, crouched: boolean): void {
    const volume = sprint ? 0.22 : crouched ? 0.08 : 0.15;
    const center = surface === 'metal' ? 850 : surface === 'water' ? 290 : 450;
    this.playNoiseHit(this.sfx, volume, 0.07, center, 0.5);
    if (surface === 'metal') {
      this.playTone(this.sfx, 180 + Math.random() * 50, 0.02, 0.09, 'triangle');
    }
  }

  public playDoor(heavy: boolean, opening: boolean): void {
    this.playNoiseHit(this.sfx, heavy ? 0.28 : 0.18, heavy ? 0.2 : 0.11, heavy ? 120 : 240, 1.4);
    this.playTone(this.sfx, opening ? 110 : 92, heavy ? 0.07 : 0.05, heavy ? 0.16 : 0.1, 'sawtooth');
  }

  public playPickup(type: string): void {
    const base = type === 'medical' ? 480 : type === 'keycard' ? 720 : 560;
    this.playTone(this.ui, base, 0.06, 0.1, 'triangle');
    this.playTone(this.ui, base * 1.33, 0.05, 0.14, 'sine');
  }

  public playFlashlightToggle(on: boolean): void {
    this.playTone(this.sfx, on ? 880 : 480, 0.04, 0.08, 'square');
    this.playNoiseHit(this.sfx, 0.06, 0.03, on ? 1400 : 700, 0.4);
  }

  public playUiBeep(): void {
    this.playTone(this.ui, 700, 0.05, 0.08, 'square');
  }

  public playUiOpen(): void {
    this.playTone(this.ui, 420, 0.06, 0.12, 'triangle');
    this.playTone(this.ui, 620, 0.04, 0.1, 'sine');
  }

  public playUiError(): void {
    this.playTone(this.ui, 210, 0.09, 0.12, 'sawtooth');
    this.playNoiseHit(this.ui, 0.08, 0.06, 500, 0.8);
  }

  public playAnnouncementChime(): void {
    this.playTone(this.voice, 520, 0.05, 0.16, 'triangle');
    this.playTone(this.voice, 780, 0.04, 0.2, 'triangle');
  }

  public playDistortedWhisper(): void {
    this.playNoiseHit(this.voice, 0.09, 0.25, 1800, 0.08);
    this.playTone(this.voice, 130 + Math.random() * 60, 0.02, 0.18, 'sine');
  }

  public playFootstepsInDistance(): void {
    for (let index = 0; index < 3; index += 1) {
      const delay = index * 0.18;
      window.setTimeout(() => {
        this.playNoiseHit(this.ambient, 0.05, 0.08, 320, 0.6);
      }, delay * 1000);
    }
  }

  public playRadioBurst(): void {
    this.playNoiseHit(this.voice, 0.1, 0.35, 1200, 0.1);
    this.playTone(this.voice, 1600, 0.02, 0.12, 'square');
  }

  public playMetalCreak(): void {
    this.playTone(this.ambient, 120 + Math.random() * 40, 0.04, 0.4, 'sawtooth');
    this.playNoiseHit(this.ambient, 0.06, 0.18, 600, 0.7);
  }

  public playEnemyPresence(distance: number): void {
    const amount = Math.max(0, 1 - distance / 18);
    if (amount <= 0) {
      return;
    }
    this.playTone(this.ambient, 42 + Math.random() * 8, 0.03 + amount * 0.03, 0.22, 'sine');
    this.playNoiseHit(this.ambient, 0.03 + amount * 0.05, 0.14, 280, 0.2);
  }

  private startAmbientLoops(): void {
    this.createOscillatorLoop(this.ambient, 'sine', 57, 0.04);
    this.createNoiseLoop(this.ambient, 0.028, 3800, 0.05);
    this.musicDrone = this.createOscillatorLoop(this.music, 'triangle', 70, 0);
    this.musicPulse = this.createOscillatorLoop(this.music, 'sine', 120, 0);
  }

  private createOscillatorLoop(parent: GainNode, type: OscillatorType, frequency: number, gainValue: number): LoopVoice {
    const gain = this.context.createGain();
    gain.gain.value = gainValue;
    gain.connect(parent);

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(gain);

    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.connect(filter);
    oscillator.start();

    return { source: oscillator, gain };
  }

  private createNoiseLoop(parent: GainNode, gainValue: number, frequency: number, q: number): LoopVoice {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const gain = this.context.createGain();
    gain.gain.value = gainValue;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(parent);
    source.start();

    return { source, gain };
  }

  private playTone(parent: GainNode, frequency: number, gainValue: number, duration: number, type: OscillatorType): void {
    if (this.context.state !== 'running') {
      return;
    }
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(400, frequency * 4);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(parent);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  }

  private playNoiseHit(parent: GainNode, gainValue: number, duration: number, frequency: number, q: number): void {
    if (this.context.state !== 'running') {
      return;
    }
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = Math.max(q, 0.01);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(parent);
    source.start(now);
    source.stop(now + duration + 0.04);
  }

  private playBreath(gainValue: number): void {
    this.playNoiseHit(this.voice, gainValue, 0.55, 520, 0.16);
  }

  private playHeartbeat(gainValue: number): void {
    this.playTone(this.voice, 70, gainValue, 0.09, 'sine');
    window.setTimeout(() => {
      this.playTone(this.voice, 55, gainValue * 0.9, 0.11, 'sine');
    }, 130);
  }

  private getDroneLevel(state: MusicState): number {
    switch (state) {
      case 'exploration': return 0.015;
      case 'tension': return 0.03;
      case 'nearby': return 0.06;
      case 'chase': return 0.12;
      case 'danger': return 0.08;
      case 'puzzle': return 0.025;
      case 'finale': return 0.14;
      case 'silence':
      default:
        return 0;
    }
  }

  private getPulseLevel(state: MusicState): number {
    switch (state) {
      case 'nearby': return 0.015;
      case 'chase': return 0.06;
      case 'danger': return 0.04;
      case 'finale': return 0.08;
      case 'tension': return 0.01;
      default:
        return 0;
    }
  }

  private getDroneFrequency(state: MusicState): number {
    switch (state) {
      case 'chase': return 62;
      case 'finale': return 48;
      case 'danger': return 58;
      default:
        return 70;
    }
  }

  private getPulseFrequency(state: MusicState): number {
    switch (state) {
      case 'nearby': return 92;
      case 'chase': return 138;
      case 'finale': return 166;
      case 'danger': return 120;
      default:
        return 112;
    }
  }

  private createNoiseBuffer(): AudioBuffer {
    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
