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
  private readonly buzzGain = this.context.createGain();
  private readonly machineryGain = this.context.createGain();
  private readonly tensionGain = this.context.createGain();
  private readonly listenerPosition = { x: 0, y: 1.6, z: 0 };
  private readonly listenerRight = { x: 1, y: 0, z: 0 };

  constructor(settings: GameSettings) {
    this.master.connect(this.context.destination);
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.ambient.connect(this.master);
    this.voice.connect(this.master);
    this.ui.connect(this.master);
    this.buzzGain.gain.value = 0;
    this.buzzGain.connect(this.ambient);
    this.machineryGain.gain.value = 0;
    this.machineryGain.connect(this.ambient);
    this.tensionGain.gain.value = 0;
    this.tensionGain.connect(this.ambient);
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

  public playDistortedWhisper(pan = 0): void {
    const parent = this.pannedParent(this.voice, pan);
    this.playNoiseHit(parent, 0.09, 0.25, 1800, 0.08);
    this.playTone(parent, 130 + Math.random() * 60, 0.02, 0.18, 'sine');
  }

  public playFootstepsInDistance(pan = 0): void {
    const parent = this.pannedParent(this.ambient, pan);
    for (let index = 0; index < 3; index += 1) {
      const delay = index * 0.18;
      window.setTimeout(() => {
        this.playNoiseHit(parent, 0.05, 0.08, 320, 0.6);
      }, delay * 1000);
    }
  }

  public playRadioBurst(): void {
    this.playNoiseHit(this.voice, 0.1, 0.35, 1200, 0.1);
    this.playTone(this.voice, 1600, 0.02, 0.12, 'square');
  }

  public playMetalCreak(pan = 0): void {
    const parent = this.pannedParent(this.ambient, pan);
    this.playTone(parent, 120 + Math.random() * 40, 0.04, 0.4, 'sawtooth');
    this.playNoiseHit(parent, 0.06, 0.18, 600, 0.7);
  }

  public playEnemyPresence(distance: number, pan = 0): void {
    const amount = Math.max(0, 1 - distance / 18);
    if (amount <= 0) {
      return;
    }
    const parent = this.pannedParent(this.ambient, pan);
    this.playTone(parent, 42 + Math.random() * 8, 0.03 + amount * 0.03, 0.22, 'sine');
    this.playNoiseHit(parent, 0.03 + amount * 0.05, 0.14, 280, 0.2);
  }

  private startAmbientLoops(): void {
    this.createOscillatorLoop(this.ambient, 'sine', 57, 0.04);
    this.createNoiseLoop(this.ambient, 0.028, 3800, 0.05);
    this.musicDrone = this.createOscillatorLoop(this.music, 'triangle', 70, 0);
    this.musicPulse = this.createOscillatorLoop(this.music, 'sine', 120, 0);

    // Fluorescent ballast buzz (harsh 120 Hz harmonic + low hum)
    const buzzOsc = this.context.createOscillator();
    buzzOsc.type = 'square';
    buzzOsc.frequency.value = 120;
    const buzzFilter = this.context.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 2400;
    buzzFilter.Q.value = 5;
    buzzOsc.connect(buzzFilter);
    buzzFilter.connect(this.buzzGain);
    const buzzLow = this.context.createOscillator();
    buzzLow.type = 'sine';
    buzzLow.frequency.value = 60;
    const buzzLowGain = this.context.createGain();
    buzzLowGain.gain.value = 0.5;
    buzzLow.connect(buzzLowGain);
    buzzLowGain.connect(this.buzzGain);
    buzzOsc.start();
    buzzLow.start();

    // Distant ventilation / machinery rumble
    this.createNoiseLoop(this.machineryGain, 0.5, 190, 0.8);
    const rumble = this.context.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 46;
    const rumbleGain = this.context.createGain();
    rumbleGain.gain.value = 0.35;
    rumble.connect(rumbleGain);
    rumbleGain.connect(this.machineryGain);
    rumble.start();

    // Danger tension layer (breathy noise that swells near the Suppressor)
    this.createNoiseLoop(this.tensionGain, 0.55, 950, 0.6);
  }

  /** Follows the camera so one-shots can be spatialized. */
  public setListener(position: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): void {
    this.listenerPosition.x = position.x;
    this.listenerPosition.y = position.y;
    this.listenerPosition.z = position.z;
    const length = Math.hypot(right.x, right.y, right.z) || 1;
    this.listenerRight.x = right.x / length;
    this.listenerRight.y = right.y / length;
    this.listenerRight.z = right.z / length;
  }

  /** 0..1 — loud electrical buzzing from nearby flickering fixtures. */
  public setElectricalBuzz(level: number): void {
    if (!this.initialized) {
      return;
    }
    const now = this.context.currentTime;
    this.buzzGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.055, now, 0.12);
  }

  /** 0..1 — distant machinery / ventilation ambience. */
  public setMachineryAmbience(level: number): void {
    if (!this.initialized) {
      return;
    }
    const now = this.context.currentTime;
    this.machineryGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.075, now, 0.35);
  }

  /** 0..1 — raises a breathing tension layer when danger is close. */
  public setDangerTension(level: number): void {
    if (!this.initialized) {
      return;
    }
    const now = this.context.currentTime;
    this.tensionGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.05, now, 0.25);
  }

  private spatialGain(position: { x: number; y: number; z: number }): { gain: number; pan: number } {
    const dx = position.x - this.listenerPosition.x;
    const dy = position.y - this.listenerPosition.y;
    const dz = position.z - this.listenerPosition.z;
    const distance = Math.hypot(dx, dy, dz);
    const gain = distance <= 0 ? 1 : Math.max(0, 1 - distance / 26) * (1 / (1 + distance * 0.05));
    const pan = distance <= 0
      ? 0
      : (dx * this.listenerRight.x + dy * this.listenerRight.y + dz * this.listenerRight.z) / distance;
    return { gain: Math.min(1.2, gain), pan: Math.max(-1, Math.min(1, pan)) * 0.85 };
  }

  private pannedParent(base: GainNode, pan: number): AudioNode {
    if (Math.abs(pan) < 0.03) {
      return base;
    }
    const panner = this.context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(base);
    return panner;
  }

  public playPowerFailure(position?: { x: number; y: number; z: number }): void {
    const spatial = position ? this.spatialGain(position) : { gain: 1, pan: 0 };
    if (spatial.gain < 0.05) {
      return;
    }
    const parent = this.pannedParent(this.ambient, spatial.pan);
    this.playTone(parent, 240, 0.16 * spatial.gain, 1.3, 'sawtooth', 52);
    this.playNoiseHit(parent, 0.24 * spatial.gain, 1.1, 720, 0.5);
    window.setTimeout(() => {
      this.playTone(parent, 72, 0.22 * spatial.gain, 0.3, 'square');
      this.playNoiseHit(parent, 0.14 * spatial.gain, 0.35, 260, 1.2);
    }, 720);
  }

  public playPowerRestore(position?: { x: number; y: number; z: number }): void {
    const spatial = position ? this.spatialGain(position) : { gain: 1, pan: 0 };
    if (spatial.gain < 0.05) {
      return;
    }
    const parent = this.pannedParent(this.ambient, spatial.pan);
    this.playTone(parent, 54, 0.13 * spatial.gain, 1.3, 'sawtooth', 168);
    this.playNoiseHit(parent, 0.12 * spatial.gain, 1.2, 480, 0.5);
    window.setTimeout(() => {
      this.playTone(parent, 180, 0.06 * spatial.gain, 0.5, 'triangle');
      this.playTone(parent, 270, 0.04 * spatial.gain, 0.6, 'triangle');
    }, 950);
  }

  public playElectricSpark(position: { x: number; y: number; z: number }): void {
    const spatial = this.spatialGain(position);
    if (spatial.gain < 0.05) {
      return;
    }
    const parent = this.pannedParent(this.sfx, spatial.pan);
    this.playNoiseHit(parent, 0.16 * spatial.gain, 0.08, 5400, 1.1);
    this.playNoiseHit(parent, 0.1 * spatial.gain, 0.05, 2600, 2);
  }

  public playWaterDrip(position: { x: number; y: number; z: number }): void {
    const spatial = this.spatialGain(position);
    if (spatial.gain < 0.06) {
      return;
    }
    const parent = this.pannedParent(this.ambient, spatial.pan);
    this.playTone(parent, 1750 + Math.random() * 500, 0.05 * spatial.gain, 0.08, 'sine');
    this.playNoiseHit(parent, 0.035 * spatial.gain, 0.06, 2500, 3.5);
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

  private playTone(parent: AudioNode, frequency: number, gainValue: number, duration: number, type: OscillatorType, endFrequency?: number): void {
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
    if (endFrequency !== undefined && endFrequency > 0) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(parent);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  }

  private playNoiseHit(parent: AudioNode, gainValue: number, duration: number, frequency: number, q: number): void {
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
