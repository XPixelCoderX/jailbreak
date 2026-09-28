import { GAME_TITLE, LINKS, MAX_BRIGHTNESS, type QualityLevel } from '../config/constants';
import { getPreset, QUALITY_PRESETS } from '../render/QualityPresets';
import type { InputManager, ActionName } from '../core/InputManager';
import type { SaveSlotSummary } from '../core/SaveManager';
import type { DebugInfo, GameSettings, InventoryItemData, Objective, SecurityCameraDefinition, TerminalDefinition } from '../types';

interface TerminalRuntime {
  terminal: TerminalDefinition;
  selectedCamera: string | null;
  selectedFile: number;
  loggedIn: boolean;
}

export class UIManager {
  public onNewGame: (() => void) | null = null;
  public onContinue: (() => void) | null = null;
  public onOpenLoad: (() => void) | null = null;
  public onOpenSettingsFromMenu: (() => void) | null = null;
  public onOpenCredits: (() => void) | null = null;
  public onQuit: (() => void) | null = null;
  public onResume: (() => void) | null = null;
  public onOpenInventory: (() => void) | null = null;
  public onOpenObjectives: (() => void) | null = null;
  public onOpenSettingsFromPause: (() => void) | null = null;
  public onSaveGame: (() => void) | null = null;
  public onReturnToMenu: (() => void) | null = null;
  public onRetry: (() => void) | null = null;
  public onLoadCheckpoint: (() => void) | null = null;
  public onDeathMenu: (() => void) | null = null;
  public onApplySettings: ((settings: GameSettings) => void) | null = null;
  public onCloseSettings: (() => void) | null = null;
  public onLoadSlot: ((slot: number) => void) | null = null;
  public onCloseSaveLoad: (() => void) | null = null;
  public onSaveSlot: ((slot: number) => void) | null = null;
  public onTerminalAction: ((actionId: string) => void) | null = null;
  public onTerminalLogin: ((username: string, password: string) => boolean) | null = null;
  public onCloseTerminal: (() => void) | null = null;
  public onKeypadSubmit: ((value: string) => void) | null = null;
  public onCloseKeypad: (() => void) | null = null;
  public onCloseDocument: (() => void) | null = null;
  public onDismissEnding: (() => void) | null = null;

  public readonly root: HTMLElement;
  public readonly gameViewport: HTMLDivElement;
  public readonly overlay: HTMLDivElement;
  public readonly terminalCameraCanvas: HTMLCanvasElement;

  private readonly loadingProgress: HTMLDivElement;
  private readonly loadingLabel: HTMLDivElement;
  private readonly loadingWarning: HTMLDivElement;
  private readonly loadingScreen: HTMLDivElement;
  private readonly mainMenu: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly objective: HTMLDivElement;
  private readonly objectivePanel: HTMLDivElement;
  private readonly inventoryPanel: HTMLDivElement;
  private readonly pauseMenu: HTMLDivElement;
  private readonly creditsPanel: HTMLDivElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly subtitleSpeaker: HTMLDivElement;
  private readonly subtitleText: HTMLDivElement;
  private readonly subtitleBox: HTMLDivElement;
  private readonly documentPanel: HTMLDivElement;
  private readonly terminalPanel: HTMLDivElement;
  private readonly terminalFiles: HTMLDivElement;
  private readonly terminalFileBody: HTMLDivElement;
  private readonly terminalCameraButtons: HTMLDivElement;
  private readonly terminalCameraLabel: HTMLDivElement;
  private readonly terminalActionButtons: HTMLDivElement;
  private readonly terminalLoginForm: HTMLFormElement;
  private readonly keypadPanel: HTMLDivElement;
  private readonly keypadInput: HTMLInputElement;
  private readonly saveLoadPanel: HTMLDivElement;
  private readonly saveLoadList: HTMLDivElement;
  private readonly deathPanel: HTMLDivElement;
  private readonly endingPanel: HTMLDivElement;
  private readonly inventoryList: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private readonly debugPanel: HTMLDivElement;
  private readonly filmGrain: HTMLDivElement;
  private readonly vignette: HTMLDivElement;

  private readonly batteryValue: HTMLDivElement;
  private readonly batteryLow: HTMLDivElement;
  private readonly healthValue: HTMLDivElement;
  private readonly staminaValue: HTMLDivElement;
  private readonly zoneValue: HTMLDivElement;

  private subtitleTimer = 0;
  private saveMode: 'save' | 'load' = 'load';
  private terminalRuntime: TerminalRuntime | null = null;
  private pendingSettings: GameSettings;
  private readonly settingsInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  constructor(container: HTMLElement, private readonly input: InputManager, settings: GameSettings) {
    this.pendingSettings = JSON.parse(JSON.stringify(settings)) as GameSettings;
    this.root = container;
    this.root.className = 'app-root';
    this.root.innerHTML = this.template();

    this.gameViewport = this.root.querySelector<HTMLDivElement>('#game-viewport')!;
    this.overlay = this.root.querySelector<HTMLDivElement>('#overlay')!;
    this.loadingScreen = this.root.querySelector<HTMLDivElement>('#loading-screen')!;
    this.loadingProgress = this.root.querySelector<HTMLDivElement>('#loading-progress-fill')!;
    this.loadingLabel = this.root.querySelector<HTMLDivElement>('#loading-label')!;
    this.loadingWarning = this.root.querySelector<HTMLDivElement>('#loading-warning')!;
    this.mainMenu = this.root.querySelector<HTMLDivElement>('#main-menu')!;
    this.hud = this.root.querySelector<HTMLDivElement>('#hud')!;
    this.prompt = this.root.querySelector<HTMLDivElement>('#interaction-prompt')!;
    this.objective = this.root.querySelector<HTMLDivElement>('#objective-text')!;
    this.objectivePanel = this.root.querySelector<HTMLDivElement>('#objective-panel')!;
    this.inventoryPanel = this.root.querySelector<HTMLDivElement>('#inventory-panel')!;
    this.pauseMenu = this.root.querySelector<HTMLDivElement>('#pause-menu')!;
    this.creditsPanel = this.root.querySelector<HTMLDivElement>('#credits-panel')!;
    this.settingsPanel = this.root.querySelector<HTMLDivElement>('#settings-panel')!;
    this.subtitleBox = this.root.querySelector<HTMLDivElement>('#subtitle-box')!;
    this.subtitleSpeaker = this.root.querySelector<HTMLDivElement>('#subtitle-speaker')!;
    this.subtitleText = this.root.querySelector<HTMLDivElement>('#subtitle-text')!;
    this.documentPanel = this.root.querySelector<HTMLDivElement>('#document-panel')!;
    this.terminalPanel = this.root.querySelector<HTMLDivElement>('#terminal-panel')!;
    this.terminalFiles = this.root.querySelector<HTMLDivElement>('#terminal-files')!;
    this.terminalFileBody = this.root.querySelector<HTMLDivElement>('#terminal-file-body')!;
    this.terminalCameraButtons = this.root.querySelector<HTMLDivElement>('#terminal-camera-buttons')!;
    this.terminalCameraLabel = this.root.querySelector<HTMLDivElement>('#terminal-camera-label')!;
    this.terminalActionButtons = this.root.querySelector<HTMLDivElement>('#terminal-actions')!;
    this.terminalCameraCanvas = this.root.querySelector<HTMLCanvasElement>('#terminal-camera-canvas')!;
    this.terminalLoginForm = this.root.querySelector<HTMLFormElement>('#terminal-login-form')!;
    this.keypadPanel = this.root.querySelector<HTMLDivElement>('#keypad-panel')!;
    this.keypadInput = this.root.querySelector<HTMLInputElement>('#keypad-input')!;
    this.saveLoadPanel = this.root.querySelector<HTMLDivElement>('#save-load-panel')!;
    this.saveLoadList = this.root.querySelector<HTMLDivElement>('#save-load-list')!;
    this.deathPanel = this.root.querySelector<HTMLDivElement>('#death-panel')!;
    this.endingPanel = this.root.querySelector<HTMLDivElement>('#ending-panel')!;
    this.inventoryList = this.root.querySelector<HTMLDivElement>('#inventory-list')!;
    this.notice = this.root.querySelector<HTMLDivElement>('#notice')!;
    this.debugPanel = this.root.querySelector<HTMLDivElement>('#debug-overlay')!;
    this.filmGrain = this.root.querySelector<HTMLDivElement>('#film-grain')!;
    this.vignette = this.root.querySelector<HTMLDivElement>('#vignette')!;

    this.batteryValue = this.root.querySelector<HTMLDivElement>('#battery-value')!;
    this.batteryLow = this.root.querySelector<HTMLDivElement>('#battery-low')!;
    this.healthValue = this.root.querySelector<HTMLDivElement>('#health-value')!;
    this.staminaValue = this.root.querySelector<HTMLDivElement>('#stamina-value')!;
    this.zoneValue = this.root.querySelector<HTMLDivElement>('#zone-value')!;

    this.bindMenu();
    this.buildSettingsPanel(settings);
    this.hideAllPopups();
    this.showLoading(true);
  }

  public setLoading(progress: number, label: string, warning: string): void {
    const clamped = Math.max(0, Math.min(progress, 1));
    this.loadingProgress.style.width = `${clamped * 100}%`;
    this.loadingLabel.textContent = `${label} ${Math.round(clamped * 100)}%`;
    this.loadingWarning.textContent = warning;
  }

  public showLoading(show: boolean): void {
    this.loadingScreen.classList.toggle('hidden', !show);
  }

  public showMainMenu(show: boolean): void {
    this.mainMenu.classList.toggle('hidden', !show);
  }

  public showHUD(show: boolean): void {
    this.hud.classList.toggle('hidden', !show);
  }

  public showPause(show: boolean): void {
    this.pauseMenu.classList.toggle('hidden', !show);
  }

  public showCredits(show: boolean): void {
    this.creditsPanel.classList.toggle('hidden', !show);
  }

  public showSettings(show: boolean): void {
    this.settingsPanel.classList.toggle('hidden', !show);
  }

  public showInventory(items: InventoryItemData[], visible: boolean): void {
    this.inventoryPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      return;
    }
    if (items.length === 0) {
      this.inventoryList.innerHTML = '<div class="inventory-empty">Inventory is empty.</div>';
      return;
    }
    this.inventoryList.innerHTML = items
      .map(
        (item) => `
          <article class="inventory-item">
            <header>
              <h4>${item.name}</h4>
              <span>x${item.quantity}</span>
            </header>
            <p class="inventory-type">${item.type.toUpperCase()}</p>
            <p>${item.description}</p>
          </article>
        `,
      )
      .join('');
  }

  public showObjectives(objectives: Objective[], visible: boolean): void {
    this.objectivePanel.classList.toggle('hidden', !visible);
    if (!visible) {
      return;
    }
    this.objectivePanel.querySelector('.panel-scroll')!.innerHTML = objectives
      .map(
        (objective) => `
          <div class="objective-entry ${objective.completed ? 'complete' : ''}">
            <span>${objective.completed ? '■' : '□'}</span>
            <span>${objective.title}</span>
          </div>
        `,
      )
      .join('');
  }

  public updateHUD(values: { battery: number; lowBattery: boolean; health: number; stamina: number; zone: string; objective: string }): void {
    this.batteryValue.textContent = `${Math.round(values.battery)}%`;
    this.batteryLow.classList.toggle('hidden', !values.lowBattery);
    this.healthValue.textContent = `${Math.round(values.health)}%`;
    this.staminaValue.textContent = `${Math.round(values.stamina)}%`;
    this.zoneValue.textContent = values.zone;
    this.objective.textContent = values.objective;
  }

  public setPrompt(text: string | null): void {
    this.prompt.textContent = text ?? '';
    this.prompt.classList.toggle('hidden', !text);
  }

  public flashNotice(text: string): void {
    this.notice.textContent = text;
    this.notice.classList.remove('hidden');
    window.clearTimeout(Number(this.notice.dataset.timeout ?? '0'));
    const handle = window.setTimeout(() => this.notice.classList.add('hidden'), 3000);
    this.notice.dataset.timeout = String(handle);
  }

  public pushSubtitle(speaker: string, text: string, duration: number): void {
    this.subtitleSpeaker.textContent = speaker;
    this.subtitleText.textContent = text;
    this.subtitleTimer = duration;
    this.subtitleBox.classList.remove('hidden');
  }

  public updateSubtitles(dt: number): void {
    if (this.subtitleTimer <= 0) {
      return;
    }
    this.subtitleTimer -= dt;
    if (this.subtitleTimer <= 0) {
      this.subtitleBox.classList.add('hidden');
    }
  }

  public setSubtitleScale(size: number): void {
    this.subtitleBox.style.setProperty('--subtitle-scale', String(size));
  }

  public setOverlayEffects(fear: number, damage: number, brightness: number, effectsEnabled: boolean): void {
    this.root.style.setProperty('--brightness', String(brightness));
    this.filmGrain.style.opacity = effectsEnabled ? String(0.05 + fear * 0.12) : '0';
    this.vignette.style.opacity = effectsEnabled ? String(0.3 + fear * 0.3 + damage * 0.2) : '0.15';
  }

  public openDocument(title: string, body: string): void {
    this.documentPanel.classList.remove('hidden');
    this.documentPanel.querySelector<HTMLHeadingElement>('h3')!.textContent = title;
    this.documentPanel.querySelector<HTMLDivElement>('.document-body')!.textContent = body;
  }

  public closeDocument(): void {
    this.documentPanel.classList.add('hidden');
  }

  public openTerminal(terminal: TerminalDefinition, loggedIn: boolean, cameras: SecurityCameraDefinition[]): void {
    this.terminalRuntime = {
      terminal,
      selectedCamera: cameras[0]?.id ?? null,
      selectedFile: 0,
      loggedIn,
    };
    this.terminalPanel.classList.remove('hidden');
    this.terminalPanel.querySelector<HTMLHeadingElement>('h3')!.textContent = terminal.name;
    this.renderTerminal();
  }

  public closeTerminal(): void {
    this.terminalPanel.classList.add('hidden');
    this.terminalRuntime = null;
  }

  public getSelectedCamera(): string | null {
    return this.terminalRuntime?.selectedCamera ?? null;
  }

  public openKeypad(title: string): void {
    this.keypadPanel.classList.remove('hidden');
    this.keypadPanel.querySelector<HTMLHeadingElement>('h3')!.textContent = title;
    this.keypadInput.value = '';
  }

  public closeKeypad(): void {
    this.keypadPanel.classList.add('hidden');
  }

  public showSaveLoad(slots: SaveSlotSummary[], mode: 'save' | 'load', visible: boolean): void {
    this.saveMode = mode;
    this.saveLoadPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      return;
    }
    this.saveLoadPanel.querySelector<HTMLHeadingElement>('h3')!.textContent = mode === 'save' ? 'Save Game' : 'Load Game';
    this.saveLoadList.innerHTML = slots
      .map((slot) => `
        <button class="slot-button" data-slot="${slot.slot}">
          <span>Slot ${slot.slot}</span>
          <strong>${slot.exists ? slot.label : 'Empty Slot'}</strong>
          <small>${slot.exists ? new Date(slot.timestamp).toLocaleString() : 'No data saved'}</small>
        </button>
      `)
      .join('');
    this.saveLoadList.querySelectorAll<HTMLButtonElement>('.slot-button').forEach((button) => {
      button.addEventListener('click', () => {
        const slot = Number(button.dataset.slot ?? '1');
        if (this.saveMode === 'save') {
          this.onSaveSlot?.(slot);
        } else {
          this.onLoadSlot?.(slot);
        }
      });
    });
  }

  public showDeath(show: boolean): void {
    this.deathPanel.classList.toggle('hidden', !show);
  }

  public showEnding(title: string, body: string): void {
    this.endingPanel.classList.remove('hidden');
    this.endingPanel.querySelector<HTMLHeadingElement>('h2')!.textContent = title;
    this.endingPanel.querySelector<HTMLDivElement>('p')!.textContent = body;
  }

  public hideEnding(): void {
    this.endingPanel.classList.add('hidden');
  }

  public setDebugInfo(info: DebugInfo, visible: boolean): void {
    this.debugPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      return;
    }
    this.debugPanel.innerHTML = `
      <div>FPS: ${info.fps}</div>
      <div>Draw Calls: ${info.drawCalls}</div>
      <div>Triangles: ${info.triangles}</div>
      <div>Player: ${info.position}</div>
      <div>Zone: ${info.zone}</div>
      <div>Objective: ${info.objective}</div>
      <div>Enemy: ${info.enemyState}</div>
      <div>Assets: ${info.assets}</div>
    `;
  }

  public applySettings(settings: GameSettings): void {
    this.pendingSettings = JSON.parse(JSON.stringify(settings)) as GameSettings;
    this.refreshSettingsInputs();
    this.setSubtitleScale(settings.accessibility.subtitleSize);
    const note = this.root.querySelector<HTMLParagraphElement>('#quality-note');
    if (note) {
      const preset = getPreset(settings.graphics.quality);
      note.textContent = `${preset.label} — ${preset.description}`;
    }
  }

  private refreshSettingsInputs(): void {
    for (const [key, input] of this.settingsInputs) {
      const value = this.getSettingByPath(key, this.pendingSettings);
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = String(value);
      }
    }
  }

  private renderTerminal(): void {
    if (!this.terminalRuntime) {
      return;
    }
    const { terminal, selectedFile, selectedCamera, loggedIn } = this.terminalRuntime;
    this.terminalLoginForm.classList.toggle('hidden', loggedIn || !terminal.username);
    this.terminalPanel.querySelector<HTMLDivElement>('.terminal-shell')!.classList.toggle('locked', !loggedIn && Boolean(terminal.username));
    const contentVisible = loggedIn || !terminal.username;
    this.terminalFiles.innerHTML = contentVisible
      ? terminal.files
          .map(
            (file, index) => `
              <button class="terminal-tab ${index === selectedFile ? 'active' : ''}" data-index="${index}">${file.title}</button>
            `,
          )
          .join('')
      : '';

    this.terminalFiles.querySelectorAll<HTMLButtonElement>('.terminal-tab').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.terminalRuntime) {
          return;
        }
        this.terminalRuntime.selectedFile = Number(button.dataset.index ?? '0');
        this.renderTerminal();
      });
    });

    this.terminalFileBody.textContent = contentVisible ? terminal.files[selectedFile]?.body ?? '' : 'Authentication required.';

    this.terminalCameraButtons.innerHTML = contentVisible
      ? terminal.cameras
          .map(
            (cameraId) => `
              <button class="terminal-camera-btn ${selectedCamera === cameraId ? 'active' : ''}" data-camera="${cameraId}">${cameraId.replace('-', ' ').toUpperCase()}</button>
            `,
          )
          .join('')
      : '';

    this.terminalCameraButtons.querySelectorAll<HTMLButtonElement>('.terminal-camera-btn').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.terminalRuntime) {
          return;
        }
        this.terminalRuntime.selectedCamera = button.dataset.camera ?? null;
        this.renderTerminal();
      });
    });

    const selectedCameraInfo = selectedCamera ? terminal.cameras.find((cameraId) => cameraId === selectedCamera) : null;
    this.terminalCameraLabel.textContent = selectedCameraInfo ? `LIVE FEED // ${selectedCameraInfo}` : 'NO CAMERA FEED';

    this.terminalActionButtons.innerHTML = contentVisible
      ? terminal.actions
          .map(
            (action) => `
              <button class="terminal-action-btn" data-action="${action.id}">
                <strong>${action.label}</strong>
                <span>${action.description}</span>
              </button>
            `,
          )
          .join('')
      : '';
    this.terminalActionButtons.querySelectorAll<HTMLButtonElement>('.terminal-action-btn').forEach((button) => {
      button.addEventListener('click', () => this.onTerminalAction?.(button.dataset.action ?? ''));
    });
  }

  private bindMenu(): void {
    this.root.querySelector<HTMLButtonElement>('#new-game-button')!.addEventListener('click', () => this.onNewGame?.());
    this.root.querySelector<HTMLButtonElement>('#continue-button')!.addEventListener('click', () => this.onContinue?.());
    this.root.querySelector<HTMLButtonElement>('#load-game-button')!.addEventListener('click', () => this.onOpenLoad?.());
    this.root.querySelector<HTMLButtonElement>('#settings-button')!.addEventListener('click', () => this.onOpenSettingsFromMenu?.());
    this.root.querySelector<HTMLButtonElement>('#credits-button')!.addEventListener('click', () => this.onOpenCredits?.());
    this.root.querySelector<HTMLButtonElement>('#quit-button')!.addEventListener('click', () => this.onQuit?.());

    this.root.querySelector<HTMLButtonElement>('#resume-button')!.addEventListener('click', () => this.onResume?.());
    this.root.querySelector<HTMLButtonElement>('#pause-inventory-button')!.addEventListener('click', () => this.onOpenInventory?.());
    this.root.querySelector<HTMLButtonElement>('#pause-objectives-button')!.addEventListener('click', () => this.onOpenObjectives?.());
    this.root.querySelector<HTMLButtonElement>('#pause-settings-button')!.addEventListener('click', () => this.onOpenSettingsFromPause?.());
    this.root.querySelector<HTMLButtonElement>('#pause-save-button')!.addEventListener('click', () => this.onSaveGame?.());
    this.root.querySelector<HTMLButtonElement>('#pause-menu-button')!.addEventListener('click', () => this.onReturnToMenu?.());

    this.root.querySelector<HTMLButtonElement>('#credits-close-button')!.addEventListener('click', () => this.showCredits(false));
    this.root.querySelector<HTMLButtonElement>('#document-close-button')!.addEventListener('click', () => this.onCloseDocument?.());
    this.root.querySelector<HTMLButtonElement>('#terminal-close-button')!.addEventListener('click', () => this.onCloseTerminal?.());
    this.root.querySelector<HTMLButtonElement>('#keypad-close-button')!.addEventListener('click', () => this.onCloseKeypad?.());
    this.root.querySelector<HTMLButtonElement>('#save-load-close-button')!.addEventListener('click', () => this.onCloseSaveLoad?.());

    this.root.querySelector<HTMLButtonElement>('#retry-button')!.addEventListener('click', () => this.onRetry?.());
    this.root.querySelector<HTMLButtonElement>('#checkpoint-button')!.addEventListener('click', () => this.onLoadCheckpoint?.());
    this.root.querySelector<HTMLButtonElement>('#death-menu-button')!.addEventListener('click', () => this.onDeathMenu?.());
    this.root.querySelector<HTMLButtonElement>('#ending-close-button')!.addEventListener('click', () => this.onDismissEnding?.());

    this.terminalLoginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(this.terminalLoginForm);
      const success = this.onTerminalLogin?.(String(form.get('username') ?? ''), String(form.get('password') ?? '')) ?? false;
      if (success && this.terminalRuntime) {
        this.terminalRuntime.loggedIn = true;
        this.renderTerminal();
      }
    });

    this.root.querySelector<HTMLButtonElement>('#keypad-submit-button')!.addEventListener('click', () => {
      this.onKeypadSubmit?.(this.keypadInput.value);
    });
  }

  private buildSettingsPanel(settings: GameSettings): void {
    const graphicsContainer = this.root.querySelector<HTMLDivElement>('#settings-graphics')!;
    const audioContainer = this.root.querySelector<HTMLDivElement>('#settings-audio')!;
    const controlsContainer = this.root.querySelector<HTMLDivElement>('#settings-controls')!;
    const accessibilityContainer = this.root.querySelector<HTMLDivElement>('#settings-accessibility')!;

    const addRange = (container: HTMLElement, label: string, path: string, min: number, max: number, step: number): void => {
      const value = this.getSettingByPath(path, settings);
      const row = document.createElement('label');
      row.className = 'setting-row';
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-path="${path}" /><output>${value}</output>`;
      const input = row.querySelector<HTMLInputElement>('input')!;
      const output = row.querySelector<HTMLOutputElement>('output')!;
      input.addEventListener('input', () => {
        output.value = input.value;
        this.setSettingByPath(path, Number(input.value));
      });
      this.settingsInputs.set(path, input);
      container.append(row);
    };

    const addToggle = (container: HTMLElement, label: string, path: string): void => {
      const value = this.getSettingByPath(path, settings);
      const row = document.createElement('label');
      row.className = 'setting-row toggle';
      row.innerHTML = `<span>${label}</span><input type="checkbox" ${value ? 'checked' : ''} data-path="${path}" />`;
      const input = row.querySelector<HTMLInputElement>('input')!;
      input.addEventListener('change', () => this.setSettingByPath(path, input.checked));
      this.settingsInputs.set(path, input);
      container.append(row);
    };

    const addSelect = (
      container: HTMLElement,
      label: string,
      path: string,
      options: Array<string | [string, string]>,
      onChange?: (value: string) => void,
    ): void => {
      const value = this.getSettingByPath(path, settings);
      const normalized = options.map((option) => (Array.isArray(option) ? option : [option, option.toUpperCase()] as [string, string]));
      const row = document.createElement('label');
      row.className = 'setting-row';
      row.innerHTML = `<span>${label}</span><select data-path="${path}">${normalized.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${optionValue === value ? 'selected' : ''}>${optionLabel}</option>`).join('')}</select>`;
      const select = row.querySelector<HTMLSelectElement>('select')!;
      select.addEventListener('change', () => {
        this.setSettingByPath(path, select.value);
        onChange?.(select.value);
      });
      this.settingsInputs.set(path, select);
      container.append(row);
    };

    // Six quality tiers — picking one seeds every granular option below so
    // players can still fine-tune each value afterwards.
    addSelect(
      graphicsContainer,
      'Quality',
      'graphics.quality',
      [
        ['low', 'LOW'],
        ['medium', 'MEDIUM'],
        ['high', 'HIGH'],
        ['ultra', 'ULTRA'],
        ['extreme', 'EXTREME'],
        ['rtx', 'RTX · RAY-TRACED STYLE'],
      ],
      (value) => {
        const preset = QUALITY_PRESETS[value as QualityLevel] ?? QUALITY_PRESETS.high;
        this.setSettingByPath('graphics.shadowQuality', preset.shadowQuality);
        this.setSettingByPath('graphics.lightingQuality', preset.lightingQuality);
        this.setSettingByPath('graphics.reflectionQuality', preset.reflectionQuality);
        this.setSettingByPath('graphics.postProcessing', preset.postProcessing);
        this.setSettingByPath('graphics.bloom', preset.bloom);
        this.setSettingByPath('graphics.ambientOcclusion', preset.ambientOcclusion);
        this.setSettingByPath('graphics.volumetrics', preset.volumetrics);
        this.refreshSettingsInputs();
        const note = this.root.querySelector<HTMLParagraphElement>('#quality-note');
        if (note) {
          note.textContent = `${preset.label} — ${preset.description}`;
        }
      },
    );
    const qualityNote = document.createElement('p');
    qualityNote.className = 'setting-note';
    qualityNote.id = 'quality-note';
    qualityNote.textContent = `${getPreset(settings.graphics.quality).label} — ${getPreset(settings.graphics.quality).description}`;
    graphicsContainer.append(qualityNote);
    const rtxNote = document.createElement('p');
    rtxNote.className = 'setting-note muted';
    rtxNote.textContent = 'RTX tier = ray-traced style approximations (SSR, planar wet-floor mirrors, IBL probes, GTAO, volumetric shafts). No hardware ray tracing is required or claimed.';
    graphicsContainer.append(rtxNote);

    addSelect(graphicsContainer, 'Shadow Quality', 'graphics.shadowQuality', [['off', 'OFF'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]);
    addSelect(graphicsContainer, 'Lighting Quality', 'graphics.lightingQuality', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]);
    addSelect(graphicsContainer, 'Reflection Quality', 'graphics.reflectionQuality', [['off', 'OFF'], ['low', 'ENVIRONMENT'], ['medium', '+ WET FLOOR'], ['high', '+ SCREEN-SPACE']]);
    addToggle(graphicsContainer, 'Post-Processing', 'graphics.postProcessing');
    addToggle(graphicsContainer, 'Bloom', 'graphics.bloom');
    addToggle(graphicsContainer, 'Ambient Occlusion', 'graphics.ambientOcclusion');
    addToggle(graphicsContainer, 'Volumetric Lights', 'graphics.volumetrics');
    addRange(graphicsContainer, 'Resolution Scaling', 'graphics.resolutionScale', 0.5, 1.25, 0.05);
    addRange(graphicsContainer, 'View Distance', 'graphics.viewDistance', 0.7, 1.5, 0.05);
    addToggle(graphicsContainer, 'Effects', 'graphics.effects');
    addToggle(graphicsContainer, 'Fog', 'graphics.fog');
    addRange(graphicsContainer, 'Fog Density', 'graphics.fogDensity', 0, 1.5, 0.05);
    addToggle(graphicsContainer, 'Anti-aliasing', 'graphics.antialias');
    addRange(graphicsContainer, 'Brightness', 'graphics.brightness', 0.7, MAX_BRIGHTNESS, 0.01);

    addRange(audioContainer, 'Master Volume', 'audio.master', 0, 1, 0.01);
    addRange(audioContainer, 'Music Volume', 'audio.music', 0, 1, 0.01);
    addRange(audioContainer, 'SFX Volume', 'audio.sfx', 0, 1, 0.01);
    addRange(audioContainer, 'Ambient Volume', 'audio.ambient', 0, 1, 0.01);
    addRange(audioContainer, 'Voice Volume', 'audio.voice', 0, 1, 0.01);
    addRange(audioContainer, 'UI Volume', 'audio.ui', 0, 1, 0.01);

    addRange(controlsContainer, 'Mouse Sensitivity', 'controls.sensitivity', 0.001, 0.006, 0.0001);
    addToggle(controlsContainer, 'Invert Y', 'controls.invertY');
    addToggle(controlsContainer, 'Toggle Sprint', 'controls.toggleSprint');
    addToggle(controlsContainer, 'Toggle Crouch', 'controls.toggleCrouch');
    this.buildRebindRows(controlsContainer);

    addToggle(accessibilityContainer, 'Subtitles', 'accessibility.subtitles');
    addRange(accessibilityContainer, 'Subtitle Size', 'accessibility.subtitleSize', 0.8, 1.4, 0.05);
    addToggle(accessibilityContainer, 'Screen Shake', 'accessibility.screenShake');
    addToggle(accessibilityContainer, 'Flash Effects', 'accessibility.flashEffects');
    addRange(accessibilityContainer, 'Field of View', 'accessibility.fov', 60, 110, 1);

    this.root.querySelector<HTMLButtonElement>('#settings-apply-button')!.addEventListener('click', () => this.onApplySettings?.(this.pendingSettings));
    this.root.querySelector<HTMLButtonElement>('#settings-close-button')!.addEventListener('click', () => this.onCloseSettings?.());
  }

  private buildRebindRows(container: HTMLElement): void {
    const title = document.createElement('div');
    title.className = 'settings-subtitle';
    title.textContent = 'Key Remapping';
    container.append(title);
    const actions: ActionName[] = ['forward', 'back', 'left', 'right', 'sprint', 'crouch', 'interact', 'flashlight', 'inventory', 'pause'];
    for (const action of actions) {
      const row = document.createElement('div');
      row.className = 'setting-row binding';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = this.input.getDisplayBinding(action);
      button.addEventListener('click', async () => {
        button.textContent = 'Press key...';
        const code = await this.input.startRebind(action);
        if (code) {
          this.pendingSettings.controls.bindings[action] = code;
        }
        button.textContent = this.input.getDisplayBinding(action);
      });
      row.innerHTML = `<span>${this.input.getActionLabel(action)}</span>`;
      row.append(button);
      container.append(row);
    }
  }

  private hideAllPopups(): void {
    this.showMainMenu(false);
    this.showPause(false);
    this.showCredits(false);
    this.showSettings(false);
    this.showHUD(false);
    this.showInventory([], false);
    this.showObjectives([], false);
    this.closeDocument();
    this.closeTerminal();
    this.closeKeypad();
    this.showSaveLoad([], 'load', false);
    this.showDeath(false);
    this.hideEnding();
    this.notice.classList.add('hidden');
    this.debugPanel.classList.add('hidden');
    this.setPrompt(null);
    this.subtitleBox.classList.add('hidden');
  }

  private template(): string {
    return `
      <div id="game-viewport"></div>
      <div id="film-grain"></div>
      <div id="vignette"></div>
      <div id="overlay">
        <section id="loading-screen" class="screen-panel">
          <div class="title-block">
            <h1>${GAME_TITLE}</h1>
            <p>INITIALIZING CONTAINMENT SYSTEM...</p>
          </div>
          <div class="loading-bar"><div id="loading-progress-fill"></div></div>
          <div id="loading-label">0%</div>
          <div id="loading-warning">WARNING: SUPPRESSION FAILURE DETECTED</div>
        </section>

        <section id="main-menu" class="screen-panel hidden">
          <div class="menu-center">
            <p class="eyebrow">Made by Edwin Sheen</p>
            <h1>${GAME_TITLE}</h1>
            <nav class="main-nav">
              <button id="new-game-button">NEW GAME</button>
              <button id="continue-button">CONTINUE</button>
              <button id="load-game-button">LOAD GAME</button>
              <button id="settings-button">SETTINGS</button>
              <button id="credits-button">CREDITS</button>
              <button id="quit-button">QUIT</button>
            </nav>
          </div>
          <div class="menu-footer">
            <div class="footer-link left">
              <a href="${LINKS.website}" target="_blank" rel="noreferrer">WEBSITE</a>
              <span>pay.pcsmp.net</span>
            </div>
            <div class="footer-credit">Lost Suppression<br/>Made by Edwin Sheen</div>
            <div class="footer-link right">
              <a href="${LINKS.discord}" target="_blank" rel="noreferrer">DISCORD</a>
              <span>discord.gg/jqPt6a563h</span>
            </div>
          </div>
        </section>

        <section id="hud" class="hidden">
          <div class="hud-top-left">
            <div class="hud-block">
              <span class="label">HEALTH</span>
              <strong id="health-value">100%</strong>
            </div>
            <div class="hud-block">
              <span class="label">STAMINA</span>
              <strong id="stamina-value">100%</strong>
            </div>
          </div>
          <div class="hud-top-right">
            <div class="hud-block flashlight-block">
              <span class="label">FLASHLIGHT</span>
              <strong id="battery-value">100%</strong>
              <em id="battery-low" class="hidden">BATTERY LOW</em>
            </div>
            <div class="hud-block">
              <span class="label">ZONE</span>
              <strong id="zone-value">Intake Chamber</strong>
            </div>
          </div>
          <div id="objective-hud" class="hud-objective">
            <span class="label">OBJECTIVE</span>
            <strong id="objective-text">Wake up.</strong>
          </div>
          <div id="interaction-prompt" class="interaction-prompt hidden"></div>
          <div id="crosshair"></div>
        </section>

        <section id="pause-menu" class="modal hidden">
          <div class="panel narrow">
            <h2>PAUSED</h2>
            <div class="panel-buttons">
              <button id="resume-button">RESUME</button>
              <button id="pause-inventory-button">INVENTORY</button>
              <button id="pause-objectives-button">OBJECTIVES</button>
              <button id="pause-settings-button">SETTINGS</button>
              <button id="pause-save-button">SAVE</button>
              <button id="pause-menu-button">MAIN MENU</button>
            </div>
          </div>
        </section>

        <section id="credits-panel" class="modal hidden">
          <div class="panel">
            <h2>${GAME_TITLE}</h2>
            <div class="credit-copy">
              <p>GAME MADE BY</p>
              <h3>EDWIN SHEEN</h3>
              <p>SFX &amp; AUDIO BY</p>
              <h3>EDWIN SHEEN</h3>
            </div>
            <button id="credits-close-button">BACK</button>
          </div>
        </section>

        <section id="settings-panel" class="modal hidden">
          <div class="panel wide">
            <h2>SETTINGS</h2>
            <div class="settings-grid">
              <div>
                <h3>GRAPHICS</h3>
                <div id="settings-graphics"></div>
              </div>
              <div>
                <h3>AUDIO</h3>
                <div id="settings-audio"></div>
              </div>
              <div>
                <h3>CONTROLS</h3>
                <div id="settings-controls"></div>
              </div>
              <div>
                <h3>ACCESSIBILITY</h3>
                <div id="settings-accessibility"></div>
              </div>
            </div>
            <div class="panel-buttons horizontal">
              <button id="settings-apply-button">APPLY</button>
              <button id="settings-close-button">CLOSE</button>
            </div>
          </div>
        </section>

        <section id="inventory-panel" class="modal hidden">
          <div class="panel wide">
            <h2>INVENTORY</h2>
            <div id="inventory-list" class="panel-scroll"></div>
          </div>
        </section>

        <section id="objective-panel" class="modal hidden">
          <div class="panel">
            <h2>OBJECTIVES</h2>
            <div class="panel-scroll"></div>
          </div>
        </section>

        <section id="document-panel" class="modal hidden">
          <div class="panel document-panel">
            <h3>Document</h3>
            <div class="document-body panel-scroll"></div>
            <button id="document-close-button">CLOSE</button>
          </div>
        </section>

        <section id="terminal-panel" class="modal hidden">
          <div class="panel wide terminal-shell">
            <div class="terminal-header">
              <h3>TERMINAL</h3>
              <button id="terminal-close-button">DISCONNECT</button>
            </div>
            <form id="terminal-login-form" class="terminal-login hidden">
              <input name="username" type="text" placeholder="Username" />
              <input name="password" type="password" placeholder="Password" />
              <button type="submit">LOGIN</button>
            </form>
            <div class="terminal-grid">
              <div>
                <h4>FILES</h4>
                <div id="terminal-files" class="terminal-tabs"></div>
                <div id="terminal-file-body" class="terminal-file-body panel-scroll"></div>
              </div>
              <div>
                <h4>CAMERAS</h4>
                <div id="terminal-camera-buttons" class="terminal-tabs"></div>
                <div class="camera-panel">
                  <canvas id="terminal-camera-canvas" width="480" height="270"></canvas>
                  <div id="terminal-camera-label" class="camera-label">NO CAMERA FEED</div>
                </div>
                <h4>ACCESS</h4>
                <div id="terminal-actions" class="terminal-actions"></div>
              </div>
            </div>
          </div>
        </section>

        <section id="keypad-panel" class="modal hidden">
          <div class="panel narrow">
            <h3>KEYPAD</h3>
            <input id="keypad-input" type="text" maxlength="8" placeholder="Enter code" />
            <div class="panel-buttons horizontal">
              <button id="keypad-submit-button">SUBMIT</button>
              <button id="keypad-close-button">CLOSE</button>
            </div>
          </div>
        </section>

        <section id="save-load-panel" class="modal hidden">
          <div class="panel">
            <div class="terminal-header">
              <h3>Save / Load</h3>
              <button id="save-load-close-button">CLOSE</button>
            </div>
            <div id="save-load-list" class="slot-list"></div>
          </div>
        </section>

        <section id="death-panel" class="modal hidden">
          <div class="panel narrow death-panel">
            <h2>CONNECTION LOST</h2>
            <p>The facility swallowed the signal.</p>
            <div class="panel-buttons">
              <button id="retry-button">RETRY</button>
              <button id="checkpoint-button">LOAD CHECKPOINT</button>
              <button id="death-menu-button">MAIN MENU</button>
            </div>
          </div>
        </section>

        <section id="ending-panel" class="modal hidden">
          <div class="panel wide">
            <h2>ENDING</h2>
            <p></p>
            <button id="ending-close-button">RETURN TO MENU</button>
          </div>
        </section>

        <div id="subtitle-box" class="subtitle hidden">
          <div id="subtitle-speaker"></div>
          <div id="subtitle-text"></div>
        </div>

        <div id="notice" class="notice hidden"></div>
        <div id="debug-overlay" class="hidden"></div>
      </div>
    `;
  }

  private getSettingByPath(path: string, settings: GameSettings): unknown {
    return path.split('.').reduce<unknown>((current, key) => (current as Record<string, unknown>)[key], settings as unknown);
  }

  private setSettingByPath(path: string, value: unknown): void {
    const keys = path.split('.');
    let target = this.pendingSettings as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length - 1; index += 1) {
      target = target[keys[index]] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = value;
  }
}
