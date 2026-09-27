import type { Box3, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { DEFAULT_SETTINGS } from './config/constants';

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

export interface GameSettings {
  graphics: {
    quality: string;
    resolutionScale: number;
    shadows: boolean;
    viewDistance: number;
    effects: boolean;
    fog: boolean;
    antialias: boolean;
    brightness: number;
  };
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
