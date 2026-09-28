import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

const cache = new Map<string, CanvasTexture>();

function cached(key: string, factory: () => CanvasTexture): CanvasTexture {
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const texture = factory();
  cache.set(key, texture);
  return texture;
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext('2d') };
}

/** Vertical gradient used for volumetric light cones (opaque at top, faded at bottom). */
export function lightConeGradientTexture(): CanvasTexture {
  return cached('cone-gradient', () => {
    const { canvas, context } = makeCanvas(4, 128);
    if (context) {
      const gradient = context.createLinearGradient(0, canvas.height, 0, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  });
}

/** Soft round sprite for dust, steam and spark particles. */
export function softCircleTexture(): CanvasTexture {
  return cached('soft-circle', () => {
    const { canvas, context } = makeCanvas(64, 64);
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.4, 'rgba(255,255,255,0.55)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  });
}

/** Dirt / damage decal with alpha, used on walls and floors. */
export function grungeDecalTexture(seed = 1): CanvasTexture {
  return cached(`grunge-${seed}`, () => {
    const { canvas, context } = makeCanvas(128, 128);
    if (context) {
      context.clearRect(0, 0, 128, 128);
      for (let index = 0; index < 90; index += 1) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const radius = 3 + Math.random() * 16;
        const tone = 20 + Math.floor(Math.random() * 26);
        const alpha = 0.06 + Math.random() * 0.16;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${tone},${tone + 4},${tone + 8},${alpha})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      }
      // Rust streaks
      for (let index = 0; index < 8; index += 1) {
        const x = 8 + Math.random() * 112;
        const width = 2 + Math.random() * 5;
        const gradient = context.createLinearGradient(x, 0, x, 128);
        gradient.addColorStop(0, 'rgba(112,58,26,0.24)');
        gradient.addColorStop(1, 'rgba(80,40,18,0)');
        context.fillStyle = gradient;
        context.fillRect(x, 0, width, 128);
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  });
}

export type SignKind = 'caution' | 'highVoltage' | 'suppression' | 'exit' | 'radiation';

/** Small warning / information placard textures. */
export function signTexture(kind: SignKind): CanvasTexture {
  return cached(`sign-${kind}`, () => {
    const { canvas, context } = makeCanvas(256, 160);
    if (context) {
      const palettes: Record<SignKind, { bg: string; fg: string; accent: string; lines: string[] }> = {
        caution: { bg: '#c9a227', fg: '#141414', accent: '#141414', lines: ['CAUTION', 'AUTHORIZED STAFF ONLY'] },
        highVoltage: { bg: '#d4b12c', fg: '#111111', accent: '#111111', lines: ['HIGH VOLTAGE', 'DO NOT OPERATE'] },
        suppression: { bg: '#1d2733', fg: '#d8e6f5', accent: '#5fb9ff', lines: ['SUPPRESSION ZONE', 'CONTAINMENT ACTIVE'] },
        exit: { bg: '#14431f', fg: '#d9ffe4', accent: '#7dff9c', lines: ['EMERGENCY EXIT', 'OUTBOUND ROUTE'] },
        radiation: { bg: '#c8a52b', fg: '#151515', accent: '#151515', lines: ['RADIATION', 'MONITOR DOSE RATE'] },
      };
      const palette = palettes[kind];
      context.fillStyle = palette.bg;
      context.fillRect(0, 0, 256, 160);
      // Hazard stripes top and bottom
      context.fillStyle = palette.accent;
      for (let x = -16; x < 272; x += 24) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + 12, 0);
        context.lineTo(x + 28, 16);
        context.lineTo(x + 16, 16);
        context.closePath();
        context.fill();
        context.beginPath();
        context.moveTo(x, 160);
        context.lineTo(x + 12, 160);
        context.lineTo(x + 28, 144);
        context.lineTo(x + 16, 144);
        context.closePath();
        context.fill();
      }
      context.fillStyle = palette.fg;
      context.textAlign = 'center';
      context.font = 'bold 30px Arial';
      context.fillText(palette.lines[0], 128, 78);
      context.font = '15px Arial';
      context.fillText(palette.lines[1], 128, 108);
      // Grime
      context.fillStyle = 'rgba(10,12,14,0.18)';
      for (let index = 0; index < 26; index += 1) {
        context.fillRect(Math.random() * 256, Math.random() * 160, 2 + Math.random() * 10, 1 + Math.random() * 4);
      }
      context.strokeStyle = 'rgba(0,0,0,0.5)';
      context.lineWidth = 6;
      context.strokeRect(0, 0, 256, 160);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  });
}

/** Grunge / rust patch used as a bump map on metal surfaces. */
export function metalBumpTexture(): CanvasTexture {
  return cached('metal-bump', () => {
    const { canvas, context } = makeCanvas(128, 128);
    if (context) {
      context.fillStyle = '#808080';
      context.fillRect(0, 0, 128, 128);
      for (let index = 0; index < 420; index += 1) {
        const tone = 90 + Math.floor(Math.random() * 76);
        context.fillStyle = `rgba(${tone},${tone},${tone},0.35)`;
        context.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
      for (let index = 0; index < 14; index += 1) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const radius = 6 + Math.random() * 18;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(150,150,150,0.5)');
        gradient.addColorStop(1, 'rgba(110,110,110,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  });
}

/** Panel texture for electrical cabinets: breakers, labels, grime. */
export function panelTexture(): CanvasTexture {
  return cached('panel', () => {
    const { canvas, context } = makeCanvas(128, 192);
    if (context) {
      context.fillStyle = '#4a525b';
      context.fillRect(0, 0, 128, 192);
      context.fillStyle = '#333a42';
      context.fillRect(8, 8, 112, 176);
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const x = 18 + col * 34;
          const y = 20 + row * 32;
          context.fillStyle = Math.random() > 0.82 ? '#7a2f2f' : '#20262d';
          context.fillRect(x, y, 24, 22);
          context.fillStyle = 'rgba(220,230,240,0.35)';
          context.fillRect(x + 3, y + 3, 18, 4);
        }
      }
      context.fillStyle = 'rgba(196,165,79,0.85)';
      context.fillRect(16, 178, 96, 6);
      for (let index = 0; index < 30; index += 1) {
        context.fillStyle = `rgba(15,18,20,${0.05 + Math.random() * 0.15})`;
        context.fillRect(Math.random() * 128, Math.random() * 192, 3 + Math.random() * 9, 2 + Math.random() * 5);
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  });
}

/** Rusty perforated metal for vents and grilles. */
export function ventTexture(): CanvasTexture {
  return cached('vent', () => {
    const { canvas, context } = makeCanvas(64, 64);
    if (context) {
      context.fillStyle = '#565e66';
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = '#171b1f';
      for (let y = 4; y < 64; y += 8) {
        context.fillRect(4, y, 56, 4);
      }
      for (let index = 0; index < 12; index += 1) {
        context.fillStyle = `rgba(109,65,35,${0.12 + Math.random() * 0.3})`;
        context.beginPath();
        context.arc(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 6, 0, Math.PI * 2);
        context.fill();
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  });
}
