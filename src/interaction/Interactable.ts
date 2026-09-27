import {
  Box3,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { Game } from '../game/Game';
import type { Collider, HideSpotView, InventoryItemData } from '../types';

export interface Interactable {
  id: string;
  object: Object3D;
  prompt: string;
  active: boolean;
  collider?: Collider;
  highlight(enabled: boolean): void;
  update(dt: number): void;
  canInteract(game: Game): boolean;
  interact(game: Game): void;
}

export abstract class BaseInteractable implements Interactable {
  public active = true;
  protected readonly highlightTargets: Mesh[] = [];
  protected readonly baseEmissive = new Map<Mesh, Color>();

  constructor(
    public readonly id: string,
    public readonly object: Object3D,
    public prompt: string,
    meshes: Mesh[] = [],
  ) {
    this.highlightTargets = meshes;
    for (const mesh of meshes) {
      const material = mesh.material;
      if (material instanceof MeshStandardMaterial) {
        this.baseEmissive.set(mesh, material.emissive.clone());
      }
    }
  }

  public highlight(enabled: boolean): void {
    for (const mesh of this.highlightTargets) {
      const material = mesh.material;
      if (!(material instanceof MeshStandardMaterial)) {
        continue;
      }
      const base = this.baseEmissive.get(mesh) ?? new Color(0x000000);
      material.emissive.copy(base);
      material.emissiveIntensity = enabled ? 1.3 : 0.15;
      if (enabled) {
        material.emissive.lerp(new Color(0x4d90ff), 0.65);
      }
    }
  }

  public update(_dt: number): void {
    // Optional in subclasses.
  }

  public canInteract(_game: Game): boolean {
    return this.active;
  }

  public abstract interact(game: Game): void;
}

export interface DoorOptions {
  locked?: boolean;
  keyId?: string;
  keycardId?: string;
  requiresPower?: boolean;
  automatic?: boolean;
  heavy?: boolean;
  broken?: boolean;
  strange?: boolean;
  openOutward?: boolean;
}

export class Door extends BaseInteractable {
  public readonly collider: Collider;
  public isOpen = false;
  public isLocked: boolean;
  public readonly panel: Group;
  private openAmount = 0;
  private targetOpenAmount = 0;
  private readonly openSpeed: number;

  constructor(
    id: string,
    object: Group,
    panel: Group,
    collider: Collider,
    private readonly options: DoorOptions = {},
  ) {
    const meshes: Mesh[] = [];
    panel.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, options.broken ? '[E] FORCE BROKEN DOOR' : '[E] OPEN DOOR', meshes);
    this.panel = panel;
    this.collider = collider;
    this.isLocked = Boolean(options.locked);
    this.openSpeed = options.heavy ? 0.75 : options.automatic ? 2.5 : 1.8;
  }

  public update(dt: number): void {
    this.openAmount = MathUtils.damp(this.openAmount, this.targetOpenAmount, this.openSpeed, dt);
    const direction = this.options.openOutward ? -1 : 1;
    this.panel.rotation.y = -Math.PI * 0.5 * this.openAmount * direction;
    this.collider.enabled = this.openAmount < 0.72;
    this.isOpen = this.openAmount > 0.7;
  }

  public canInteract(_game: Game): boolean {
    return this.active && !this.options.broken;
  }

  public interact(game: Game): void {
    if (this.options.broken) {
      game.audio.playUiError();
      game.ui.flashNotice('The frame is twisted shut.');
      return;
    }
    if (this.isLocked) {
      if (this.options.keyId && game.player.inventory.has(this.options.keyId)) {
        this.isLocked = false;
        game.ui.flashNotice('Mechanical key accepted.');
      } else if (this.options.keycardId && game.player.inventory.has(this.options.keycardId)) {
        this.isLocked = false;
        game.ui.flashNotice('Keycard access granted.');
      } else if (this.options.requiresPower && !game.progress.researchPowerRestored) {
        game.audio.playUiError();
        game.ui.flashNotice('Emergency seal: no routed power.');
        return;
      } else if (this.options.keyId || this.options.keycardId || this.options.requiresPower) {
        game.audio.playUiError();
        game.ui.flashNotice('Access denied.');
        return;
      }
    }

    this.targetOpenAmount = this.targetOpenAmount > 0.5 ? 0 : 1;
    this.prompt = this.targetOpenAmount > 0.5 ? '[E] CLOSE DOOR' : '[E] OPEN DOOR';
    game.audio.playDoor(this.options.heavy ?? false, this.targetOpenAmount > 0.5);
    game.notifyNoise(this.object.position, this.options.heavy ? 0.95 : 0.65);
  }

  public autoOpen(game: Game): void {
    if (!this.options.automatic || this.isLocked) {
      return;
    }
    const distance = game.player.position.distanceTo(this.object.position);
    this.targetOpenAmount = distance < 2.1 ? 1 : 0;
    this.prompt = this.targetOpenAmount > 0.5 ? '[E] CLOSE DOOR' : '[E] OPEN DOOR';
  }

  public slamShut(): void {
    this.targetOpenAmount = 0;
    this.openAmount = 0.2;
  }

  public forceUnlock(): void {
    this.isLocked = false;
  }

  public serialize(): { id: string; open: boolean; locked: boolean } {
    return {
      id: this.id,
      open: this.targetOpenAmount > 0.5,
      locked: this.isLocked,
    };
  }

  public applyState(state: { open: boolean; locked: boolean }): void {
    this.isLocked = state.locked;
    this.targetOpenAmount = state.open ? 1 : 0;
    this.openAmount = this.targetOpenAmount;
    this.collider.enabled = !state.open;
    this.isOpen = state.open;
    this.panel.rotation.y = -Math.PI * 0.5 * this.openAmount;
    this.prompt = state.open ? '[E] CLOSE DOOR' : '[E] OPEN DOOR';
  }
}

export class PickupInteractable extends BaseInteractable {
  constructor(
    id: string,
    object: Object3D,
    private readonly item: InventoryItemData,
    private readonly onPickup?: (game: Game, item: InventoryItemData) => void,
  ) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, '[E] PICK UP', meshes);
  }

  public interact(game: Game): void {
    if (!this.active) {
      return;
    }
    game.player.inventory.add(this.item);
    this.active = false;
    this.object.visible = false;
    this.object.parent?.remove(this.object);
    this.onPickup?.(game, this.item);
    game.audio.playPickup(this.item.type);
    game.ui.flashNotice(`Picked up ${this.item.name}.`);
  }
}

export class DocumentInteractable extends BaseInteractable {
  constructor(
    id: string,
    object: Object3D,
    private readonly title: string,
    private readonly body: string,
    private readonly storeAs?: InventoryItemData,
  ) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, '[E] READ', meshes);
  }

  public interact(game: Game): void {
    if (this.storeAs && !game.player.inventory.has(this.storeAs.id)) {
      game.player.inventory.add(this.storeAs);
      game.progress.evidenceCollected += 1;
    }
    game.openDocument(this.title, this.body);
    game.audio.playUiOpen();
  }
}

export class BreakerInteractable extends BaseInteractable {
  constructor(id: string, object: Object3D, private readonly breakerId: string, private readonly label: string) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, `[E] THROW ${label.toUpperCase()} BREAKER`, meshes);
  }

  public interact(game: Game): void {
    const alreadySet = game.puzzles.breakers[this.breakerId];
    if (alreadySet) {
      game.ui.flashNotice(`${this.label} breaker is already routed.`);
      game.audio.playUiBeep();
      return;
    }
    game.activateBreaker(this.breakerId, this.label);
    this.prompt = `[E] ${this.label.toUpperCase()} BREAKER ROUTED`;
  }
}

export class FuseBoxInteractable extends BaseInteractable {
  constructor(id: string, object: Object3D) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, '[E] INSERT FUSE', meshes);
  }

  public interact(game: Game): void {
    if (game.puzzles.fuseInserted) {
      game.ui.flashNotice('A fresh fuse is already seated.');
      return;
    }
    if (!game.player.inventory.has('fuse-main')) {
      game.audio.playUiError();
      game.ui.flashNotice('A 220V industrial fuse is missing.');
      return;
    }
    game.player.inventory.remove('fuse-main');
    game.insertMainFuse();
    this.prompt = '[E] FUSE INSERTED';
  }
}

export class TerminalInteractable extends BaseInteractable {
  constructor(id: string, object: Object3D, private readonly terminalId: string) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, '[E] ACCESS TERMINAL', meshes);
  }

  public interact(game: Game): void {
    game.openTerminal(this.terminalId);
  }
}

export class KeypadInteractable extends BaseInteractable {
  constructor(id: string, object: Object3D, private readonly keypadId: string) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, '[E] ENTER CODE', meshes);
  }

  public interact(game: Game): void {
    game.openKeypad(this.keypadId);
  }
}

export class HideSpotInteractable extends BaseInteractable {
  constructor(id: string, object: Object3D, public readonly view: HideSpotView) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, '[E] HIDE', meshes);
  }

  public interact(game: Game): void {
    if (game.player.hiddenSpot?.id === this.view.id) {
      game.exitHideSpot();
      this.prompt = '[E] HIDE';
      return;
    }
    game.enterHideSpot(this.view);
    this.prompt = '[E] EXIT HIDING PLACE';
  }
}

export class SwitchInteractable extends BaseInteractable {
  constructor(
    id: string,
    object: Object3D,
    private readonly label: string,
    private readonly onUse: (game: Game) => void,
    prompt = '[E] USE',
  ) {
    const meshes: Mesh[] = [];
    object.traverse((child: Object3D) => {
      if (child instanceof Mesh) {
        meshes.push(child);
      }
    });
    super(id, object, prompt, meshes);
  }

  public interact(game: Game): void {
    this.onUse(game);
    game.ui.flashNotice(this.label);
  }
}

export function colliderFromMesh(id: string, object: Object3D, padding = 0): Collider {
  const bounds = new Box3().setFromObject(object);
  bounds.expandByScalar(padding);
  return {
    id,
    box: bounds,
    enabled: true,
    tag: id,
  };
}

export function makeHideSpotView(id: string, anchor: Group, cameraOffset: Vector3, exitOffset: Vector3): HideSpotView {
  return {
    id,
    anchor,
    cameraOffset,
    exitOffset,
  };
}
