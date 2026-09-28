import type { GameSettings } from '../types';

export type ActionName =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'interact'
  | 'flashlight'
  | 'inventory'
  | 'pause'
  | 'debug'
  | 'enemyDebug'
  | 'teleportDebug';

const ACTION_LABELS: Record<ActionName, string> = {
  forward: 'Move Forward',
  back: 'Move Backward',
  left: 'Move Left',
  right: 'Move Right',
  sprint: 'Sprint',
  crouch: 'Crouch',
  interact: 'Interact',
  flashlight: 'Flashlight',
  inventory: 'Inventory',
  pause: 'Pause',
  debug: 'Debug Overlay',
  enemyDebug: 'Enemy Debug',
  teleportDebug: 'Teleport Debug',
};

export class InputManager {
  private readonly keysDown = new Set<string>();
  private readonly justPressed = new Set<string>();
  private pointerLocked = false;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private sprintToggled = false;
  private crouchToggled = false;
  private rebindResolve: ((code: string | null) => void) | null = null;
  private bindings: Record<string, string>;

  constructor(private readonly target: HTMLElement, settings: GameSettings) {
    this.bindings = { ...settings.controls.bindings };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('blur', this.onBlur);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.onBlur);
  }

  public requestPointerLock(): void {
    if (document.pointerLockElement !== this.target) {
      this.target.requestPointerLock().catch(() => undefined);
    }
  }

  public exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public updateSettings(settings: GameSettings): void {
    this.bindings = { ...settings.controls.bindings };
  }

  public getMouseDelta(): { x: number; y: number } {
    return { x: this.mouseDeltaX, y: this.mouseDeltaY };
  }

  public endFrame(settings: GameSettings): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.justPressed.clear();
    if (!settings.controls.toggleSprint) {
      this.sprintToggled = false;
    }
    if (!settings.controls.toggleCrouch) {
      this.crouchToggled = false;
    }
  }

  public isActionDown(action: ActionName, settings: GameSettings): boolean {
    const code = this.bindings[action];
    if (!code) {
      return false;
    }

    if (action === 'sprint' && settings.controls.toggleSprint) {
      return this.sprintToggled;
    }
    if (action === 'crouch' && settings.controls.toggleCrouch) {
      return this.crouchToggled;
    }

    return this.keysDown.has(code);
  }

  public wasActionPressed(action: ActionName): boolean {
    const code = this.bindings[action];
    return code ? this.justPressed.has(code) : false;
  }

  public consumeKeyPress(code: string): boolean {
    if (!this.justPressed.has(code)) return false;
    this.justPressed.delete(code);
    return true;
  }

  public consumeActionPress(action: ActionName): boolean {
    const code = this.bindings[action];
    if (!code || !this.justPressed.has(code)) {
      return false;
    }
    this.justPressed.delete(code);
    return true;
  }

  public getBindings(): Record<string, string> {
    return { ...this.bindings };
  }

  public getActionLabel(action: ActionName): string {
    return ACTION_LABELS[action];
  }

  public getDisplayBinding(action: ActionName): string {
    const code = this.bindings[action] ?? '';
    return code.replace('Key', '').replace('Digit', '').replace('Arrow', '').replace('Left', '');
  }

  public async startRebind(action: ActionName): Promise<string | null> {
    if (this.rebindResolve) {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      this.rebindResolve = (code) => {
        if (code) {
          this.bindings[action] = code;
        }
        resolve(code);
      };
    });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.rebindResolve) {
      event.preventDefault();
      const resolver = this.rebindResolve;
      this.rebindResolve = null;
      resolver(event.code);
      return;
    }

    if (!this.keysDown.has(event.code)) {
      this.justPressed.add(event.code);
    }
    this.keysDown.add(event.code);

    if (event.code === this.bindings.inventory || event.code === this.bindings.pause || event.code === this.bindings.flashlight) {
      event.preventDefault();
    }

    if (event.code === this.bindings.sprint) {
      this.sprintToggled = !this.sprintToggled;
    }
    if (event.code === this.bindings.crouch) {
      this.crouchToggled = !this.crouchToggled;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) {
      return;
    }
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.target;
  };

  private readonly onBlur = (): void => {
    this.keysDown.clear();
  };
}
