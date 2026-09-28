import {
  ACESFilmicToneMapping,
  Color,
  PCFShadowMap,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PostFX } from '../render/PostFX';
import { AudioManager, type MusicState } from '../audio/AudioManager';
import {
  CHASE_MUSIC_RADIUS,
  DEFAULT_SAVE_SLOT,
  GAME_TITLE,
  INTERACT_DISTANCE,
  LOW_BATTERY_THRESHOLD,
  OBJECTIVE_TEXT,
} from '../config/constants';
import { InputManager } from '../core/InputManager';
import { SaveManager } from '../core/SaveManager';

import { Suppressor } from '../enemies/Suppressor';
import { GameLoop } from './GameLoop';
import { GameState } from './GameState';
import type { Interactable } from '../interaction/Interactable';
import { Player } from '../player/Player';
import { EventSystem } from '../systems/EventSystem';
import type {
  DebugInfo,
  GameSettings,
  HideSpotView,
  Objective,
  ProgressState,
  PuzzleState,
  SaveData,
  SecurityCameraDefinition,
  TerminalDefinition,
} from '../types';
import { cloneDefaultSettings } from '../types';
import { UIManager } from '../ui/UIManager';
import { Facility } from '../world/Facility';

interface PendingKeypad {
  id: string;
}

export class Game {
  public readonly saveManager = new SaveManager();
  public readonly audio: AudioManager;
  public readonly input: InputManager;
  public readonly ui: UIManager;

  public state = GameState.LOADING;
  public scene = new Scene();
  public renderer: WebGLRenderer;
  public terminalRenderer: WebGLRenderer;
  public facility!: Facility;
  public player!: Player;
  public suppressor!: Suppressor;
  public progress!: ProgressState;
  public puzzles!: PuzzleState;
  public objectives: Objective[] = [];

  private readonly loop: GameLoop;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly eventSystem = new EventSystem();
  private readonly menuCamera = new PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 120);
  private readonly tempVecA = new Vector3();
  private readonly tempVecB = new Vector3();
  private readonly tempRight = new Vector3();
  private readonly tempQuat = new Quaternion();
  private postfx: PostFX | null = null;
  private environmentTexture: Texture | null = null;
  private readonly root: HTMLElement;
  private settings: GameSettings;
  private previousState: GameState = GameState.MAIN_MENU;
  private overlayKind: 'inventory' | 'objectives' | 'document' | 'terminal' | 'keypad' | 'settings' | 'save-load' | null = null;
  private currentObjectiveId = 'wake';
  private currentSaveSlot = DEFAULT_SAVE_SLOT;
  private openingTime = 0;
  private openingStage = 0;
  private showDebug = false;
  private showEnemyDebug = false;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private fpsValue = 0;
  private terminalSession: TerminalDefinition | null = null;
  private unlockedTerminals = new Set<string>();
  private pendingKeypad: PendingKeypad | null = null;
  private lastAutosaveLabel = 'Initial checkpoint';

  constructor(container: HTMLElement) {
    this.root = container;
    this.settings = this.saveManager.loadSettings() ?? cloneDefaultSettings();

    this.renderer = this.createRenderer();
    this.terminalRenderer = new WebGLRenderer({
      canvas: document.createElement('canvas'),
      antialias: false,
      alpha: true,
    });
    this.terminalRenderer.setSize(480, 270, false);
    this.terminalRenderer.outputColorSpace = this.renderer.outputColorSpace;

    this.input = new InputManager(this.renderer.domElement, this.settings);
    this.ui = new UIManager(container, this.input, this.settings);
    this.audio = new AudioManager(this.settings);
    this.loop = new GameLoop((dt) => this.update(dt));

    this.ui.gameViewport.appendChild(this.renderer.domElement);
    this.terminalRenderer.dispose();
    this.terminalRenderer = new WebGLRenderer({
      canvas: this.ui.terminalCameraCanvas,
      antialias: false,
      alpha: true,
    });
    this.terminalRenderer.setSize(480, 270, false);
    this.terminalRenderer.outputColorSpace = this.renderer.outputColorSpace;

    this.bindUI();
    this.bindDOM();
    this.initialize().catch((error) => this.handleFatalError(error));
  }

  public async initialize(): Promise<void> {
    this.state = GameState.LOADING;
    const stages: Array<[number, string, () => void]> = [
      [0.12, 'Establishing viewport...', () => this.configureRenderer()],
      [0.34, 'Generating facility geometry...', () => this.buildWorld()],
      [0.58, 'Routing containment systems...', () => this.resetGameState()],
      [0.78, 'Priming audio and UI...', () => this.applySettings(this.settings)],
      [1, 'Containment initialized.', () => this.enterMainMenu()],
    ];

    for (const [progress, label, action] of stages) {
      action();
      this.ui.setLoading(progress, label, 'WARNING: SUPPRESSION FAILURE DETECTED');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    }

    this.loop.start();
  }

  public openDocument(title: string, body: string): void {
    this.previousState = this.state;
    this.state = GameState.CUTSCENE;
    this.overlayKind = 'document';
    this.input.exitPointerLock();
    this.ui.openDocument(title, body);
  }

  public openTerminal(terminalId: string): void {
    const terminal = this.facility.terminals.get(terminalId);
    if (!terminal) {
      return;
    }
    if (terminalId === 'research-terminal' && !this.progress.researchPowerRestored) {
      this.ui.flashNotice('The terminal is dark. Research power is still down.');
      this.audio.playUiError();
      return;
    }
    if (terminalId === 'core-terminal' && !this.progress.coreEntered) {
      this.ui.flashNotice('Core permissions unavailable before entering the chamber.');
      return;
    }

    this.previousState = this.state;
    this.state = GameState.CUTSCENE;
    this.overlayKind = 'terminal';
    this.terminalSession = terminal;
    this.input.exitPointerLock();
    const cameraDefs = terminal.cameras
      .map((id) => this.facility.cameras.get(id))
      .filter((entry): entry is SecurityCameraDefinition => Boolean(entry));
    this.ui.openTerminal(terminal, this.unlockedTerminals.has(terminal.id) || !terminal.username, cameraDefs);
    this.audio.playUiOpen();
  }

  public openKeypad(id: string): void {
    this.previousState = this.state;
    this.state = GameState.CUTSCENE;
    this.overlayKind = 'keypad';
    this.pendingKeypad = { id };
    this.input.exitPointerLock();
    this.ui.openKeypad('Archive Blast Door');
  }

  public activateBreaker(id: string, label: string): void {
    this.puzzles.breakers[id] = true;
    this.queueSubtitle('POWER GRID', `${label} routed to backup lattice.`, 3.2);
    this.audio.playUiBeep();
    this.notifyNoise(this.player.position, 0.5);
    this.checkPowerProgress();
  }

  public insertMainFuse(): void {
    this.puzzles.fuseInserted = true;
    this.audio.playDoor(true, true);
    this.queueSubtitle('POWER GRID', 'Fuse seated. Grid connection stable.', 3.1);
    this.checkPowerProgress();
  }

  public activateCoreSwitch(index: number): void {
    if (!this.progress.coreEntered) {
      this.progress.coreEntered = true;
    }
    if (this.puzzles.coreSwitches[index]) {
      this.ui.flashNotice('That lattice arm is already active.');
      return;
    }
    this.puzzles.coreSwitches[index] = true;
    this.audio.playUiBeep();
    this.notifyNoise(this.player.position, 0.65);
    if (this.puzzles.coreSwitches.every(Boolean)) {
      this.queueSubtitle('CORE', 'Lattice restored. Final control unlocked.', 4.2);
      this.ui.flashNotice('All three lattice switches are online. Use the core terminal.');
      this.lastAutosaveLabel = 'Suppression Core';
      this.saveGame(this.currentSaveSlot, true);
    }
  }

  public notifyNoise(position: Vector3, loudness: number): void {
    if (this.suppressor.active) {
      this.suppressor.hear(position, loudness);
    }
  }

  public enterHideSpot(view: HideSpotView): void {
    this.player.hiddenSpot = view;
    this.ui.flashNotice('You slip into the dark and hold your breath.');
  }

  public exitHideSpot(): void {
    if (!this.player.hiddenSpot) {
      return;
    }
    const exit = this.player.hiddenSpot.anchor.position.clone().add(this.player.hiddenSpot.exitOffset);
    this.player.hiddenSpot = null;
    this.player.position.copy(exit);
    this.ui.flashNotice('You ease back into the hall.');
  }

  public queueSubtitle(speaker: string, text: string, duration: number): void {
    if (!this.settings.accessibility.subtitles) {
      return;
    }
    this.ui.pushSubtitle(speaker, text, duration);
  }

  public setObjective(id: keyof typeof OBJECTIVE_TEXT): void {
    const nextText = OBJECTIVE_TEXT[id];
    const current = this.objectives.find((objective) => objective.id === this.currentObjectiveId);
    if (current && current.id !== id) {
      current.completed = true;
    }
    this.currentObjectiveId = id;
    const next = this.objectives.find((objective) => objective.id === id);
    if (next) {
      next.completed = false;
    }
    this.ui.flashNotice(`Objective updated: ${nextText}`);
  }

  public startNewGame(): void {
    void this.audio.ensureStarted();
    this.buildWorld();
    this.resetGameState();
    this.state = GameState.CUTSCENE;
    this.overlayKind = null;
    this.openingTime = 0;
    this.openingStage = 0;
    this.ui.showMainMenu(false);
    this.ui.showHUD(true);
    this.ui.showPause(false);
    this.ui.flashNotice('You wake to the sound of distant machinery.');
    this.lastAutosaveLabel = 'Intake Chamber';
    this.currentSaveSlot = DEFAULT_SAVE_SLOT;
  }

  public continueGame(): void {
    const latest = this.saveManager.getLatestSave();
    if (!latest) {
      this.ui.flashNotice('No save data found. Starting a new game.');
      this.startNewGame();
      return;
    }
    this.loadSave(latest);
  }

  public loadSlot(slot: number): void {
    const data = this.saveManager.load(slot);
    if (!data) {
      this.ui.flashNotice('That save slot is empty.');
      return;
    }
    this.loadSave(data);
  }

  public saveGame(slot: number, silent = false): void {
    const data = this.createSaveData(slot);
    this.saveManager.save(slot, data);
    this.currentSaveSlot = slot;
    if (!silent) {
      this.ui.flashNotice(`Game saved to slot ${slot}.`);
      this.audio.playUiBeep();
    }
  }

  private loadSave(data: SaveData): void {
    void this.audio.ensureStarted();
    this.buildWorld();
    this.player.deserialize(data.player);
    this.progress = JSON.parse(JSON.stringify(data.progress)) as ProgressState;
    this.puzzles = JSON.parse(JSON.stringify(data.puzzles)) as PuzzleState;
    this.objectives = data.objectives.map((objective) => ({ ...objective }));
    this.currentObjectiveId = this.objectives.find((objective) => !objective.completed)?.id ?? 'wake';
    if (this.puzzles.researchTerminalUnlocked) {
      this.unlockedTerminals.add('research-terminal');
    }
    this.facility.restoreDoors(data.doors);
    this.restoreInteractables(data);
    this.facility.applyProgress(this.progress, this.puzzles);
    this.currentSaveSlot = data.slot;
    this.lastAutosaveLabel = data.label;
    this.state = GameState.PLAYING;
    this.overlayKind = null;
    this.ui.showLoading(false);
    this.ui.showMainMenu(false);
    this.ui.showPause(false);
    this.ui.showHUD(true);
    this.ui.showInventory([], false);
    this.ui.showObjectives([], false);
    this.ui.showCredits(false);
    this.ui.showSettings(false);
    this.ui.showSaveLoad([], 'load', false);
    this.input.requestPointerLock();
  }

  private createSaveData(slot: number): SaveData {
    return {
      slot,
      label: this.lastAutosaveLabel,
      timestamp: Date.now(),
      player: this.player.serialize(),
      doors: this.facility.serializeDoors(),
      interactables: this.facility.interactables.map((interactable) => ({ id: interactable.id, active: interactable.active })),
      progress: JSON.parse(JSON.stringify(this.progress)) as ProgressState,
      puzzles: JSON.parse(JSON.stringify(this.puzzles)) as PuzzleState,
      objectives: this.objectives.map((objective) => ({ ...objective })),
    };
  }

  private restoreInteractables(data: SaveData): void {
    const saved = new Map(data.interactables.map((entry) => [entry.id, entry.active]));
    for (const interactable of this.facility.interactables) {
      if (!saved.has(interactable.id)) {
        continue;
      }
      interactable.active = saved.get(interactable.id) ?? true;
      interactable.object.visible = interactable.active;
    }
  }

  private configureRenderer(): void {
    this.renderer.outputColorSpace = this.terminalRenderer.outputColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(new Color(0x0a1018), 1);
    this.renderer.domElement.tabIndex = 0;

    // Image-based lighting probe: gives metals, glass and wet surfaces
    // convincing reflections and a soft "global illumination" feel.
    try {
      const pmrem = new PMREMGenerator(this.renderer);
      this.environmentTexture?.dispose();
      this.environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch (error) {
      console.warn('Environment probe unavailable, falling back to ambient lighting.', error);
    }

    this.postfx = new PostFX(this.renderer, this.scene, this.menuCamera);
    this.onResize();
  }

  private createRenderer(): WebGLRenderer {
    try {
      const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setSize(window.innerWidth, window.innerHeight);
      return renderer;
    } catch (error) {
      throw new Error(`WebGL unavailable. ${String(error)}`);
    }
  }

  private bindUI(): void {
    this.ui.onNewGame = () => this.startNewGame();
    this.ui.onContinue = () => this.continueGame();
    this.ui.onOpenLoad = () => this.openSaveLoad('load');
    this.ui.onOpenSettingsFromMenu = () => this.openSettings(GameState.MAIN_MENU);
    this.ui.onOpenCredits = () => this.ui.showCredits(true);
    this.ui.onQuit = () => {
      window.close();
      this.ui.flashNotice('This browser tab can be closed manually.');
    };
    this.ui.onResume = () => this.resumeGame();
    this.ui.onOpenInventory = () => this.toggleInventory(true);
    this.ui.onOpenObjectives = () => this.toggleObjectives(true);
    this.ui.onOpenSettingsFromPause = () => this.openSettings(GameState.PAUSED);
    this.ui.onSaveGame = () => this.openSaveLoad('save');
    this.ui.onReturnToMenu = () => this.enterMainMenu();
    this.ui.onRetry = () => this.retryFromCheckpoint();
    this.ui.onLoadCheckpoint = () => this.retryFromCheckpoint();
    this.ui.onDeathMenu = () => this.enterMainMenu();
    this.ui.onApplySettings = (settings) => this.applySettings(settings);
    this.ui.onCloseSettings = () => this.closeTransientOverlay();
    this.ui.onLoadSlot = (slot) => this.loadSlot(slot);
    this.ui.onCloseSaveLoad = () => this.closeTransientOverlay();
    this.ui.onSaveSlot = (slot) => {
      this.saveGame(slot);
      this.closeTransientOverlay();
    };
    this.ui.onCloseDocument = () => this.closeTransientOverlay();
    this.ui.onCloseTerminal = () => this.closeTransientOverlay();
    this.ui.onCloseKeypad = () => this.closeTransientOverlay();
    this.ui.onDismissEnding = () => this.enterMainMenu();
    this.ui.onTerminalAction = (actionId) => this.handleTerminalAction(actionId);
    this.ui.onTerminalLogin = (username, password) => this.handleTerminalLogin(username, password);
    this.ui.onKeypadSubmit = (value) => this.handleKeypadSubmit(value);
  }

  private bindDOM(): void {
    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === GameState.PLAYING) {
        void this.audio.ensureStarted();
        this.input.requestPointerLock();
      }
    });
  }

  private buildWorld(): void {
    this.scene = new Scene();
    this.scene.background = new Color(0x0a1018);
    this.scene.environment = this.environmentTexture;
    this.facility = new Facility(this.scene, this.audio);
    this.player = new Player();
    this.suppressor = new Suppressor();
    this.suppressor.reset(this.facility);
    this.scene.add(this.player.body, this.suppressor.root);
    this.menuCamera.position.set(17, 1.8, 8);
    this.menuCamera.lookAt(22, 1.5, 0);
    this.postfx?.setScene(this.scene);
    this.applySettings(this.settings);
  }

  private resetGameState(): void {
    this.player.reset();
    this.player.inventory.clear();
    this.progress = {
      introComplete: false,
      flashlightFound: false,
      intakeDoorUnlocked: false,
      researchPowerRestored: false,
      archiveCodeFound: false,
      undergroundUnlocked: false,
      coreKeyFound: false,
      coreEntered: false,
      endingChosen: false,
      endingMode: null,
      introSightedSuppressor: false,
      evidenceCollected: 0,
    };
    this.puzzles = {
      breakers: { 'breaker-a': false, 'breaker-b': false, 'breaker-c': false },
      fuseInserted: false,
      generatorRunning: false,
      archiveCode: '4138',
      archiveDoorUnlocked: false,
      researchTerminalUnlocked: false,
      coreSwitches: [false, false, false],
    };
    this.objectives = [
      { id: 'wake', title: OBJECTIVE_TEXT.wake, completed: false },
      { id: 'flashlight', title: OBJECTIVE_TEXT.flashlight, completed: false },
      { id: 'leaveIntake', title: OBJECTIVE_TEXT.leaveIntake, completed: false },
      { id: 'restoreResearchPower', title: OBJECTIVE_TEXT.restoreResearchPower, completed: false },
      { id: 'accessResearch', title: OBJECTIVE_TEXT.accessResearch, completed: false },
      { id: 'unlockUnderground', title: OBJECTIVE_TEXT.unlockUnderground, completed: false },
      { id: 'findCoreKey', title: OBJECTIVE_TEXT.findCoreKey, completed: false },
      { id: 'reachCore', title: OBJECTIVE_TEXT.reachCore, completed: false },
      { id: 'escape', title: OBJECTIVE_TEXT.escape, completed: false },
    ];
    this.currentObjectiveId = 'wake';
    this.openingStage = 0;
    this.unlockedTerminals.clear();
    this.eventSystem.reset();
    this.lastAutosaveLabel = 'Intake Chamber';
    this.facility.applyProgress(this.progress, this.puzzles);
  }

  private enterMainMenu(): void {
    this.state = GameState.MAIN_MENU;
    this.overlayKind = null;
    this.input.exitPointerLock();
    this.ui.showLoading(false);
    this.ui.showMainMenu(true);
    this.ui.showPause(false);
    this.ui.showSettings(false);
    this.ui.showCredits(false);
    this.ui.showHUD(false);
    this.ui.showInventory([], false);
    this.ui.showObjectives([], false);
    this.ui.closeDocument();
    this.ui.closeTerminal();
    this.ui.closeKeypad();
    this.ui.showSaveLoad([], 'load', false);
    this.ui.showDeath(false);
    this.ui.hideEnding();
  }

  private resumeGame(): void {
    if (this.previousState === GameState.MAIN_MENU) {
      this.state = GameState.MAIN_MENU;
      return;
    }
    this.overlayKind = null;
    this.state = GameState.PLAYING;
    this.ui.showPause(false);
    this.ui.showInventory([], false);
    this.ui.showObjectives([], false);
    this.ui.showSettings(false);
    this.input.requestPointerLock();
    void this.audio.ensureStarted();
  }

  private openSettings(previous: GameState): void {
    this.previousState = previous;
    this.overlayKind = 'settings';
    this.state = GameState.SETTINGS;
    this.input.exitPointerLock();
    this.ui.showPause(false);
    this.ui.showSettings(true);
    this.ui.applySettings(this.settings);
  }

  private openSaveLoad(mode: 'save' | 'load'): void {
    this.overlayKind = 'save-load';
    this.previousState = this.state;
    this.state = GameState.CUTSCENE;
    this.input.exitPointerLock();
    this.ui.showPause(false);
    this.ui.showSaveLoad(this.saveManager.listSlots(), mode, true);
  }

  private toggleInventory(fromPause = false): void {
    if (this.state === GameState.INVENTORY && this.overlayKind === 'inventory') {
      this.ui.showInventory([], false);
      this.overlayKind = null;
      this.state = this.previousState;
      if (this.state === GameState.PLAYING) {
        this.input.requestPointerLock();
      }
      return;
    }
    this.previousState = fromPause ? GameState.PAUSED : this.state;
    this.overlayKind = 'inventory';
    this.state = GameState.INVENTORY;
    this.input.exitPointerLock();
    this.ui.showPause(false);
    this.ui.showObjectives([], false);
    this.ui.showInventory(this.player.inventory.getItems(), true);
  }

  private toggleObjectives(fromPause = false): void {
    if (this.state === GameState.INVENTORY && this.overlayKind === 'objectives') {
      this.ui.showObjectives([], false);
      this.overlayKind = null;
      this.state = this.previousState;
      return;
    }
    this.previousState = fromPause ? GameState.PAUSED : this.state;
    this.overlayKind = 'objectives';
    this.state = GameState.INVENTORY;
    this.input.exitPointerLock();
    this.ui.showPause(false);
    this.ui.showInventory([], false);
    this.ui.showObjectives(this.objectives, true);
  }

  private closeTransientOverlay(): void {
    this.ui.closeDocument();
    this.ui.closeTerminal();
    this.ui.closeKeypad();
    this.ui.showSettings(false);
    this.ui.showInventory([], false);
    this.ui.showObjectives([], false);
    this.ui.showSaveLoad([], 'load', false);
    this.overlayKind = null;
    this.terminalSession = null;
    this.pendingKeypad = null;
    if (this.previousState === GameState.MAIN_MENU) {
      this.state = GameState.MAIN_MENU;
      return;
    }
    if (this.previousState === GameState.PAUSED) {
      this.state = GameState.PAUSED;
      this.ui.showPause(true);
      return;
    }
    if (this.progress.introComplete) {
      this.state = GameState.PLAYING;
      this.input.requestPointerLock();
    }
  }

  private handleTerminalLogin(username: string, password: string): boolean {
    if (!this.terminalSession) {
      return false;
    }
    const success = this.terminalSession.username === username.trim().toLowerCase()
      && this.terminalSession.password === password.trim().toLowerCase();
    if (success) {
      this.unlockedTerminals.add(this.terminalSession.id);
      if (this.terminalSession.id === 'research-terminal') {
        this.puzzles.researchTerminalUnlocked = true;
      }
      this.audio.playUiBeep();
    } else {
      this.audio.playUiError();
      this.ui.flashNotice('Invalid credentials.');
    }
    return success;
  }

  private handleTerminalAction(actionId: string): void {
    switch (actionId) {
      case 'route-maintenance':
        this.ui.flashNotice('Maintenance route confirmed. Three breakers and a missing fuse are flagged.');
        this.queueSubtitle('SECURITY NODE', 'Backup power is available through Maintenance.', 3.6);
        break;
      case 'unlock-archive':
        this.progress.archiveCodeFound = true;
        this.setObjective('unlockUnderground');
        this.ui.flashNotice('Archive override code logged: 4138');
        this.lastAutosaveLabel = 'Research Terminal';
        this.saveGame(this.currentSaveSlot, true);
        break;
      case 'ending-stabilize':
        if (this.puzzles.coreSwitches.every(Boolean)) {
          this.triggerEnding('stabilize');
        } else {
          this.ui.flashNotice('The lattice is incomplete. Restore all switches first.');
        }
        break;
      case 'ending-purge':
        if (this.puzzles.coreSwitches.every(Boolean)) {
          this.triggerEnding('purge');
        } else {
          this.ui.flashNotice('The purge path is locked until the lattice is restored.');
        }
        break;
      default:
        break;
    }
  }

  private handleKeypadSubmit(value: string): void {
    if (!this.pendingKeypad) {
      return;
    }
    if (value.trim() === this.puzzles.archiveCode) {
      this.puzzles.archiveDoorUnlocked = true;
      this.progress.undergroundUnlocked = true;
      this.facility.applyProgress(this.progress, this.puzzles);
      this.ui.flashNotice('Archive blast door unlocked.');
      this.setObjective('findCoreKey');
      this.audio.playUiBeep();
      this.lastAutosaveLabel = 'Archive Door';
      this.saveGame(this.currentSaveSlot, true);
      this.closeTransientOverlay();
      return;
    }
    this.audio.playUiError();
    this.ui.flashNotice('Incorrect code.');
  }

  private checkPowerProgress(): void {
    const allBreakers = Object.values(this.puzzles.breakers).every(Boolean);
    if (allBreakers && this.puzzles.fuseInserted && !this.progress.researchPowerRestored) {
      this.progress.researchPowerRestored = true;
      this.puzzles.generatorRunning = true;
      this.facility.applyProgress(this.progress, this.puzzles);
      this.suppressor.awaken(this.facility);
      this.audio.playAnnouncementChime();
      this.queueSubtitle('ANNOUNCEMENT', 'Research Wing power restored. Containment drift detected.', 4.8);
      this.ui.flashNotice('Power returns to the Research Wing. Something moves in the halls.');
      this.setObjective('accessResearch');
      this.lastAutosaveLabel = 'Research Power';
      this.saveGame(this.currentSaveSlot, true);
    }
  }

  private retryFromCheckpoint(): void {
    const latest = this.saveManager.load(this.currentSaveSlot) ?? this.saveManager.getLatestSave();
    if (latest) {
      this.loadSave(latest);
      this.ui.showDeath(false);
    } else {
      this.startNewGame();
    }
  }

  private triggerEnding(mode: 'stabilize' | 'purge'): void {
    this.progress.endingChosen = true;
    this.progress.endingMode = mode;
    this.setObjective('escape');
    const evidenceBonus = this.progress.evidenceCollected >= 3 ? 'You leave with enough evidence to prove the chamber was never empty.' : 'You escape without proof of what truly answered the chamber.';
    const title = mode === 'stabilize' ? 'FIELD HELD' : 'PURGE COMPLETE';
    const body = mode === 'stabilize'
      ? `You restore the lattice, the Suppressor receding behind a veil of static as emergency shutters release the outbound route. ${evidenceBonus}`
      : `You overload the core and flee through an emergency shaft as the lower facility burns. The signal behind you screams and then vanishes. ${evidenceBonus}`;

    this.state = GameState.ENDING;
    this.input.exitPointerLock();
    this.ui.closeTerminal();
    this.ui.showEnding(title, body);
  }

  private update(dt: number): void {
    this.fpsAccumulator += dt;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    this.handleGlobalInputs();
    const now = performance.now() * 0.001;

    const menuContext = this.state === GameState.MAIN_MENU || (this.previousState === GameState.MAIN_MENU && (this.state === GameState.SETTINGS || this.overlayKind === 'save-load'));

    if (menuContext) {
      this.updateMenu(dt, now);
    } else if (this.state === GameState.CUTSCENE) {
      this.updateCutscene(dt);
    } else if (this.state === GameState.PLAYING) {
      this.updateGameplay(dt, now);
    } else if (this.state === GameState.PAUSED) {
      this.audio.setMusicState('silence');
    }

    this.ui.updateSubtitles(dt);
    this.render(dt);
    this.input.endFrame(this.settings);
  }

  private updateMenu(dt: number, now: number): void {
    this.facility.setListener(this.menuCamera.position);
    this.facility.update(dt, now, this.progress, this.puzzles);
    this.menuCamera.position.set(20 + Math.sin(now * 0.16) * 9, 1.9 + Math.sin(now * 0.3) * 0.1, 6 + Math.cos(now * 0.18) * 5);
    this.menuCamera.lookAt(22 + Math.sin(now * 0.1) * 3, 1.5, 0);
  }

  private updateCutscene(dt: number): void {
    this.facility.setListener(this.player.position);
    this.facility.update(dt, performance.now() * 0.001, this.progress, this.puzzles);

    if (this.progress.introComplete) {
      return;
    }

    this.openingTime += dt;
    if (this.openingStage === 0) {
      this.queueSubtitle('RADIO', '...if anyone hears this, the intake relay is still live...', 3.1);
      this.openingStage = 1;
    }
    if (this.openingStage === 1 && this.openingTime >= 2.5) {
      this.audio.playAnnouncementChime();
      this.queueSubtitle('ANNOUNCEMENT', 'Suppression Event in progress. Emergency systems unstable.', 4.3);
      this.setObjective('flashlight');
      this.openingStage = 2;
    }
    if (this.openingStage === 2 && this.openingTime >= 6.5) {
      this.progress.introComplete = true;
      this.state = GameState.PLAYING;
      this.ui.showHUD(true);
      this.input.requestPointerLock();
      this.ui.flashNotice('A weak beam glints on the shelf to your right.');
    }
  }

  private updateGameplay(dt: number, now: number): void {
    this.player.update(dt, this.input, this.facility, this.audio, this.settings);
    this.facility.setListener(this.player.position);
    this.facility.update(dt, now, this.progress, this.puzzles);
    this.updateAutomaticDoors();
    this.updateInteractions();
    this.suppressor.update(dt, this.player, this.facility, this.settings);
    this.eventSystem.update(dt, this);

    const zoneId = this.facility.getZoneId(this.player.position);
    if (zoneId === 'lobby' && this.progress.flashlightFound && this.currentObjectiveId === 'leaveIntake') {
      this.setObjective('restoreResearchPower');
      this.lastAutosaveLabel = 'Main Lobby';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'core' && this.progress.coreKeyFound) {
      this.progress.coreEntered = true;
    }

    const healthRatio = 1 - this.player.health / 100;
    const distance = this.suppressor.active ? this.suppressor.getDistanceToPlayer(this.player) : 99;
    this.audio.update(dt, this.player.fear + Math.max(0, 1 - distance / 18) * 0.5, healthRatio);
    this.audio.setMusicState(this.getMusicState(distance));
    this.audio.setDangerTension(Math.max(0, 1 - distance / 15));
    if (distance < 18 && Math.random() < dt * 1.2) {
      this.audio.playEnemyPresence(distance, this.getPanForPosition(this.suppressor.root.position));
    }

    this.ui.updateHUD({
      battery: this.player.flashlightBattery,
      lowBattery: this.player.flashlightBattery <= LOW_BATTERY_THRESHOLD,
      health: this.player.health,
      stamina: this.player.stamina,
      zone: this.facility.getZoneName(this.player.position),
      objective: this.objectives.find((objective) => objective.id === this.currentObjectiveId)?.title ?? OBJECTIVE_TEXT.wake,
    });
    this.ui.setOverlayEffects(this.player.fear, healthRatio, this.settings.graphics.brightness, this.settings.graphics.effects);

    if (this.player.isDead()) {
      this.state = GameState.DEAD;
      this.input.exitPointerLock();
      this.ui.showDeath(true);
      this.audio.setMusicState('danger');
    }
  }

  private updateAutomaticDoors(): void {
    for (const door of this.facility.doors) {
      door.autoOpen(this);
    }
  }

  private updateInteractions(): void {
    if (this.player.hiddenSpot) {
      this.ui.setPrompt('[E] EXIT HIDING PLACE');
      if (this.input.consumeActionPress('interact')) {
        this.exitHideSpot();
      }
      return;
    }

    this.pointer.set(0, 0);
    this.raycaster.setFromCamera(this.pointer, this.player.camera);
    let best: Interactable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const interactable of this.facility.interactables) {
      interactable.highlight(false);
      if (!interactable.active) {
        continue;
      }
      const hits = this.raycaster.intersectObject(interactable.object, true);
      if (hits.length === 0) {
        continue;
      }
      const distance = hits[0].distance;
      if (distance < INTERACT_DISTANCE && distance < bestDistance && interactable.canInteract(this)) {
        bestDistance = distance;
        best = interactable;
      }
    }

    if (best) {
      best.highlight(true);
      this.ui.setPrompt(best.prompt);
      if (this.input.consumeActionPress('interact')) {
        best.interact(this);
      }
    } else {
      this.ui.setPrompt(null);
    }
  }

  private getMusicState(distance: number): MusicState {
    if (this.state !== GameState.PLAYING) {
      return 'silence';
    }
    if (this.facility.getZoneId(this.player.position) === 'core' && this.progress.coreEntered) {
      return 'finale';
    }
    if (distance < 6) {
      return 'chase';
    }
    if (distance < CHASE_MUSIC_RADIUS) {
      return 'nearby';
    }
    if (this.player.fear > 0.55) {
      return 'tension';
    }
    if (this.state === GameState.PLAYING) {
      return 'exploration';
    }
    return 'silence';
  }

  private handleGlobalInputs(): void {
    if (this.input.consumeActionPress('debug')) {
      this.showDebug = !this.showDebug;
    }
    if (this.input.consumeActionPress('enemyDebug')) {
      this.showEnemyDebug = !this.showEnemyDebug;
      this.ui.flashNotice(`Enemy debug ${this.showEnemyDebug ? 'enabled' : 'disabled'}.`);
    }
    if (this.input.consumeActionPress('teleportDebug') && this.showDebug) {
      const zones = [new Vector3(20, 0, 0), new Vector3(34, 0, 18), new Vector3(48, 0, -6), new Vector3(74, 0, 8), new Vector3(104, 0, -6)];
      const index = Math.floor(Math.random() * zones.length);
      this.player.position.copy(zones[index]);
      this.ui.flashNotice('Debug teleport executed.');
    }

    if (this.state === GameState.PLAYING) {
      if (this.input.consumeActionPress('pause')) {
        this.previousState = GameState.PLAYING;
        this.state = GameState.PAUSED;
        this.ui.showPause(true);
        this.input.exitPointerLock();
        return;
      }
      if (this.input.consumeActionPress('inventory')) {
        this.toggleInventory(false);
        return;
      }
      if (this.input.consumeActionPress('flashlight') && this.progress.flashlightFound) {
        this.player.toggleFlashlight(this.audio);
      }
    } else if (this.state === GameState.PAUSED) {
      if (this.input.consumeActionPress('pause')) {
        this.resumeGame();
      }
    } else if (this.state === GameState.INVENTORY || this.state === GameState.SETTINGS || this.state === GameState.CUTSCENE) {
      if (this.progress.introComplete && (this.input.consumeActionPress('pause') || this.input.consumeActionPress('inventory'))) {
        this.closeTransientOverlay();
      }
    }

    if (this.showDebug) {
      this.ui.setDebugInfo(this.collectDebugInfo(), true);
    } else {
      this.ui.setDebugInfo(this.collectDebugInfo(), false);
    }
  }

  private collectDebugInfo(): DebugInfo {
    return {
      fps: this.fpsValue,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      position: `${this.player.position.x.toFixed(1)}, ${this.player.position.y.toFixed(1)}, ${this.player.position.z.toFixed(1)}`,
      zone: this.facility.getZoneName(this.player.position),
      objective: this.objectives.find((objective) => objective.id === this.currentObjectiveId)?.title ?? 'Unknown',
      enemyState: `${this.suppressor.state}${this.showEnemyDebug ? ` @ ${this.suppressor.root.position.x.toFixed(1)}, ${this.suppressor.root.position.z.toFixed(1)}` : ''}`,
      assets: 'Procedural geometry / generated audio',
    };
  }

  private render(dt: number): void {
    const useMenuCamera = this.state === GameState.MAIN_MENU || (this.previousState === GameState.MAIN_MENU && (this.state === GameState.SETTINGS || this.overlayKind === 'save-load'));
    const activeCamera = useMenuCamera ? this.menuCamera : this.player.camera;
    this.updateAudioListener(activeCamera);
    if (this.postfx) {
      this.postfx.render(dt, this.scene, activeCamera);
    } else {
      this.renderer.render(this.scene, activeCamera);
    }
    const cameraId = this.ui.getSelectedCamera();
    if (cameraId) {
      const feed = this.facility.cameras.get(cameraId);
      if (feed) {
        this.terminalRenderer.setSize(this.ui.terminalCameraCanvas.clientWidth || 480, this.ui.terminalCameraCanvas.clientHeight || 270, false);
        this.terminalRenderer.render(this.scene, feed.camera);
      }
    }
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.postfx?.setSize(width, height);
    const aspect = width / height;
    this.player?.camera && (this.player.camera.aspect = aspect);
    this.player?.camera?.updateProjectionMatrix();
    this.menuCamera.aspect = aspect;
    this.menuCamera.updateProjectionMatrix();
  }

  private applySettings(settings: GameSettings): void {
    this.settings = JSON.parse(JSON.stringify(settings)) as GameSettings;
    const graphics = this.settings.graphics;
    // Keep the legacy boolean in sync for older code paths and saves.
    graphics.shadows = graphics.shadowQuality !== 'off';
    this.saveManager.saveSettings(this.settings);
    this.input.updateSettings(this.settings);
    this.audio.applySettings(this.settings);
    this.ui.applySettings(this.settings);

    this.renderer.setPixelRatio(window.devicePixelRatio * graphics.resolutionScale);
    this.renderer.shadowMap.enabled = graphics.shadowQuality !== 'off';
    this.renderer.shadowMap.type = graphics.shadowQuality === 'high' ? PCFSoftShadowMap : PCFShadowMap;
    this.renderer.toneMappingExposure = graphics.brightness;
    this.renderer.domElement.style.imageRendering = graphics.antialias ? 'auto' : 'pixelated';

    if (this.facility) {
      this.facility.applyGraphics(this.settings);
      this.scene.fog = graphics.fog ? this.facility.sceneFog : null;
    }
    if (this.player) {
      this.player.applyGraphics(this.settings);
      this.player.camera.fov = this.settings.accessibility.fov;
      this.player.camera.updateProjectionMatrix();
    }
    this.postfx?.applySettings(this.settings);
    this.onResize();
  }

  /** Keeps the Web Audio listener aligned with the active camera. */
  private updateAudioListener(camera: PerspectiveCamera): void {
    const position = camera.getWorldPosition(this.tempVecA);
    const right = this.tempVecB.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(this.tempQuat));
    this.audio.setListener(
      { x: position.x, y: position.y, z: position.z },
      { x: right.x, y: right.y, z: right.z },
    );
  }

  /** Stereo pan (-1..1) of a world position relative to the active camera. */
  public getPanForPosition(position: Vector3): number {
    const camera = this.player ? this.player.camera : this.menuCamera;
    const origin = camera.getWorldPosition(this.tempVecA);
    const relative = this.tempVecB.copy(position).sub(origin);
    const distance = relative.length();
    if (distance < 0.001) {
      return 0;
    }
    const right = this.tempRight.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(this.tempQuat));
    return Math.max(-1, Math.min(1, relative.dot(right) / distance));
  }

  /** Screen distortion + camera shake for supernatural moments. */
  public triggerHorrorPulse(strength: number): void {
    this.postfx?.pulse(strength);
    if (this.settings.accessibility.screenShake) {
      this.player?.addShake(strength * 1.4);
    }
  }

  private handleFatalError(error: unknown): void {
    console.error(error);
    this.root.innerHTML = `
      <div style="padding:2rem;color:#d7e3ff;background:#04070b;font-family:Arial,sans-serif;min-height:100vh;">
        <h1>${GAME_TITLE}</h1>
        <p>Compatibility error: this browser could not initialize the 3D renderer.</p>
        <pre>${String(error)}</pre>
      </div>
    `;
  }
}
