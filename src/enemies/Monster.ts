import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Player } from '../player/Player';
import type { Facility } from '../world/Facility';
import type { Game } from '../game/Game';
import type { ZoneId } from '../types';

export type MonsterKind = 'watcher' | 'crawler';
export type MonsterState = 'DORMANT' | 'PATROL' | 'CHASE' | 'STARE';

interface MonsterConfig {
  kind: MonsterKind;
  zone: ZoneId;
  spawnNode: string;
  patrolNodeIds: string[];
}

/**
 * Zone-locked roaming monsters. They only stir while the player is inside
 * their zone and slip back into dormancy when the player leaves, so they can
 * never follow you across the whole facility.
 *
 * - WATCHER (Observation Deck): a tall pale figure. It freezes like a statue
 *   while you are looking straight at it and stalks forward the moment you
 *   look away or blink.
 * - CRAWLER (Level 3 storage): low, fast and relentless, but it shields its
 *   eyes and slows down under your flashlight beam.
 */
export class Monster {
  public readonly root = new Group();
  public state: MonsterState = 'DORMANT';
  public active = false;
  public readonly kind: MonsterKind;

  private readonly zone: ZoneId;
  private readonly spawnNode: string;
  private readonly patrolNodeIds: string[];
  private readonly currentPath: Vector3[] = [];
  private readonly lookTarget = new Vector3();
  private readonly tempDir = new Vector3();
  private patrolIndex = 0;
  private attackCooldown = 0;
  private awakeStinger = false;

  constructor(config: MonsterConfig) {
    this.kind = config.kind;
    this.zone = config.zone;
    this.spawnNode = config.spawnNode;
    this.patrolNodeIds = config.patrolNodeIds;
    this.buildMesh();
    this.root.visible = false;
  }

  private buildMesh(): void {
    if (this.kind === 'watcher') {
      const skin = new MeshStandardMaterial({
        color: 0xc8ced4,
        roughness: 0.82,
        metalness: 0.05,
        emissive: new Color(0x1b2430),
        emissiveIntensity: 0.35,
      });
      const torso = new Mesh(new BoxGeometry(0.34, 0.95, 0.2), skin);
      torso.position.y = 1.35;
      const head = new Mesh(new SphereGeometry(0.16, 12, 10), skin);
      head.position.y = 1.98;
      head.scale.set(0.85, 1.35, 0.85);
      const armL = new Mesh(new BoxGeometry(0.09, 1.05, 0.09), skin);
      armL.position.set(-0.26, 1.28, 0.02);
      armL.rotation.z = 0.06;
      const armR = armL.clone();
      armR.position.x = 0.26;
      armR.rotation.z = -0.06;
      const legL = new Mesh(new BoxGeometry(0.11, 0.9, 0.11), skin);
      legL.position.set(-0.11, 0.45, 0);
      const legR = legL.clone();
      legR.position.x = 0.11;
      for (const part of [torso, head, armL, armR, legL, legR]) {
        part.castShadow = true;
        this.root.add(part);
      }
    } else {
      const hide = new MeshStandardMaterial({
        color: 0x231a1d,
        roughness: 0.9,
        metalness: 0.1,
        emissive: new Color(0x160404),
        emissiveIntensity: 0.4,
      });
      const body = new Mesh(new BoxGeometry(0.55, 0.4, 0.95), hide);
      body.position.y = 0.45;
      const head = new Mesh(new BoxGeometry(0.34, 0.3, 0.4), hide);
      head.position.set(0, 0.52, 0.62);
      const eyeMat = new MeshStandardMaterial({
        color: 0x000000,
        emissive: new Color(0xff2a1a),
        emissiveIntensity: 2.4,
        roughness: 0.4,
        metalness: 0,
      });
      const eyeL = new Mesh(new SphereGeometry(0.045, 8, 8), eyeMat);
      eyeL.position.set(-0.09, 0.57, 0.82);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.09;
      for (let index = 0; index < 4; index += 1) {
        const leg = new Mesh(new BoxGeometry(0.08, 0.42, 0.08), hide);
        leg.position.set(index % 2 === 0 ? -0.3 : 0.3, 0.2, index < 2 ? 0.32 : -0.32);
        leg.rotation.x = index < 2 ? 0.4 : -0.4;
        leg.castShadow = true;
        this.root.add(leg);
      }
      body.castShadow = true;
      head.castShadow = true;
      this.root.add(body, head, eyeL, eyeR);
    }
  }

  public reset(facility: Facility): void {
    this.root.position.copy(facility.getNodePosition(this.spawnNode));
    this.state = 'DORMANT';
    this.active = false;
    this.root.visible = false;
    this.currentPath.length = 0;
    this.patrolIndex = 0;
    this.attackCooldown = 0;
    this.awakeStinger = false;
  }

  public getDistanceToPlayer(player: Player): number {
    return this.root.position.distanceTo(player.position);
  }

  private sleep(): void {
    this.active = false;
    this.state = 'DORMANT';
    this.root.visible = false;
    this.currentPath.length = 0;
    this.attackCooldown = 0;
    this.awakeStinger = false;
  }

  private awaken(game: Game): void {
    this.active = true;
    this.root.visible = true;
    this.state = 'PATROL';
    this.patrolIndex = 0;
    if (!this.awakeStinger) {
      this.awakeStinger = true;
      game.queueSubtitle(
        'SUIT',
        this.kind === 'watcher'
          ? 'Motion on the observation deck. Something stood up.'
          : 'Scratching below the shelter. Something is awake down here.',
        3.8,
      );
      game.triggerHorrorPulse(0.45);
    }
  }

  public update(dt: number, player: Player, facility: Facility, game: Game): void {
    this.attackCooldown -= dt;
    const playerZone = facility.getZoneId(player.position);
    if (playerZone !== this.zone) {
      if (this.active) {
        this.sleep();
      }
      return;
    }
    if (!this.active) {
      this.awaken(game);
    }

    const toPlayer = this.tempDir.subVectors(player.position, this.root.position);
    const distance = toPlayer.length();
    const los = facility.hasLineOfSight(this.root.position, player.position);

    // Camera forward, used for both gimmicks (watcher stare / crawler light).
    const forward = player.camera.getWorldDirection(new Vector3());
    const toward = toPlayer.clone().normalize();
    const observed = !player.hiddenSpot && los && forward.dot(toward) > 0.86 && distance < 16;
    const lit = player.flashlightOn && player.flashlightBattery > 0 && forward.dot(toward) > 0.8 && los && distance < 14;

    if (this.kind === 'watcher') {
      if (observed && distance < 13) {
        // Statuesque: watched things do not move.
        this.state = 'STARE';
        this.root.lookAt(this.lookTarget.copy(player.position).setY(this.root.position.y));
        return;
      }
      const detection = player.hiddenSpot ? 2.5 : 8.5;
      if (los && distance < detection && !observed) {
        this.state = 'CHASE';
      } else if (this.state === 'CHASE' && distance > 16) {
        this.state = 'PATROL';
        this.currentPath.length = 0;
      }
    } else {
      const detection = player.hiddenSpot ? 3 : 9.5;
      if (los && distance < detection && !player.hiddenSpot) {
        this.state = 'CHASE';
      } else if (this.state === 'CHASE' && (distance > 17 || player.hiddenSpot)) {
        this.state = 'PATROL';
        this.currentPath.length = 0;
      }
    }

    if (this.state === 'CHASE') {
      const speed = (this.kind === 'watcher' ? 3.5 : 4.3) * (this.kind === 'crawler' && lit ? 0.42 : 1);
      if (los && !player.hiddenSpot) {
        this.currentPath.length = 0;
        this.moveToward(player.position, dt, speed);
        this.root.lookAt(this.lookTarget.copy(player.position).setY(this.root.position.y));
      } else if (this.currentPath.length > 0) {
        this.advanceAlongPath(dt, speed);
      } else {
        const path = facility.findPathFromPoint(this.root.position, player.position);
        this.currentPath.splice(0, this.currentPath.length, ...path);
      }

      if (this.attackCooldown <= 0 && distance < 1.2) {
        player.damage(this.kind === 'watcher' ? 26 : 20);
        this.attackCooldown = this.kind === 'watcher' ? 1.7 : 1.15;
        game.triggerHorrorPulse(0.7);
        game.notifyNoise(this.root.position, 0.8);
      }
      return;
    }

    // Slow patrol around the zone's node chain.
    if (this.currentPath.length === 0) {
      const targetId = this.patrolNodeIds[this.patrolIndex % this.patrolNodeIds.length];
      this.patrolIndex += 1;
      const path = facility.findPathFromPoint(this.root.position, facility.getNodePosition(targetId));
      this.currentPath.splice(0, this.currentPath.length, ...path);
    }
    this.advanceAlongPath(dt, this.kind === 'crawler' ? 1.5 : 1.15);
    if (this.kind === 'crawler') {
      this.root.position.y = Math.sin(performance.now() * 0.012) * 0.03;
    }
  }

  private moveToward(target: Vector3, dt: number, speed: number): void {
    const delta = new Vector3().subVectors(target, this.root.position);
    delta.y = 0;
    const distance = delta.length();
    if (distance < 0.001) {
      return;
    }
    delta.normalize().multiplyScalar(Math.min(distance, speed * dt));
    this.root.position.add(delta);
  }

  private advanceAlongPath(dt: number, speed: number): void {
    if (this.currentPath.length === 0) {
      return;
    }
    const next = this.currentPath[0];
    const delta = new Vector3().subVectors(next, this.root.position);
    delta.y = 0;
    const distance = delta.length();
    if (distance < 0.3) {
      this.currentPath.shift();
      return;
    }
    delta.normalize().multiplyScalar(Math.min(distance, speed * dt));
    this.root.position.add(delta);
    this.root.lookAt(this.lookTarget.copy(next).setY(this.root.position.y));
  }
}
