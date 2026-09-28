import type { Box3, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import {
  DEFAULT_SETTINGS,
  LIGHTING_QUALITY_LEVELS,
  MAX_BRIGHTNESS,
  QUALITY_LEVELS,
  REFLECTION_QUALITY_LEVELS,
  SHADOW_QUALITY_LEVELS,
  type LightingQualityLevel,
  type QualityLevel,
  type ReflectionQualityLevel,
  type ShadowQualityLevel,
} from './config/constants';

export type ZoneId =
  | 'intake'
  | 'lobby'
  | 'security'
  | 'research'
  | 'maintenance'
  | 'underground'
  | 'core';

export type ItemType =
  | 'battery'
  | 'key'
  | 'keycard'
  | 'fuse'
  | 'tool'
  | 'medical'
  | 'document'
  | 'audio'
  | 'puzzle'
  | 'story';

export interface InventoryItemData {
  id: string;
  name: string;
  type: ItemType;
  description: string;
  quantity: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface Objective {
  id: string;
  title: string;
  completed: boolean;
  optional?: boolean;
}

export interface SubtitleEntry {
  speaker: string;
  text: string;
  duration: number;
  important?: boolean;
}

export interface Collider {
  id: string;
  box: Box3;
  enabled: boolean;
  tag: string;
}

export interface PatrolNode {
  id: string;
  position: Vector3;
  neighbors: string[];
  zone: ZoneId;
}

export interface ZoneDefinition {
  id: ZoneId;
  name: string;
  ambient: string;
  bounds: Box3;
  darkness: number;
}

export interface DoorSaveState {
  id: string;
  open: boolean;
  locked: boolean;
}

export interface ProgressState {
  introComplete: boolean;
  flashlightFound: boolean;
  intakeDoorUnlocked: boolean;
  researchPowerRestored: boolean;
  archiveCodeFound: boolean;
  undergroundUnlocked: boolean;
  coreKeyFound: boolean;
  coreEntered: boolean;
  endingChosen: boolean;
  endingMode: 'stabilize' | 'purge' | null;
  introSightedSuppressor: boolean;
  evidenceCollected: number;
}

export interface PuzzleState {
  breakers: Record<string, boolean>;
  fuseInserted: boolean;
  generatorRunning: boolean;
  archiveCode: string;
  archiveDoorUnlocked: boolean;
  researchTerminalUnlocked: boolean;
  coreSwitches: boolean[];
}

export interface PlayerSaveState {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  health: number;
  stamina: number;
  flashlightBattery: number;
  flashlightOn: boolean;
  inventory: InventoryItemData[];
}

export interface GraphicsSettings {
  quality: QualityLevel;
  resolutionScale: number;
  shadows: boolean;
  shadowQuality: ShadowQualityLevel;
  lightingQuality: LightingQualityLevel;
  reflectionQuality: ReflectionQualityLevel;
  postProcessing: boolean;
  bloom: boolean;
  ambientOcclusion: boolean;
  volumetrics: boolean;
  viewDistance: number;
  effects: boolean;
  fog: boolean;
  fogDensity: number;
  antialias: boolean;
  brightness: number;
}

export interface GameSettings {
  graphics: GraphicsSettings;
  audio: {
    master: number;
    music: number;
    sfx: number;
    ambient: number;
    voice: number;
    ui: number;
  };
  controls: {
    sensitivity: number;
    invertY: boolean;
    toggleSprint: boolean;
    toggleCrouch: boolean;
    bindings: Record<string, string>;
  };
  accessibility: {
    subtitles: boolean;
    subtitleSize: number;
    screenShake: boolean;
    flashEffects: boolean;
    fov: number;
  };
}

export interface InteractableSaveState {
  id: string;
  active: boolean;
}

export interface SaveData {
  slot: number;
  label: string;
  timestamp: number;
  player: PlayerSaveState;
  doors: DoorSaveState[];
  interactables: InteractableSaveState[];
  progress: ProgressState;
  puzzles: PuzzleState;
  objectives: Objective[];
}

export interface DebugInfo {
  fps: number;
  drawCalls: number;
  triangles: number;
  position: string;
  zone: string;
  objective: string;
  enemyState: string;
  assets: string;
}

export interface SecurityCameraDefinition {
  id: string;
  name: string;
  camera: PerspectiveCamera;
  hint: string;
  anomaly?: string;
}

export interface TerminalFile {
  title: string;
  body: string;
}

export interface TerminalDefinition {
  id: string;
  name: string;
  username?: string;
  password?: string;
  files: TerminalFile[];
  cameras: string[];
  actions: { id: string; label: string; description: string }[];
}

export interface HideSpotView {
  id: string;
  anchor: Group;
  cameraOffset: Vector3;
  exitOffset: Vector3;
}

export interface HighlightHandle {
  meshes: Mesh[];
}

export function cloneDefaultSettings(): GameSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as GameSettings;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Fills in settings added in later versions and upgrades legacy saves so old
 * player configurations keep working (e.g. the old `shadows` boolean).
 */
export function migrateSettings(raw: unknown): GameSettings {
  const base = cloneDefaultSettings();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const incoming = raw as Partial<GameSettings>;
  const incomingGraphics = (incoming.graphics ?? {}) as Partial<GraphicsSettings>;

  const graphics: GraphicsSettings = {
    ...base.graphics,
    ...incomingGraphics,
    quality: pickEnum(incomingGraphics.quality, QUALITY_LEVELS, base.graphics.quality),
    shadowQuality: incomingGraphics.shadowQuality
      ? pickEnum(incomingGraphics.shadowQuality, SHADOW_QUALITY_LEVELS, base.graphics.shadowQuality)
      : incomingGraphics.shadows === false
        ? 'off'
        : 'high',
    lightingQuality: pickEnum(incomingGraphics.lightingQuality, LIGHTING_QUALITY_LEVELS, base.graphics.lightingQuality),
    reflectionQuality: pickEnum(incomingGraphics.reflectionQuality, REFLECTION_QUALITY_LEVELS, base.graphics.reflectionQuality),
    resolutionScale: clampNumber(incomingGraphics.resolutionScale, base.graphics.resolutionScale, 0.5, 1.5),
    viewDistance: clampNumber(incomingGraphics.viewDistance, base.graphics.viewDistance, 0.5, 2),
    fogDensity: clampNumber(incomingGraphics.fogDensity, base.graphics.fogDensity, 0, 1.5),
    brightness: clampNumber(incomingGraphics.brightness, base.graphics.brightness, 0.5, MAX_BRIGHTNESS),
  };
  graphics.shadows = graphics.shadowQuality !== 'off';

  return {
    graphics,
    audio: { ...base.audio, ...(incoming.audio ?? {}) },
    controls: {
      ...base.controls,
      ...(incoming.controls ?? {}),
      bindings: { ...base.controls.bindings, ...(incoming.controls?.bindings ?? {}) },
    },
    accessibility: { ...base.accessibility, ...(incoming.accessibility ?? {}) },
  };
}
