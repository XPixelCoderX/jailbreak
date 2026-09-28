export const GAME_TITLE = 'LOST SUPPRESSION';

export const LINKS = {
  website: 'https://pay.pcsmp.net',
  discord: 'https://discord.gg/jqPt6a563h',
} as const;

export const SAVE_SLOTS = 3;
export const DEFAULT_SAVE_SLOT = 1;
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.74;
export const PLAYER_CROUCH_HEIGHT = 1.15;
export const FLASHLIGHT_DRAIN_PER_SECOND = 1.5;
export const FLASHLIGHT_RECHARGE_FROM_BATTERY = 35;
export const LOW_BATTERY_THRESHOLD = 18;
export const MAX_FLASHLIGHT = 100;
export const MAX_HEALTH = 100;
export const MAX_STAMINA = 100;
export const INTERACT_DISTANCE = 3.2;
export const DEFAULT_FOV = 75;
export const DEFAULT_SENSITIVITY = 0.0022;
export const START_ZONE = 'intake';
export const ENEMY_DETECTION_RADIUS = 11;
export const ENEMY_HEARING_RADIUS = 18;
export const CHASE_MUSIC_RADIUS = 16;
export const FOOTSTEP_INTERVAL_WALK = 1.85;
export const FOOTSTEP_INTERVAL_RUN = 1.25;
export const FOOTSTEP_INTERVAL_CROUCH = 2.9;
export const AUTO_SAVE_KEY = 'lost-suppression-autosave';

export const DEFAULT_BINDINGS: Record<string, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  interact: 'KeyE',
  flashlight: 'KeyF',
  inventory: 'Tab',
  pause: 'Escape',
  debug: 'F3',
  enemyDebug: 'F4',
  teleportDebug: 'F5',
};

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra' | 'extreme' | 'rtx';
export type ShadowQualityLevel = 'off' | 'low' | 'medium' | 'high';
export type LightingQualityLevel = 'low' | 'medium' | 'high';
export type ReflectionQualityLevel = 'off' | 'low' | 'medium' | 'high';

export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra', 'extreme', 'rtx'];
export const SHADOW_QUALITY_LEVELS: ShadowQualityLevel[] = ['off', 'low', 'medium', 'high'];
export const LIGHTING_QUALITY_LEVELS: LightingQualityLevel[] = ['low', 'medium', 'high'];
export const REFLECTION_QUALITY_LEVELS: ReflectionQualityLevel[] = ['off', 'low', 'medium', 'high'];

export const BASE_FOG_DENSITY = 0.016;
export const MAX_BRIGHTNESS = 1.6;

export const DEFAULT_SETTINGS = {
  graphics: {
    quality: 'high' as QualityLevel,
    resolutionScale: 1,
    shadows: true,
    shadowQuality: 'high' as ShadowQualityLevel,
    lightingQuality: 'high' as LightingQualityLevel,
    reflectionQuality: 'low' as ReflectionQualityLevel,
    postProcessing: true,
    bloom: true,
    ambientOcclusion: false,
    volumetrics: true,
    viewDistance: 1,
    effects: true,
    fog: true,
    fogDensity: 1,
    antialias: true,
    brightness: 1.12,
  },
  audio: {
    master: 0.9,
    music: 0.65,
    sfx: 0.85,
    ambient: 0.8,
    voice: 0.8,
    ui: 0.85,
  },
  controls: {
    sensitivity: DEFAULT_SENSITIVITY,
    invertY: false,
    toggleSprint: false,
    toggleCrouch: false,
    bindings: DEFAULT_BINDINGS,
  },
  accessibility: {
    subtitles: true,
    subtitleSize: 1,
    screenShake: true,
    flashEffects: true,
    fov: DEFAULT_FOV,
    hints: true,
    coordinates: false,
  },
} as const;

export const SURFACE_COLORS = {
  concrete: 0x1c1f25,
  metal: 0x2c3239,
  rust: 0x6d4123,
  emergency: 0x6f1313,
  monitor: 0x5fb9ff,
  warning: 0xc4a54f,
};

export const OBJECTIVE_TEXT = {
  wake: 'Regain orientation and search the intake chamber.',
  flashlight: 'Find a working flashlight.',
  leaveIntake: 'Exit the intake chamber when the lockdown lifts.',
  restoreResearchPower: 'Restore power to the Research Wing from Maintenance.',
  accessResearch: 'Use the Research Wing terminal to learn what happened.',
  reachLevel2: 'Use the Level 2 card to enter the Observation Deck.',
  recoverFootage: 'Recover the chamber footage from the Observation Deck.',
  unlockUnderground: 'Find the archive access code and enter the Underground.',
  findCoreKey: 'Search the Underground for the Suppression Core keycard.',
  reachCore: 'Reach the Suppression Core and restore the containment lattice.',
  enterLevel3: 'Descend to Level 3 and inspect the containment storage.',
  escape: 'Choose the fate of the core and escape the facility.',
} as const;
