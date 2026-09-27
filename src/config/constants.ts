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

export const DEFAULT_SETTINGS = {
  graphics: {
    quality: 'high',
    resolutionScale: 1,
    shadows: true,
    viewDistance: 1,
    effects: true,
    fog: true,
    antialias: true,
    brightness: 1,
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
  unlockUnderground: 'Find the archive access code and enter the Underground.',
  findCoreKey: 'Search the Underground for the Suppression Core keycard.',
  reachCore: 'Reach the Suppression Core and restore the containment lattice.',
  escape: 'Choose the fate of the core and escape the facility.',
} as const;
