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
  Mesh,
  Group,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
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
import { Monster } from '../enemies/Monster';
import { Boss } from '../enemies/Boss';
import { GameLoop } from './GameLoop';
import { GameState } from './GameState';
import { ShootingRange } from './ShootingRange';
import type { Interactable } from '../interaction/Interactable';
import { Player } from '../player/Player';
import { EventSystem } from '../systems/EventSystem';
import { Weapon } from './Weapon';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager';
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
  public monsters: Monster[] = [];
  public bosses: Boss[] = [];
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
  public currentSaveSlot = DEFAULT_SAVE_SLOT;
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
  private adaptiveScale = 1;
  private adaptiveTimer = 0;
  private runTime = 0;
  public weapon = new Weapon();
  public multiplayer: MultiplayerManager | null = null;
  private mpPlayers = new Map<string, { mesh: Group; lastPos: Vector3 }>();
  private mpChatVisible = false;
  private mpSyncTimer = 0;
  private perspectiveToggleCooldown = 0;
  public shootingRange: import('./ShootingRange').ShootingRange | null = null;

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
      this.setObjective('enterLevel3');
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

  public get objectiveId(): string {
    return this.currentObjectiveId;
  }

  public setObjective(id: keyof typeof OBJECTIVE_TEXT): void {
    const nextText = OBJECTIVE_TEXT[id];
    const current = this.objectives.find((objective) => objective.id === this.currentObjectiveId);
    if (current && current.id !== id) {
      current.completed = true;
    }
    this.currentObjectiveId = id;
    let next = this.objectives.find((objective) => objective.id === id);
    if (!next) {
      // Older save files predate this step: append it instead of losing it.
      next = { id, title: nextText, completed: false };
      this.objectives.push(next);
    } else {
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

  public startShootingRange(): void {
    void this.audio.ensureStarted();
    this.buildWorld();
    this.resetGameState();
    this.progress.introComplete = true;
    this.progress.flashlightFound = true;
    this.player.position.set(10, 0, 55); // South of shooting range, facing north
    this.player.yaw = Math.PI; // Face north towards targets
    this.player.pitch = 0;
    this.weapon.reload();
    if (this.shootingRange) {
      this.shootingRange.resetScore();
    }
    this.state = GameState.SHOOTING_RANGE;
    this.overlayKind = null;
    this.ui.showMainMenu(false);
    this.ui.showHUD(true);
    this.ui.showShootingHud(true);
    this.ui.showPause(false);
    this.ui.flashNotice('SHOOTING RANGE // Practice mode - Left click to shoot, R to reload, F5 perspective');
    this.input.requestPointerLock();
    this.audio.setMusicState('exploration');
  }

  public openMultiplayerPanel(): void {
    this.ui.showMultiplayer(true);
    this.ui.updateMultiplayerStatus('DISCONNECTED // Enter name and server URL');
  }

  public closeMultiplayerPanel(): void {
    this.ui.showMultiplayer(false);
  }

  public async createMultiplayerRoom(playerName: string, serverUrl: string): Promise<void> {
    this.ui.updateMultiplayerStatus(`CONNECTING TO ${serverUrl}...`);
    try {
      const { MultiplayerManager } = await import('../multiplayer/MultiplayerManager');
      this.multiplayer = new MultiplayerManager(playerName, serverUrl);
      this.multiplayer.setPlayerName(playerName);
      this.multiplayer.setServerUrl(serverUrl);

      this.multiplayer.onRoomCreated = (code) => {
        this.ui.setInviteCode(code, 1);
        this.ui.updateMultiplayerStatus(`ROOM CREATED // CODE: ${code} // WAITING FOR PLAYERS`);
        this.ui.updatePlayerList(this.multiplayer!.getPlayers());
      };

      this.multiplayer.onChatMessage = (msg) => {
        this.ui.addChatMessage(msg.playerName, msg.message, msg.isSystem);
      };

      this.multiplayer.onPlayerJoined = (player) => {
        this.ui.updatePlayerList(this.multiplayer!.getPlayers());
        this.ui.updateMultiplayerStatus(`${player.name} joined // ${this.multiplayer!.getPlayers().length} players`);
      };

      this.multiplayer.onPlayerLeft = () => {
        this.ui.updatePlayerList(this.multiplayer!.getPlayers());
      };

      this.multiplayer.onError = (err) => {
        this.ui.updateMultiplayerStatus(`ERROR: ${err}`);
        this.ui.flashNotice(err);
      };

      const code = await this.multiplayer.createRoom();
      this.ui.flashNotice(`Room created! Code: ${code} - Share with friends`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.ui.updateMultiplayerStatus(`FAILED: ${errMsg}`);
      this.ui.flashNotice(`MP Error: ${errMsg} - Run: npm run mp-server`);
    }
  }

  public async joinMultiplayerRoom(code: string, playerName: string, serverUrl: string): Promise<void> {
    if (!code || code.length < 4) {
      this.ui.flashNotice('Enter valid invite code (6 chars)');
      this.ui.updateMultiplayerStatus('INVALID CODE // Must be 6 characters');
      return;
    }
    this.ui.updateMultiplayerStatus(`JOINING ROOM ${code.toUpperCase()}...`);
    try {
      const { MultiplayerManager } = await import('../multiplayer/MultiplayerManager');
      if (!this.multiplayer) {
        this.multiplayer = new MultiplayerManager(playerName, serverUrl);
      }
      this.multiplayer.setPlayerName(playerName);
      this.multiplayer.setServerUrl(serverUrl);

      this.multiplayer.onChatMessage = (msg) => {
        this.ui.addChatMessage(msg.playerName, msg.message, msg.isSystem);
      };

      this.multiplayer.onPlayerJoined = () => {
        this.ui.updatePlayerList(this.multiplayer!.getPlayers());
      };

      this.multiplayer.onPlayerLeft = () => {
        this.ui.updatePlayerList(this.multiplayer!.getPlayers());
      };

      this.multiplayer.onJoined = (joinedCode, players) => {
        this.ui.setInviteCode(joinedCode, players.length);
        this.ui.updatePlayerList(players);
        this.ui.updateMultiplayerStatus(`JOINED ${joinedCode} // ${players.length} PLAYERS // READY TO START`);
        this.ui.flashNotice(`Joined room ${joinedCode} with ${players.length} players`);
      };

      this.multiplayer.onError = (err) => {
        this.ui.updateMultiplayerStatus(`ERROR: ${err}`);
        this.ui.flashNotice(err);
      };

      await this.multiplayer.joinRoom(code);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.ui.updateMultiplayerStatus(`FAILED: ${errMsg}`);
      this.ui.flashNotice(`Join failed: ${errMsg}`);
    }
  }

  public startMultiplayerGame(): void {
    if (!this.multiplayer || !this.multiplayer.isConnected()) {
      this.ui.flashNotice('Not connected to multiplayer room - create or join first');
      return;
    }
    void this.audio.ensureStarted();
    this.buildWorld();
    this.resetGameState();
    this.progress.introComplete = true;
    this.progress.flashlightFound = true;
    this.player.position.set(0, 0, 0); // Spawn at center, now cleared
    this.player.yaw = 0;
    this.weapon.reload();
    if (this.shootingRange) {
      this.shootingRange.resetScore();
    }
    this.state = GameState.MULTIPLAYER;
    this.overlayKind = null;
    this.ui.showMultiplayer(false);
    this.ui.showMainMenu(false);
    this.ui.showHUD(true);
    this.ui.showShootingHud(true);
    this.ui.showMPChat(true);
    this.ui.showPause(false);
    this.ui.flashNotice(`MULTIPLAYER STARTED // Room ${this.multiplayer.getRoomCode()} // T to chat, F5 perspective, Click to shoot`);
    this.input.requestPointerLock();
    this.audio.setMusicState('exploration');

    // Setup multiplayer callbacks for in-game
    this.multiplayer.onChatMessage = (msg) => {
      this.ui.addChatMessage(msg.playerName, msg.message, msg.isSystem);
    };
    this.multiplayer.onPlayerMove = (playerId, pos, yaw, _pitch) => {
      // Handled in updateRemotePlayers
    };
    this.multiplayer.onPlayerShoot = (playerId, pos, dir, hit) => {
      // Show remote shoot effect
      const player = this.multiplayer?.getPlayers().find(p=>p.id===playerId);
      if (player) {
        this.ui.flashNotice(`${player.name} fired`);
      }
    };
  }

  public leaveMultiplayerRoom(): void {
    if (this.multiplayer) {
      this.multiplayer.leaveRoom();
      this.multiplayer.disconnect();
      this.multiplayer = null;
    }
    // Clear remote players
    for (const entry of this.mpPlayers.values()) {
      this.facility.root.remove(entry.mesh);
    }
    this.mpPlayers.clear();
    this.ui.clearChat();
    this.ui.updateMultiplayerStatus('DISCONNECTED // Left room');
    this.ui.flashNotice('Left multiplayer room');
    const display = document.getElementById('mp-invite-display');
    const startBtn = document.getElementById('mp-start-button');
    const leaveBtn = document.getElementById('mp-leave-button');
    if (display) display.classList.add('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (leaveBtn) leaveBtn.classList.add('hidden');
  }

  public sendMPChat(message: string): void {
    if (!this.multiplayer || !message.trim()) return;
    this.multiplayer.sendChat(message);
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
    // MIGRATE PROGRESS - ensure all new fields exist with defaults (saves work across versions)
    const defaultProgress: ProgressState = {
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
      officeUnlocked: false,
      medicalUnlocked: false,
      storageUnlocked: false,
      checkpointUnlocked: false,
      generatorUnlocked: false,
      serviceUnlocked: false,
      industrialUnlocked: false,
      containmentUnlocked: false,
      labAnnexUnlocked: false,
      maintenanceLowerUnlocked: false,
      behemothDefeated: false,
      voltDefeated: false,
      coreEntityDefeated: false,
      behemothEncountered: false,
      voltEncountered: false,
      coreEntityEncountered: false,
      powerGridRestored: false,
      secretRoomsFound: 0,
    };
    const defaultPuzzles: PuzzleState = {
      breakers: { 'breaker-a': false, 'breaker-b': false, 'breaker-c': false },
      fuseInserted: false,
      generatorRunning: false,
      archiveCode: '4138',
      archiveDoorUnlocked: false,
      researchTerminalUnlocked: false,
      coreSwitches: [false, false, false],
      officeKeypadCode: '2847',
      officeDoorUnlocked: false,
      medicalKeycardFound: false,
      storageBreakers: { 'storage-a': false, 'storage-b': false },
      checkpointPower: false,
      generatorSwitches: [false, false, false],
      industrialValve: false,
      containmentOverride: false,
      labAnnexCode: '5562',
      labAnnexUnlocked: false,
      serviceElevatorPowered: false,
      outdoorGateUnlocked: false,
    };
    // Merge saved data over defaults
    this.progress = { ...defaultProgress, ...(data.progress as Partial<ProgressState>), evidenceCollected: data.progress?.evidenceCollected ?? 0, secretRoomsFound: (data.progress as any)?.secretRoomsFound ?? 0 } as ProgressState;
    this.puzzles = { ...defaultPuzzles, ...(data.puzzles as Partial<PuzzleState>), breakers: { ...defaultPuzzles.breakers, ...(data.puzzles?.breakers ?? {}) }, storageBreakers: { ...defaultPuzzles.storageBreakers, ...(data.puzzles?.storageBreakers ?? {}) }, coreSwitches: data.puzzles?.coreSwitches ?? [false, false, false], generatorSwitches: (data.puzzles as any)?.generatorSwitches ?? [false, false, false] } as PuzzleState;
    // Migrate objectives - keep saved completion but add any new objectives
    const defaultObjectives = this.createDefaultObjectives();
    const savedMap = new Map((data.objectives ?? []).map(o => [o.id, o.completed]));
    this.objectives = defaultObjectives.map(obj => ({ ...obj, completed: savedMap.get(obj.id) ?? false }));
    this.currentObjectiveId = this.objectives.find((objective) => !objective.completed)?.id ?? 'wake';
    if (this.puzzles.researchTerminalUnlocked) {
      this.unlockedTerminals.add('research-terminal');
    }
    this.facility.restoreDoors(data.doors ?? []);
    this.restoreInteractables(data);
    this.facility.applyProgress(this.progress, this.puzzles);
    this.currentSaveSlot = data.slot ?? 1;
    this.lastAutosaveLabel = data.label ?? 'Restored Save';
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

  private createDefaultObjectives(): Objective[] {
    return [
      { id: 'wake', title: OBJECTIVE_TEXT.wake, completed: false },
      { id: 'flashlight', title: OBJECTIVE_TEXT.flashlight, completed: false },
      { id: 'leaveIntake', title: OBJECTIVE_TEXT.leaveIntake, completed: false },
      { id: 'restoreResearchPower', title: OBJECTIVE_TEXT.restoreResearchPower, completed: false },
      { id: 'accessResearch', title: OBJECTIVE_TEXT.accessResearch, completed: false },
      { id: 'reachLevel2', title: OBJECTIVE_TEXT.reachLevel2, completed: false },
      { id: 'recoverFootage', title: OBJECTIVE_TEXT.recoverFootage, completed: false },
      { id: 'unlockUnderground', title: OBJECTIVE_TEXT.unlockUnderground, completed: false },
      { id: 'findCoreKey', title: OBJECTIVE_TEXT.findCoreKey, completed: false },
      { id: 'reachCore', title: OBJECTIVE_TEXT.reachCore, completed: false },
      { id: 'enterLevel3', title: OBJECTIVE_TEXT.enterLevel3, completed: false },
      { id: 'exploreOffices', title: OBJECTIVE_TEXT.exploreOffices, completed: false },
      { id: 'reachMedical', title: OBJECTIVE_TEXT.reachMedical, completed: false },
      { id: 'unlockCheckpoint', title: OBJECTIVE_TEXT.unlockCheckpoint, completed: false },
      { id: 'enterContainment', title: OBJECTIVE_TEXT.enterContainment, completed: false },
      { id: 'surviveGenerator', title: OBJECTIVE_TEXT.surviveGenerator, completed: false },
      { id: 'enterIndustrial', title: OBJECTIVE_TEXT.enterIndustrial, completed: false },
      { id: 'defeatBehemoth', title: OBJECTIVE_TEXT.defeatBehemoth, completed: false },
      { id: 'defeatVolt', title: OBJECTIVE_TEXT.defeatVolt, completed: false },
      { id: 'escape', title: OBJECTIVE_TEXT.escape, completed: false },
    ];
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
    this.ui.onShootingRange = () => this.startShootingRange();
    this.ui.onMultiplayer = () => this.openMultiplayerPanel();
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
    this.ui.onMultiplayerCreate = (name, url) => this.createMultiplayerRoom(name, url);
    this.ui.onMultiplayerJoin = (code, name, url) => this.joinMultiplayerRoom(code, name, url);
    this.ui.onMultiplayerStart = () => this.startMultiplayerGame();
    this.ui.onMultiplayerLeave = () => this.leaveMultiplayerRoom();
    this.ui.onMultiplayerClose = () => this.closeMultiplayerPanel();
    this.ui.onChatSend = (msg) => this.sendMPChat(msg);
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
    this.monsters = [
      new Monster({ kind: 'watcher', zone: 'level2', spawnNode: 'l2-deck', patrolNodeIds: ['l2-deck', 'l2-hall', 'l2-door'] }),
      new Monster({ kind: 'crawler', zone: 'level3', spawnNode: 'l3-core', patrolNodeIds: ['l3-core', 'l3-hall', 'shelter'] }),
      new Monster({ kind: 'watcher', zone: 'office', spawnNode: 'office-main', patrolNodeIds: ['office-main', 'office-hall', 'breakroom'] }),
      new Monster({ kind: 'crawler', zone: 'medical', spawnNode: 'medical-bay', patrolNodeIds: ['medical-bay', 'medical-hall', 'medical-storage'] }),
    ];
    for (const monster of this.monsters) {
      monster.reset(this.facility);
    }
    // Bosses - unique encounters
    this.bosses = [
      new Boss({
        type: 'behemoth',
        zone: 'containment',
        spawnNode: 'containment-annex',
        arenaCenter: new Vector3(54, 0, -28),
        arenaRadius: 14,
        patrolNodeIds: ['containment-annex', 'containment-corridor', 'lab-annex'],
      }),
      new Boss({
        type: 'volt',
        zone: 'generator',
        spawnNode: 'generator-complex',
        arenaCenter: new Vector3(62, 0, 40),
        arenaRadius: 13,
        patrolNodeIds: ['generator-complex', 'generator-hall', 'maint-lower'],
      }),
      new Boss({
        type: 'coreEntity',
        zone: 'core',
        spawnNode: 'core-room',
        arenaCenter: new Vector3(104, 0, -6),
        arenaRadius: 12,
        patrolNodeIds: ['core-room', 'core-hall', 'industrial-sector'],
      }),
    ];
    for (const boss of this.bosses) {
      boss.reset(this.facility);
    }
    // Shooting range - practice arena (created here to avoid Facility importing it)
    if (!this.shootingRange) {
      this.shootingRange = new ShootingRange();
    }
    this.shootingRange.root.position.set(10, 0, 45);
    this.scene.add(this.shootingRange.root);
    // Also add to facility root for zone checks (facility.root is already in scene)
    if (!this.facility.root.children.includes(this.shootingRange.root)) {
      this.facility.root.add(this.shootingRange.root);
    }
    this.scene.add(this.player.body, this.suppressor.root, ...this.monsters.map((monster) => monster.root), ...this.bosses.map((boss) => boss.root));
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
      officeUnlocked: false,
      medicalUnlocked: false,
      storageUnlocked: false,
      checkpointUnlocked: false,
      generatorUnlocked: false,
      serviceUnlocked: false,
      industrialUnlocked: false,
      containmentUnlocked: false,
      labAnnexUnlocked: false,
      maintenanceLowerUnlocked: false,
      behemothDefeated: false,
      voltDefeated: false,
      coreEntityDefeated: false,
      behemothEncountered: false,
      voltEncountered: false,
      coreEntityEncountered: false,
      powerGridRestored: false,
      secretRoomsFound: 0,
    };
    this.puzzles = {
      breakers: { 'breaker-a': false, 'breaker-b': false, 'breaker-c': false },
      fuseInserted: false,
      generatorRunning: false,
      archiveCode: '4138',
      archiveDoorUnlocked: false,
      researchTerminalUnlocked: false,
      coreSwitches: [false, false, false],
      officeKeypadCode: '2847',
      officeDoorUnlocked: false,
      medicalKeycardFound: false,
      storageBreakers: { 'storage-a': false, 'storage-b': false },
      checkpointPower: false,
      generatorSwitches: [false, false, false],
      industrialValve: false,
      containmentOverride: false,
      labAnnexCode: '5562',
      labAnnexUnlocked: false,
      serviceElevatorPowered: false,
      outdoorGateUnlocked: false,
    };
    this.objectives = [
      { id: 'wake', title: OBJECTIVE_TEXT.wake, completed: false },
      { id: 'flashlight', title: OBJECTIVE_TEXT.flashlight, completed: false },
      { id: 'leaveIntake', title: OBJECTIVE_TEXT.leaveIntake, completed: false },
      { id: 'restoreResearchPower', title: OBJECTIVE_TEXT.restoreResearchPower, completed: false },
      { id: 'accessResearch', title: OBJECTIVE_TEXT.accessResearch, completed: false },
      { id: 'reachLevel2', title: OBJECTIVE_TEXT.reachLevel2, completed: false },
      { id: 'recoverFootage', title: OBJECTIVE_TEXT.recoverFootage, completed: false },
      { id: 'unlockUnderground', title: OBJECTIVE_TEXT.unlockUnderground, completed: false },
      { id: 'findCoreKey', title: OBJECTIVE_TEXT.findCoreKey, completed: false },
      { id: 'reachCore', title: OBJECTIVE_TEXT.reachCore, completed: false },
      { id: 'enterLevel3', title: OBJECTIVE_TEXT.enterLevel3, completed: false },
      { id: 'exploreOffices', title: OBJECTIVE_TEXT.exploreOffices, completed: false },
      { id: 'reachMedical', title: OBJECTIVE_TEXT.reachMedical, completed: false },
      { id: 'unlockCheckpoint', title: OBJECTIVE_TEXT.unlockCheckpoint, completed: false },
      { id: 'enterContainment', title: OBJECTIVE_TEXT.enterContainment, completed: false },
      { id: 'surviveGenerator', title: OBJECTIVE_TEXT.surviveGenerator, completed: false },
      { id: 'enterIndustrial', title: OBJECTIVE_TEXT.enterIndustrial, completed: false },
      { id: 'defeatBehemoth', title: OBJECTIVE_TEXT.defeatBehemoth, completed: false },
      { id: 'defeatVolt', title: OBJECTIVE_TEXT.defeatVolt, completed: false },
      { id: 'escape', title: OBJECTIVE_TEXT.escape, completed: false },
    ];
    this.currentObjectiveId = 'wake';
    this.openingStage = 0;
    this.unlockedTerminals.clear();
    this.eventSystem.reset();
    this.lastAutosaveLabel = 'Intake Chamber';
    this.runTime = 0;
    this.adaptiveScale = 1;
    for (const monster of this.monsters) {
      monster.reset(this.facility);
    }
    for (const boss of this.bosses) {
      boss.reset(this.facility);
    }
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
    this.ui.showShootingHud(false);
    this.ui.showMPChat(false);
    this.ui.showMultiplayer(false);
    this.ui.showInventory([], false);
    this.ui.showObjectives([], false);
    this.ui.closeDocument();
    this.ui.closeTerminal();
    this.ui.closeKeypad();
    this.ui.showSaveLoad([], 'load', false);
    this.ui.showDeath(false);
    this.ui.hideEnding();
    // Cleanup multiplayer if active
    if (this.multiplayer) {
      // Don't disconnect automatically - let player decide, but hide UI
    }
  }

  private resumeGame(): void {
    if (this.previousState === GameState.MAIN_MENU) {
      this.state = GameState.MAIN_MENU;
      return;
    }
    this.overlayKind = null;
    // Restore to previous gameplay state (PLAYING, SHOOTING_RANGE, MULTIPLAYER)
    if (this.previousState === GameState.SHOOTING_RANGE || this.previousState === GameState.MULTIPLAYER || this.previousState === GameState.PLAYING) {
      this.state = this.previousState;
    } else {
      this.state = GameState.PLAYING;
    }
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
        this.setObjective('reachLevel2');
        this.ui.flashNotice('Archive override code logged: 4138');
        this.lastAutosaveLabel = 'Research Terminal';
        this.saveGame(this.currentSaveSlot, true);
        break;
      case 'unlock-office':
        this.puzzles.officeDoorUnlocked = true;
        this.progress.officeUnlocked = true;
        this.facility.applyProgress(this.progress, this.puzzles);
        this.ui.flashNotice('Office Wing unlocked via security override.');
        this.setObjective('exploreOffices');
        this.saveGame(this.currentSaveSlot, true);
        break;
      case 'unlock-medical':
        this.puzzles.medicalKeycardFound = true;
        this.progress.medicalUnlocked = true;
        this.facility.applyProgress(this.progress, this.puzzles);
        this.ui.flashNotice('Medical Bay access granted.');
        this.setObjective('reachMedical');
        this.saveGame(this.currentSaveSlot, true);
        break;
      case 'behemoth-info':
        this.ui.flashNotice('Behemoth: Use light, activate generators, escape via purge. Do not fight.');
        this.queueSubtitle('RESEARCH', 'Behemoth requires generator activation and power redirect to escape.', 4.0);
        break;
      case 'activate-behemoth-generators':
        this.ui.flashNotice('Containment generators primed - activate them in the arena.');
        this.queueSubtitle('CONTAINMENT', 'Generators primed. Enter arena and activate.', 3.5);
        break;
      case 'purge-containment': {
        const boss = this.bosses.find(b => b.type === 'behemoth');
        if (boss) {
          boss.redirectPower();
          boss.openEscapeRoute();
          this.ui.flashNotice('Containment purge initiated - ESCAPE NOW!');
          this.queueSubtitle('SYSTEM', 'PURGE ACTIVE - BEHEMOTH ESCAPE PROTOCOL', 4.0);
          this.setObjective('defeatBehemoth');
        }
        break;
      }
      case 'restore-generator-power': {
        const voltBoss = this.bosses.find(b => b.type === 'volt');
        if (voltBoss) {
          this.ui.flashNotice('Generator power restoration started - Volt entity active!');
          this.queueSubtitle('GENERATOR', 'Power restoration in progress - avoid Volt', 4.0);
        }
        break;
      }
      case 'volt-weakness':
        this.ui.flashNotice('Volt: Weak to light, hunts in darkness, restore 3 switches.');
        this.queueSubtitle('RESEARCH', 'Volt slowed by flashlight, faster in darkness.', 4.0);
        break;
      case 'medical-supplies':
        this.player.heal(50);
        this.ui.flashNotice('Medical supplies dispensed - health restored.');
        this.audio.playPickup('medical');
        break;
      case 'unlock-outdoor':
        this.puzzles.outdoorGateUnlocked = true;
        this.progress.industrialUnlocked = true;
        this.facility.applyProgress(this.progress, this.puzzles);
        this.ui.flashNotice('Outdoor emergency gate unlocked.');
        this.setObjective('escape');
        this.saveGame(this.currentSaveSlot, true);
        break;
      case 'core-entity-info':
        this.ui.flashNotice('Core Entity: Reality distortion, final encounter, linked to Suppression Event.');
        this.queueSubtitle('CORE', 'Final entity is the suppression field itself becoming conscious.', 4.5);
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
    const code = value.trim();
    const pendingId = this.pendingKeypad.id;

    // Archive blast door
    if (pendingId === 'archive-keypad' && code === this.puzzles.archiveCode) {
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

    // Office keypad
    if (pendingId === 'office-keypad' && code === this.puzzles.officeKeypadCode) {
      this.puzzles.officeDoorUnlocked = true;
      this.progress.officeUnlocked = true;
      this.facility.applyProgress(this.progress, this.puzzles);
      this.ui.flashNotice('Office Wing unlocked.');
      this.setObjective('reachMedical');
      this.audio.playUiBeep();
      this.lastAutosaveLabel = 'Office Wing';
      this.saveGame(this.currentSaveSlot, true);
      this.closeTransientOverlay();
      return;
    }

    // Lab Annex keypad
    if (pendingId === 'labAnnex-keypad' && code === this.puzzles.labAnnexCode) {
      this.puzzles.labAnnexUnlocked = true;
      this.progress.labAnnexUnlocked = true;
      this.facility.applyProgress(this.progress, this.puzzles);
      this.ui.flashNotice('Research Annex unlocked.');
      this.setObjective('enterContainment');
      this.audio.playUiBeep();
      this.lastAutosaveLabel = 'Research Annex';
      this.saveGame(this.currentSaveSlot, true);
      this.closeTransientOverlay();
      return;
    }

    // Generic fallback for archive code if pending id not matching
    if (code === this.puzzles.archiveCode) {
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

    const runMinutes = Math.floor(this.runTime / 60);
    const runSeconds = Math.floor(this.runTime % 60).toString().padStart(2, '0');
    const stats = `Survival time ${runMinutes}:${runSeconds} · Evidence recovered ${this.progress.evidenceCollected}.`;
    this.state = GameState.ENDING;
    this.input.exitPointerLock();
    this.ui.closeTerminal();
    this.ui.showEnding(title, `${body}\n\n${stats}`);
  }

  private update(dt: number): void {
    this.fpsAccumulator += dt;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    // Adaptive resolution: when the frame rate sags, quietly lower the internal
    // render scale (and restore it when there is headroom again).
    this.adaptiveTimer += dt;
    if (this.adaptiveTimer >= 2.5) {
      this.adaptiveTimer = 0;
      if (this.fpsValue > 0 && this.fpsValue < 44 && this.adaptiveScale > 0.68) {
        this.adaptiveScale = Math.max(0.68, this.adaptiveScale - 0.07);
        this.applyResolution();
      } else if (this.fpsValue > 57 && this.adaptiveScale < 1) {
        this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.04);
        this.applyResolution();
      }
    }

    if (this.perspectiveToggleCooldown > 0) {
      this.perspectiveToggleCooldown -= dt;
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
    } else if (this.state === GameState.SHOOTING_RANGE) {
      this.updateShootingRange(dt, now);
    } else if (this.state === GameState.MULTIPLAYER) {
      this.updateMultiplayer(dt, now);
    } else if (this.state === GameState.PAUSED) {
      this.audio.setMusicState('silence');
    }

    // Always update weapon
    this.weapon.update(dt);

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
    for (const monster of this.monsters) {
      monster.update(dt, this.player, this.facility, this);
    }
    for (const boss of this.bosses) {
      boss.update(dt, this.player, this.facility, this);
    }
    this.eventSystem.update(dt, this);
    this.runTime += dt;

    const zoneId = this.facility.getZoneId(this.player.position);
    if (zoneId === 'lobby' && this.progress.flashlightFound && this.currentObjectiveId === 'leaveIntake') {
      this.setObjective('restoreResearchPower');
      this.lastAutosaveLabel = 'Main Lobby';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'level2' && this.currentObjectiveId === 'reachLevel2') {
      this.setObjective(this.player.inventory.has('footage-chamber-4') ? 'unlockUnderground' : 'recoverFootage');
      this.lastAutosaveLabel = 'Observation Deck';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'level3' && this.currentObjectiveId === 'enterLevel3') {
      this.setObjective('escape');
      this.queueSubtitle('SUIT', 'Storage is empty... whatever they kept down here is gone.', 4.2);
      this.lastAutosaveLabel = 'Level 3 Storage';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'core' && this.progress.coreKeyFound) {
      this.progress.coreEntered = true;
    }
    // Expansion objectives
    if (zoneId === 'office' && this.currentObjectiveId === 'exploreOffices') {
      this.setObjective('reachMedical');
      this.progress.officeUnlocked = true;
      this.lastAutosaveLabel = 'Office Wing';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'medical' && this.currentObjectiveId === 'reachMedical') {
      this.setObjective('unlockCheckpoint');
      this.progress.medicalUnlocked = true;
      this.lastAutosaveLabel = 'Medical Bay';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'checkpoint' && this.currentObjectiveId === 'unlockCheckpoint') {
      this.setObjective('enterContainment');
      this.progress.checkpointUnlocked = true;
      this.lastAutosaveLabel = 'Checkpoint';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'containment' && this.currentObjectiveId === 'enterContainment') {
      this.queueSubtitle('SYSTEM', 'Behemoth containment breach - survive and escape', 4.0);
      this.lastAutosaveLabel = 'Containment Annex';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'generator' && this.currentObjectiveId === 'surviveGenerator') {
      this.queueSubtitle('SYSTEM', 'Volt entity active - restore power', 4.0);
      this.lastAutosaveLabel = 'Generator Complex';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'industrial' && this.currentObjectiveId === 'enterIndustrial') {
      this.setObjective('escape');
      this.progress.industrialUnlocked = true;
      this.lastAutosaveLabel = 'Industrial Sector';
      this.saveGame(this.currentSaveSlot, true);
    }
    if (zoneId === 'outdoor' && this.progress.coreKeyFound) {
      this.queueSubtitle('SYSTEM', 'Emergency exit route located', 3.5);
    }

    const healthRatio = 1 - this.player.health / 100;
    const threat = this.getNearestThreat();
    const distance = threat ? threat.distance : 99;
    this.audio.update(dt, this.player.fear + Math.max(0, 1 - distance / 18) * 0.5, healthRatio);
    this.audio.setMusicState(this.getMusicState(distance));
    this.audio.setDangerTension(Math.max(0, 1 - distance / 15));
    if (distance < 18 && threat && Math.random() < dt * 1.2) {
      this.audio.playEnemyPresence(distance, this.getPanForPosition(threat.position));
    }

    // Shooting handling - left mouse in any mode
    if (this.input.consumeActionPress('shoot' as any)) {
      this.handleShoot();
    }
    if (this.input.consumeActionPress('reload' as any)) {
      this.weapon.reload();
      this.ui.flashNotice('RELOADED // 30 / 30');
      this.audio.playUiBeep();
    }

    // Multiplayer sync
    if (this.multiplayer && this.multiplayer.isConnected()) {
      this.mpSyncTimer += dt;
      if (this.mpSyncTimer >= 0.1) {
        this.mpSyncTimer = 0;
        this.multiplayer.sendMove(
          { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
          this.player.yaw,
          this.player.pitch,
          this.player.perspective,
        );
      }
    }

    // Shooting range targets update
    if (this.shootingRange) {
      this.shootingRange.update(dt);
      const score = this.shootingRange.getScore();
      this.ui.updateShootingHud(score.score, this.weapon.ammo, this.weapon.maxAmmo, score.accuracy, score.hits, score.shots, this.player.perspective);
    }

    this.ui.updateHUD({
      battery: this.player.flashlightBattery,
      lowBattery: this.player.flashlightBattery <= LOW_BATTERY_THRESHOLD,
      health: this.player.health,
      stamina: this.player.stamina,
      zone: this.facility.getZoneName(this.player.position),
      objective: this.objectives.find((objective) => objective.id === this.currentObjectiveId)?.title ?? OBJECTIVE_TEXT.wake,
      hints: this.collectHints(zoneId),
      coordinates: `${this.player.position.x.toFixed(1)} / ${this.player.position.y.toFixed(1)} / ${this.player.position.z.toFixed(1)}`,
      showCoordinates: this.settings.accessibility.coordinates,
    });
    this.ui.setOverlayEffects(this.player.fear, healthRatio, this.settings.graphics.brightness, this.settings.graphics.effects);

    if (this.player.isDead()) {
      this.state = GameState.DEAD;
      this.input.exitPointerLock();
      this.ui.showDeath(true);
      this.audio.setMusicState('danger');
    }
  }

  private updateShootingRange(dt: number, now: number): void {
    this.player.update(dt, this.input, this.facility, this.audio, this.settings);
    this.facility.setListener(this.player.position);
    this.facility.update(dt, now, this.progress, this.puzzles);
    this.updateAutomaticDoors();
    this.eventSystem.update(dt, this);
    this.runTime += dt;

    if (this.shootingRange) {
      this.shootingRange.update(dt);
    }

    if (this.input.consumeActionPress('shoot' as any)) {
      this.handleShoot();
    }
    if (this.input.consumeActionPress('reload' as any)) {
      this.weapon.reload();
      this.ui.flashNotice('RELOADED // 30 / 30');
      this.audio.playUiBeep();
    }

    if (this.input.consumeActionPress('flashlight' as any) && this.progress.flashlightFound) {
      this.player.toggleFlashlight(this.audio);
    }

    const score = this.shootingRange?.getScore();
    if (score) {
      this.ui.updateShootingHud(score.score, this.weapon.ammo, this.weapon.maxAmmo, score.accuracy, score.hits, score.shots, this.player.perspective);
    }

    const healthRatio = 1 - this.player.health / 100;
    this.audio.update(dt, this.player.fear, healthRatio);
    this.audio.setMusicState('exploration');

    this.ui.updateHUD({
      battery: this.player.flashlightBattery,
      lowBattery: this.player.flashlightBattery <= LOW_BATTERY_THRESHOLD,
      health: this.player.health,
      stamina: this.player.stamina,
      zone: 'SHOOTING RANGE // PRACTICE',
      objective: 'Practice shooting - Press R to reload, F5 perspective, T chat (MP)',
      hints: ['Left click to shoot', 'Moving targets worth more', 'R to reload ammo', 'F5 toggles perspective'],
      coordinates: `${this.player.position.x.toFixed(1)} / ${this.player.position.y.toFixed(1)} / ${this.player.position.z.toFixed(1)}`,
      showCoordinates: this.settings.accessibility.coordinates,
    });
  }

  private updateMultiplayer(dt: number, now: number): void {
    this.player.update(dt, this.input, this.facility, this.audio, this.settings);
    this.facility.setListener(this.player.position);
    this.facility.update(dt, now, this.progress, this.puzzles);
    this.updateAutomaticDoors();
    this.updateInteractions();
    this.suppressor.update(dt, this.player, this.facility, this.settings);
    for (const monster of this.monsters) {
      monster.update(dt, this.player, this.facility, this);
    }
    for (const boss of this.bosses) {
      boss.update(dt, this.player, this.facility, this);
    }
    this.eventSystem.update(dt, this);
    this.runTime += dt;

    if (this.input.consumeActionPress('shoot' as any)) {
      this.handleShoot();
    }
    if (this.input.consumeActionPress('reload' as any)) {
      this.weapon.reload();
      this.ui.flashNotice('RELOADED // 30 / 30');
      this.audio.playUiBeep();
    }

    if (this.multiplayer && this.multiplayer.isConnected()) {
      this.mpSyncTimer += dt;
      if (this.mpSyncTimer >= 0.08) {
        this.mpSyncTimer = 0;
        this.multiplayer.sendMove(
          { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
          this.player.yaw,
          this.player.pitch,
          this.player.perspective,
        );
      }
    }

    if (this.shootingRange) {
      this.shootingRange.update(dt);
      const score = this.shootingRange.getScore();
      this.ui.updateShootingHud(score.score, this.weapon.ammo, this.weapon.maxAmmo, score.accuracy, score.hits, score.shots, this.player.perspective);
    }

    // Update remote player meshes
    this.updateRemotePlayers(dt);

    this.ui.updateHUD({
      battery: this.player.flashlightBattery,
      lowBattery: this.player.flashlightBattery <= LOW_BATTERY_THRESHOLD,
      health: this.player.health,
      stamina: this.player.stamina,
      zone: `${this.facility.getZoneName(this.player.position)} // MP: ${this.multiplayer?.getRoomCode() || 'OFFLINE'}`,
      objective: `Multiplayer - ${this.multiplayer?.getPlayers().length || 1} players // T to chat // F5 perspective`,
      hints: ['Multiplayer active - cooperate to survive', 'T opens chat', 'Shooting range at 10,45 for practice', 'F5 toggles perspective for all'],
      coordinates: `${this.player.position.x.toFixed(1)} / ${this.player.position.y.toFixed(1)} / ${this.player.position.z.toFixed(1)}`,
      showCoordinates: true,
    });

    const healthRatio = 1 - this.player.health / 100;
    const threat = this.getNearestThreat();
    const distance = threat ? threat.distance : 99;
    this.audio.update(dt, this.player.fear + Math.max(0, 1 - distance / 18) * 0.5, healthRatio);
    this.audio.setMusicState(this.getMusicState(distance));
  }

  private handleShoot(): void {
    if (this.mpChatVisible) return; // Don't shoot while chatting

    const origin = this.player.position.clone().add(new Vector3(0, this.player.isThirdPerson() ? 1.1 : 1.74, 0));
    // Direction from camera
    const dir = new Vector3(0, 0, -1);
    dir.applyQuaternion(this.player.camera.quaternion);
    dir.normalize();

    const result = this.weapon.shoot(
      origin,
      dir,
      this.facility,
      this.shootingRange,
      this.audio,
      this.player.camera,
    );

    if (result.hit && result.targetId) {
      this.ui.flashNotice(`HIT! +${this.shootingRange?.targets.find(t=>t.id===result.targetId)?.scoreValue || 10} // ${result.targetId}`);
      if (this.multiplayer) {
        this.multiplayer.sendTargetHit(result.targetId, this.shootingRange?.targets.find(t=>t.id===result.targetId)?.scoreValue || 10);
        this.multiplayer.sendShoot(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: dir.x, y: dir.y, z: dir.z },
          result.point ? { x: result.point.x, y: result.point.y, z: result.point.z } : undefined,
          result.targetId,
        );
      }
    } else {
      if (this.multiplayer) {
        this.multiplayer.sendShoot(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: dir.x, y: dir.y, z: dir.z },
          result.point ? { x: result.point.x, y: result.point.y, z: result.point.z } : undefined,
        );
      }
    }

    // Auto reload if empty
    if (this.weapon.ammo <= 0) {
      setTimeout(() => {
        this.weapon.reload();
        this.ui.flashNotice('RELOADED // 30 / 30');
      }, 800);
    }
  }

  private updateRemotePlayers(_dt: number): void {
    if (!this.multiplayer) return;
    const players = this.multiplayer.getPlayers();
    const myId = this.multiplayer.getPlayerId();

    for (const p of players) {
      if (p.id === myId) continue;
      if (!p.position) continue;

      let entry = this.mpPlayers.get(p.id);
      if (!entry) {
        const group = new Group();
        const body = new Mesh(
          new CylinderGeometry(0.32, 0.32, 1.72, 12),
          new MeshStandardMaterial({ color: p.isHost ? 0x5ab8ff : 0x2a3442, roughness: 0.7 }),
        );
        body.position.y = 0.86;
        body.castShadow = true;
        group.add(body);
        const head = new Mesh(
          new SphereGeometry(0.22, 12, 10),
          new MeshStandardMaterial({ color: 0x1a222e }),
        );
        head.position.y = 1.62;
        group.add(head);
        this.facility.root.add(group);
        entry = { mesh: group, lastPos: new Vector3(p.position.x, p.position.y, p.position.z) };
        this.mpPlayers.set(p.id, entry);
      }

      const targetPos = new Vector3(p.position.x, p.position.y, p.position.z);
      entry.mesh.position.lerp(targetPos, 0.2);
      if (p.yaw !== undefined) {
        entry.mesh.rotation.y = p.yaw;
      }
    }

    const activeIds = new Set(players.map(p=>p.id));
    for (const [id, entry] of this.mpPlayers) {
      if (!activeIds.has(id)) {
        this.facility.root.remove(entry.mesh);
        this.mpPlayers.delete(id);
      }
    }
  }

  private toggleMPChat(): void {
    this.mpChatVisible = !this.mpChatVisible;
    this.ui.showMPChat(this.mpChatVisible);
    if (this.mpChatVisible) {
      this.input.exitPointerLock();
      const chatInput = document.getElementById('mp-chat-input') as HTMLInputElement;
      chatInput?.focus();
    } else {
      this.input.requestPointerLock();
    }
  }

  private getNearestThreat(): { distance: number; position: Vector3 } | null {
    let best: { distance: number; position: Vector3 } | null = null;
    if (this.suppressor?.active) {
      best = { distance: this.suppressor.getDistanceToPlayer(this.player), position: this.suppressor.root.position };
    }
    for (const monster of this.monsters) {
      if (!monster.active) {
        continue;
      }
      const distance = monster.getDistanceToPlayer(this.player);
      if (!best || distance < best.distance) {
        best = { distance, position: monster.root.position };
      }
    }
    for (const boss of this.bosses) {
      if (!boss.active) continue;
      const distance = boss.getDistanceToPlayer(this.player);
      if (!best || distance < best.distance) {
        best = { distance, position: boss.root.position };
      }
    }
    return best;
  }

  /** Short contextual tips for the top-right hint stack (max 3, most urgent first). */
  private collectHints(zoneId: string): string[] {
    const hints: string[] = [];
    const threat = this.getNearestThreat();
    if (threat && threat.distance < 9) {
      hints.push('Danger is close — crouch (CTRL) and break line of sight.');
    } else if (this.player.hiddenSpot) {
      hints.push('Stay still while hidden — they hunt by movement and sound.');
    }
    if (!this.progress.flashlightFound) {
      hints.push('Search the room — something on the shelf is glinting.');
    } else if (this.player.flashlightOn && this.player.flashlightBattery <= 25) {
      hints.push('Battery low — find an industrial battery (yellow) or a wall charger.');
    }
    switch (this.currentObjectiveId) {
      case 'restoreResearchPower':
        hints.push(this.player.inventory.has('fuse-main')
          ? 'Fuse in hand — seat it in ROUTING PANEL B in Maintenance.'
          : 'Maintenance: throw the three breakers and find the missing fuse.');
        break;
      case 'accessResearch':
        hints.push('Research is powered — the terminal waits at the back of the lab.');
        break;
      case 'reachLevel2':
        hints.push(this.player.inventory.has('keycard-level-2')
          ? 'Level 2 card in hand — the sealed door is north of Security.'
          : 'The Level 2 card is filed at the Security desk.');
        break;
      case 'recoverFootage':
        hints.push('The Chamber 4 footage sits on a desk in the Observation Deck.');
        break;
      case 'unlockUnderground':
        hints.push(this.progress.archiveCodeFound
          ? 'Archive code 4138 — enter it at the blast keypad by the tunnel.'
          : 'Find the archive code in the Research notes.');
        break;
      case 'findCoreKey':
        hints.push('The Suppression Core keycard is somewhere in the Underground.');
        break;
      case 'reachCore':
        hints.push('The Level 3 card is kept in the lower shelter.');
        break;
      case 'enterLevel3':
        hints.push('Descend through the shelter — Level 3 storage lies south.');
        break;
      case 'escape':
        hints.push('Choose stabilize or purge at the core terminal, then get out.');
        break;
      default:
        break;
    }
    if (hints.length < 2) {
      hints.push('TAB inventory · F lamp · SHIFT sprint · CTRL crouch');
    }
    if (hints.length < 2 && zoneId === 'lobby') {
      hints.push('East doors: Maintenance (south) and Research (north).');
    }
    return hints.slice(0, 3);
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
    // F5 perspective toggle - works in ALL gamemodes, including menus (except when typing)
    if (this.perspectiveToggleCooldown <= 0) {
      if (this.input.consumeActionPress('perspective' as any)) {
        this.player.togglePerspective();
        this.ui.flashNotice(`Perspective: ${this.player.perspective.toUpperCase()} // F5 to toggle`);
        this.perspectiveToggleCooldown = 0.3;
        this.audio.playUiBeep();
        // Update HUD indicator
        if (this.shootingRange) {
          const score = this.shootingRange.getScore();
          this.ui.updateShootingHud(score.score, this.weapon.ammo, this.weapon.maxAmmo, score.accuracy, score.hits, score.shots, this.player.perspective);
        }
      }
    }

    if (this.input.consumeActionPress('debug')) {
      this.showDebug = !this.showDebug;
    }
    if (this.input.consumeActionPress('enemyDebug')) {
      this.showEnemyDebug = !this.showEnemyDebug;
      this.ui.flashNotice(`Enemy debug ${this.showEnemyDebug ? 'enabled' : 'disabled'}.`);
    }
    if (this.input.consumeActionPress('teleportDebug') && this.showDebug) {
      const zones = [new Vector3(20, 0, 0), new Vector3(40, 0, 18), new Vector3(48, 0, -6), new Vector3(74, 0, 8), new Vector3(104, 0, -6), new Vector3(20, 0, -34), new Vector3(74, 0, 27), new Vector3(10, 0, 45)];
      const index = Math.floor(Math.random() * zones.length);
      this.player.position.copy(zones[index]);
      this.ui.flashNotice('Debug teleport executed.');
    }

    if (this.state === GameState.PLAYING || this.state === GameState.SHOOTING_RANGE || this.state === GameState.MULTIPLAYER) {
      if (this.input.consumeActionPress('pause')) {
        this.previousState = this.state;
        this.state = GameState.PAUSED;
        this.ui.showPause(true);
        this.input.exitPointerLock();
        return;
      }
      if (this.input.consumeActionPress('inventory') && this.state === GameState.PLAYING) {
        this.toggleInventory(false);
        return;
      }
      if (this.input.consumeActionPress('flashlight') && this.progress.flashlightFound) {
        this.player.toggleFlashlight(this.audio);
      }
      // Chat toggle in multiplayer
      if (this.state === GameState.MULTIPLAYER && this.input.consumeActionPress('chat' as any)) {
        this.toggleMPChat();
        return;
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

  private applyResolution(): void {
    const scale = this.settings.graphics.resolutionScale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale * this.adaptiveScale);
    this.onResize();
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

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * graphics.resolutionScale * this.adaptiveScale);
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
