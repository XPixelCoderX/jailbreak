import type { GameSettings, GraphicsSettings } from '../types';
import type { QualityLevel } from '../config/constants';

/**
 * Six quality tiers. Each tier seeds the granular graphics options so players
 * get a coherent preset, while still being able to fine-tune every value.
 *
 * The `rtx` tier enables our ray-traced *style* approximations: screen-space
 * reflections, image-based lighting, ground-truth ambient occlusion, planar
 * reflections on wet surfaces and volumetric light shafts. True hardware ray
 * tracing is not available in WebGL, so nothing here claims otherwise.
 */
export interface QualityPreset {
  level: QualityLevel;
  label: string;
  description: string;
  shadowQuality: GraphicsSettings['shadowQuality'];
  lightingQuality: GraphicsSettings['lightingQuality'];
  reflectionQuality: GraphicsSettings['reflectionQuality'];
  postProcessing: boolean;
  bloom: boolean;
  ambientOcclusion: boolean;
  volumetrics: boolean;
  particleDensity: number;
  environmentIntensity: number;
  msaa: number;
  suggestedResolutionScale: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    label: 'LOW',
    description: 'Fastest. Reduced lighting, no post-processing.',
    shadowQuality: 'off',
    lightingQuality: 'low',
    reflectionQuality: 'off',
    postProcessing: false,
    bloom: false,
    ambientOcclusion: false,
    volumetrics: false,
    particleDensity: 0.5,
    environmentIntensity: 0.35,
    msaa: 0,
    suggestedResolutionScale: 0.75,
  },
  medium: {
    level: 'medium',
    label: 'MEDIUM',
    description: 'Balanced lighting with subtle cinematic grading.',
    shadowQuality: 'low',
    lightingQuality: 'medium',
    reflectionQuality: 'low',
    postProcessing: true,
    bloom: false,
    ambientOcclusion: false,
    volumetrics: true,
    particleDensity: 0.7,
    environmentIntensity: 0.5,
    msaa: 0,
    suggestedResolutionScale: 0.9,
  },
  high: {
    level: 'high',
    label: 'HIGH',
    description: 'Full lighting, bloom, soft shadows and light shafts.',
    shadowQuality: 'medium',
    lightingQuality: 'high',
    reflectionQuality: 'low',
    postProcessing: true,
    bloom: true,
    ambientOcclusion: false,
    volumetrics: true,
    particleDensity: 0.9,
    environmentIntensity: 0.62,
    msaa: 4,
    suggestedResolutionScale: 1,
  },
  ultra: {
    level: 'ultra',
    label: 'ULTRA',
    description: 'Ambient occlusion, planar reflections on wet floors.',
    shadowQuality: 'high',
    lightingQuality: 'high',
    reflectionQuality: 'medium',
    postProcessing: true,
    bloom: true,
    ambientOcclusion: true,
    volumetrics: true,
    particleDensity: 1.1,
    environmentIntensity: 0.7,
    msaa: 4,
    suggestedResolutionScale: 1,
  },
  extreme: {
    level: 'extreme',
    label: 'EXTREME',
    description: 'Maximum shadow detail and denser atmosphere.',
    shadowQuality: 'high',
    lightingQuality: 'high',
    reflectionQuality: 'medium',
    postProcessing: true,
    bloom: true,
    ambientOcclusion: true,
    volumetrics: true,
    particleDensity: 1.3,
    environmentIntensity: 0.76,
    msaa: 4,
    suggestedResolutionScale: 1,
  },
  rtx: {
    level: 'rtx',
    label: 'RTX',
    description: 'Ray-traced style: SSR, GTAO, IBL and volumetrics at full strength.',
    shadowQuality: 'high',
    lightingQuality: 'high',
    reflectionQuality: 'high',
    postProcessing: true,
    bloom: true,
    ambientOcclusion: true,
    volumetrics: true,
    particleDensity: 1.5,
    environmentIntensity: 0.82,
    msaa: 4,
    suggestedResolutionScale: 1,
  },
};

export function getPreset(level: QualityLevel): QualityPreset {
  return QUALITY_PRESETS[level] ?? QUALITY_PRESETS.high;
}

/** Shadow map resolution for a shadow quality tier. */
export function shadowMapSizeFor(quality: GraphicsSettings['shadowQuality']): number {
  switch (quality) {
    case 'low':
      return 512;
    case 'medium':
      return 1024;
    case 'high':
      return 2048;
    default:
      return 0;
  }
}

/** How many dynamic ceiling lights may cast shadows for a lighting tier. */
export function shadowLightBudget(lighting: GraphicsSettings['lightingQuality']): number {
  // Each shadow-casting point light re-renders the scene six times, so the
  // budget stays small — the flashlight carries most of the dynamic shadow
  // work and these fixtures add pools of shaped light on top of it.
  switch (lighting) {
    case 'low':
      return 0;
    case 'medium':
      return 1;
    default:
      return 3;
  }
}

/** How many volumetric shafts to display for a lighting tier (scale of total). */
export function shaftBudget(lighting: GraphicsSettings['lightingQuality'], volumetrics: boolean): number {
  if (!volumetrics) {
    return 0;
  }
  switch (lighting) {
    case 'low':
      return 6;
    case 'medium':
      return 14;
    default:
      return 64;
  }
}

export function presetForSettings(settings: GameSettings): QualityPreset {
  return getPreset(settings.graphics.quality);
}
