import {
  Group,
  MathUtils,
  PerspectiveCamera,
  SpotLight,
  Vector3,
} from 'three';
import {
  FLASHLIGHT_DRAIN_PER_SECOND,
  FOOTSTEP_INTERVAL_CROUCH,
  FOOTSTEP_INTERVAL_RUN,
  FOOTSTEP_INTERVAL_WALK,
  LOW_BATTERY_THRESHOLD,
  MAX_FLASHLIGHT,
  MAX_HEALTH,
  MAX_STAMINA,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
} from '../config/constants';
import { InputManager } from '../core/InputManager';
import { Inventory } from '../inventory/Inventory';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSettings, HideSpotView, PlayerSaveState } from '../types';
import type { Facility } from '../world/Facility';

const WORLD_UP = new Vector3(0, 1, 0);

export class Player {
  public readonly body = new Group();
  public readonly camera = new PerspectiveCamera(75, 1, 0.1, 90);
  public readonly flashlight = new SpotLight(0xe6f2ff, 5.8, 26, Math.PI / 7.6, 0.34, 1.3);
  public readonly flashlightTarget = new Group();
  public readonly inventory = new Inventory();

  public yaw = Math.PI;
  public pitch = 0;
  public health = MAX_HEALTH;
  public stamina = MAX_STAMINA;
  public flashlightBattery = 46;
  public flashlightOn = false;
  public fear = 0;
  public hiddenSpot: HideSpotView | null = null;

  private readonly planarVelocity = new Vector3();
  private bobPhase = 0;
  private footstepProgress = 0;
  private crouched = false;
  private lowBatteryWarned = false;
  private shakeAmount = 0;
  private flashlightFailureTimer = 0;

  constructor() {
    this.body.position.set(1.5, 0, 2);
    this.camera.position.set(0, PLAYER_HEIGHT, 0);
    this.body.add(this.camera);

    this.flashlight.position.set(0.08, -0.02, -0.02);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.width = 1024;
    this.flashlight.shadow.mapSize.height = 1024;
    this.flashlight.shadow.bias = -0.0003;
    this.flashlight.shadow.radius = 3;
    this.flashlight.visible = false;
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;
    this.flashlightTarget.position.set(0, 0, -8);
  }

  public get position(): Vector3 {
    return this.body.position;
  }

  public reset(): void {
    this.body.position.set(1.5, 0, 2);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.health = MAX_HEALTH;
    this.stamina = MAX_STAMINA;
    this.flashlightBattery = 46;
    this.flashlightOn = false;
    this.fear = 0;
    this.hiddenSpot = null;
    this.planarVelocity.set(0, 0, 0);
    this.crouched = false;
  }

  public update(
    dt: number,
    input: InputManager,
    facility: Facility,
    audio: AudioManager,
    settings: GameSettings,
  ): void {
    if (this.hiddenSpot) {
      this.updateCamera(dt, input, settings);
      this.applyViewTransform(dt);
      this.updateFear(dt, facility, null);
      this.updateFlashlight(dt, audio, false);
      return;
    }

    this.updateCamera(dt, input, settings);

    const forward = Number(input.isActionDown('forward', settings)) - Number(input.isActionDown('back', settings));
    const strafe = Number(input.isActionDown('right', settings)) - Number(input.isActionDown('left', settings));
    const wantsMove = forward !== 0 || strafe !== 0;

    this.crouched = input.isActionDown('crouch', settings);
    const wantsSprint = input.isActionDown('sprint', settings) && !this.crouched && wantsMove;
    const moveVector = new Vector3(strafe, 0, -forward);

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();
      moveVector.applyAxisAngle(WORLD_UP, this.yaw);
    }

    const baseSpeed = this.crouched ? 2.1 : wantsSprint && this.stamina > 1 ? 5.8 : 3.55;
    const targetVelocity = moveVector.multiplyScalar(baseSpeed);
    this.planarVelocity.lerp(targetVelocity, 1 - Math.exp(-dt * 10));

    if (wantsSprint && moveVector.lengthSq() > 0.001) {
      this.stamina = Math.max(0, this.stamina - 20 * dt);
    } else {
      this.stamina = Math.min(MAX_STAMINA, this.stamina + (this.crouched ? 14 : 10) * dt);
    }

    const nextPosition = this.body.position.clone();
    nextPosition.x += this.planarVelocity.x * dt;
    nextPosition.z += this.planarVelocity.z * dt;
    facility.resolvePlayerCollision(nextPosition, this.body.position, PLAYER_RADIUS);
    this.body.position.copy(nextPosition);

    const speed = this.planarVelocity.length();
    if (speed > 0.15) {
      this.footstepProgress += speed * dt;
      const stepInterval = this.crouched
        ? FOOTSTEP_INTERVAL_CROUCH
        : wantsSprint && this.stamina > 1
          ? FOOTSTEP_INTERVAL_RUN
          : FOOTSTEP_INTERVAL_WALK;
      this.bobPhase += dt * (wantsSprint ? 10 : this.crouched ? 4.2 : 7.2);
      if (this.footstepProgress > stepInterval) {
        this.footstepProgress = 0;
        audio.playFootstep(facility.getFootstepSurface(this.body.position), wantsSprint, this.crouched);
      }
    } else {
      this.bobPhase = MathUtils.damp(this.bobPhase, 0, 8, dt);
      this.footstepProgress = 0;
    }

    this.updateFlashlight(dt, audio, wantsMove);
    this.updateFear(dt, facility, speed);
    this.applyViewTransform(dt);
  }

  private updateCamera(dt: number, input: InputManager, settings: GameSettings): void {
    const mouse = input.getMouseDelta();
    const sensitivity = settings.controls.sensitivity;
    this.yaw -= mouse.x * sensitivity;
    const pitchDir = settings.controls.invertY ? 1 : -1;
    this.pitch = MathUtils.clamp(this.pitch + mouse.y * sensitivity * pitchDir, -1.42, 1.42);

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.fov = settings.accessibility.fov;
    this.camera.far = 90 * settings.graphics.viewDistance;
    this.camera.updateProjectionMatrix();
    this.shakeAmount = MathUtils.damp(this.shakeAmount, 0, 3.5, dt);
  }

  private applyViewTransform(dt: number): void {
    const targetHeight = this.crouched ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
    const bobAmount = this.hiddenSpot ? 0 : Math.sin(this.bobPhase) * (this.crouched ? 0.012 : 0.025);
    const sway = this.hiddenSpot ? 0 : Math.sin(this.bobPhase * 0.5) * 0.013;

    if (this.hiddenSpot) {
      const hiddenPosition = this.hiddenSpot.anchor.position.clone().add(this.hiddenSpot.cameraOffset);
      this.body.position.lerp(hiddenPosition, 1 - Math.exp(-dt * 8));
    }

    this.camera.position.y = MathUtils.damp(this.camera.position.y, targetHeight + bobAmount, 10, dt);
    this.camera.position.x = MathUtils.damp(this.camera.position.x, sway, 10, dt);
    this.camera.position.z = MathUtils.damp(this.camera.position.z, bobAmount * 0.6, 10, dt);

    const shakeX = (Math.random() - 0.5) * this.shakeAmount * 0.02;
    const shakeY = (Math.random() - 0.5) * this.shakeAmount * 0.03;
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;

    const beamSway = Math.sin(this.bobPhase * 0.8) * 0.03;
    this.flashlight.position.x = 0.08 + sway * 1.8;
    this.flashlight.position.y = -0.02 + bobAmount * 0.8;
    this.flashlightTarget.position.x = beamSway;
    this.flashlightTarget.position.y = -beamSway * 0.4;
  }

  private updateFlashlight(dt: number, audio: AudioManager, moving: boolean): void {
    if (this.flashlightOn && this.flashlightBattery > 0) {
      const flickerFactor = this.flashlightBattery < LOW_BATTERY_THRESHOLD ? 0.8 : 1;
      this.flashlightBattery = Math.max(0, this.flashlightBattery - FLASHLIGHT_DRAIN_PER_SECOND * dt);
      this.flashlight.visible = true;
      this.flashlight.intensity = (moving ? 5.9 : 5.5) * flickerFactor;
      this.flashlight.angle = MathUtils.lerp(this.flashlight.angle, moving ? Math.PI / 7.1 : Math.PI / 7.8, 0.07);
      this.flashlight.penumbra = moving ? 0.42 : 0.35;

      if (this.flashlightBattery < LOW_BATTERY_THRESHOLD && !this.lowBatteryWarned) {
        this.lowBatteryWarned = true;
        audio.playUiError();
      }

      if (this.flashlightBattery < LOW_BATTERY_THRESHOLD && Math.random() < dt * 2.2) {
        this.flashlightFailureTimer = 0.04 + Math.random() * 0.08;
      }

      if (this.flashlightFailureTimer > 0) {
        this.flashlightFailureTimer -= dt;
        this.flashlight.visible = false;
      }

      if (this.flashlightBattery <= 0) {
        this.flashlightOn = false;
        this.flashlight.visible = false;
        audio.playUiError();
      }
    } else {
      this.flashlight.visible = false;
      this.lowBatteryWarned = false;
      this.flashlightFailureTimer = 0;
    }
  }

  private updateFear(dt: number, facility: Facility, speed: number | null): void {
    const darkness = facility.getZoneDarkness(this.body.position);
    const injury = 1 - this.health / MAX_HEALTH;
    const movement = speed === null ? 0.08 : Math.min(0.18, speed * 0.03);
    const targetFear = darkness * 0.55 + injury * 0.35 + movement;
    this.fear = MathUtils.clamp(MathUtils.lerp(this.fear, targetFear, 1 - Math.exp(-dt * 1.4)), 0, 1);
  }

  public getNoiseLevel(settings: GameSettings): number {
    if (this.hiddenSpot) {
      return 0.02;
    }
    const moving = this.planarVelocity.length();
    if (moving < 0.12) {
      return 0.04;
    }
    if (this.crouched) {
      return 0.16 + moving * 0.03;
    }
    if (moving > 4) {
      return 0.82;
    }
    return 0.35;
  }

  public toggleFlashlight(audio: AudioManager): void {
    if (this.flashlightBattery <= 0) {
      audio.playUiError();
      return;
    }
    this.flashlightOn = !this.flashlightOn;
    audio.playFlashlightToggle(this.flashlightOn);
  }

  public addBattery(amount: number): void {
    this.flashlightBattery = Math.min(MAX_FLASHLIGHT, this.flashlightBattery + amount);
    this.lowBatteryWarned = false;
  }

  public damage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
    this.shakeAmount = Math.min(1.5, this.shakeAmount + amount / 40);
  }

  public heal(amount: number): void {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  public isDead(): boolean {
    return this.health <= 0;
  }

  public getLookDirection(out = new Vector3()): Vector3 {
    return this.camera.getWorldDirection(out).normalize();
  }

  public serialize(): PlayerSaveState {
    return {
      position: { x: this.body.position.x, y: this.body.position.y, z: this.body.position.z },
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      stamina: this.stamina,
      flashlightBattery: this.flashlightBattery,
      flashlightOn: this.flashlightOn,
      inventory: this.inventory.serialize(),
    };
  }

  public deserialize(data: PlayerSaveState): void {
    this.body.position.set(data.position.x, data.position.y, data.position.z);
    this.yaw = data.yaw;
    this.pitch = data.pitch;
    this.health = data.health;
    this.stamina = data.stamina;
    this.flashlightBattery = data.flashlightBattery;
    this.flashlightOn = data.flashlightOn;
    this.inventory.deserialize(data.inventory);
  }
}
