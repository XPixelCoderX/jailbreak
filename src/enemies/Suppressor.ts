import {
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  BoxGeometry,
  CylinderGeometry,
} from 'three';
import { ENEMY_DETECTION_RADIUS, ENEMY_HEARING_RADIUS } from '../config/constants';
import type { Player } from '../player/Player';
import type { Facility } from '../world/Facility';
import type { GameSettings } from '../types';

export type SuppressorState =
  | 'IDLE'
  | 'PATROL'
  | 'INVESTIGATE'
  | 'HEAR_PLAYER'
  | 'SEARCH'
  | 'CHASE'
  | 'LOSE_TARGET'
  | 'RETURN'
  | 'AMBUSH';

export class Suppressor {
  public readonly root = new Group();
  public state: SuppressorState = 'IDLE';
  public visibleStrength = 0;
  public active = false;

  private readonly lookTarget = new Vector3();
  private readonly currentPath: Vector3[] = [];
  private lastKnownPlayerPos: Vector3 | null = null;
  private patrolNodeIds: string[] = [];
  private patrolIndex = 0;
  private stateTimer = 0;
  private searchTimer = 0;
  private attackCooldown = 0;
  private inspectHideCooldown = 0;
  private heardInterest = 0;

  constructor() {
    const material = new MeshStandardMaterial({
      color: 0x040506,
      roughness: 0.9,
      metalness: 0.08,
      emissive: new Color(0x120000),
      emissiveIntensity: 0.25,
    });
    const head = new Mesh(new CylinderGeometry(0.12, 0.16, 0.35, 8), material);
    head.position.y = 1.8;
    const torso = new Mesh(new BoxGeometry(0.45, 0.9, 0.25), material);
    torso.position.y = 1.2;
    const armL = new Mesh(new BoxGeometry(0.12, 0.9, 0.12), material);
    armL.position.set(-0.35, 1.15, 0);
    const armR = armL.clone();
    armR.position.x = 0.35;
    const legL = new Mesh(new BoxGeometry(0.14, 0.95, 0.14), material);
    legL.position.set(-0.14, 0.47, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    this.root.add(head, torso, armL, armR, legL, legR);
    this.root.position.set(38, 0, 4);
    this.root.visible = false;
  }

  public reset(facility: Facility): void {
    this.root.position.copy(facility.getNodePosition('maint-hub'));
    this.state = 'IDLE';
    this.visibleStrength = 0;
    this.active = false;
    this.currentPath.length = 0;
    this.lastKnownPlayerPos = null;
    this.patrolNodeIds = ['maint-hub', 'maint-gen', 'research-entry', 'research-lab', 'security-hall'];
    this.patrolIndex = 0;
    this.stateTimer = 5;
    this.searchTimer = 0;
    this.attackCooldown = 0;
    this.inspectHideCooldown = 0;
    this.heardInterest = 0;
    this.root.visible = false;
  }

  public awaken(facility: Facility): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.root.visible = true;
    this.state = 'PATROL';
    this.root.position.copy(facility.getNodePosition('research-entry'));
  }

  public update(dt: number, player: Player, facility: Facility, settings: GameSettings): void {
    if (!this.active) {
      return;
    }

    this.stateTimer -= dt;
    this.searchTimer -= dt;
    this.attackCooldown -= dt;
    this.inspectHideCooldown -= dt;

    const toPlayer = new Vector3().subVectors(player.position, this.root.position);
    const distanceToPlayer = toPlayer.length();
    const lineOfSight = facility.hasLineOfSight(this.root.position, player.position);
    const playerNoise = player.getNoiseLevel(settings);
    const lightExposure = player.flashlightOn && lineOfSight ? 0.18 : 0;
    const detectThreshold = ENEMY_DETECTION_RADIUS + lightExposure * 12;
    const isVisible = distanceToPlayer < detectThreshold && lineOfSight;

    if (distanceToPlayer < ENEMY_HEARING_RADIUS * Math.max(0.22, playerNoise)) {
      this.hear(player.position, Math.min(1, playerNoise + 0.15));
    }

    if (isVisible && !player.hiddenSpot) {
      this.lastKnownPlayerPos = player.position.clone();
      if (distanceToPlayer < detectThreshold * 0.92) {
        this.setState('CHASE', 0);
      }
    }

    switch (this.state) {
      case 'IDLE':
        if (this.stateTimer <= 0) {
          this.setState('PATROL', 0);
        }
        break;
      case 'PATROL':
        this.followPatrol(dt, facility, 1.9);
        break;
      case 'HEAR_PLAYER':
      case 'INVESTIGATE':
        this.followInterest(dt, facility, 2.8);
        if (this.stateTimer <= 0) {
          this.setState('SEARCH', 4.5);
        }
        break;
      case 'SEARCH':
        this.searchArea(dt, facility);
        if (this.searchTimer <= 0) {
          this.setState('RETURN', 0);
        }
        break;
      case 'CHASE':
        this.chase(dt, player, facility);
        break;
      case 'LOSE_TARGET':
        this.followInterest(dt, facility, 3.4);
        if (this.stateTimer <= 0) {
          this.setState('SEARCH', 5);
        }
        break;
      case 'RETURN':
        this.followPatrol(dt, facility, 2.4);
        if (this.currentPath.length === 0) {
          this.setState('PATROL', 0);
        }
        break;
      case 'AMBUSH':
        this.followInterest(dt, facility, 4.5);
        if (distanceToPlayer < 4.5 && lineOfSight) {
          this.setState('CHASE', 0);
        }
        if (this.stateTimer <= 0) {
          this.setState('PATROL', 0);
        }
        break;
      default:
        break;
    }

    if (player.hiddenSpot && distanceToPlayer < 3.2 && this.inspectHideCooldown <= 0) {
      this.inspectHideCooldown = 7;
      if (Math.random() < 0.42) {
        player.damage(50);
        this.setState('CHASE', 2.2);
      }
    }

    if (this.attackCooldown <= 0 && distanceToPlayer < 1.25) {
      player.damage(34);
      this.attackCooldown = 2.1;
      this.setState('CHASE', 0);
    }

    this.visibleStrength = MathUtils.damp(
      this.visibleStrength,
      lineOfSight && distanceToPlayer < 14 ? 1 : 0.25,
      3,
      dt,
    );
    this.root.lookAt(this.lookTarget.copy(this.root.position).add(toPlayer.setY(0)));
  }

  public hear(position: Vector3, loudness: number): void {
    if (!this.active) {
      return;
    }
    const distance = position.distanceTo(this.root.position);
    if (distance > ENEMY_HEARING_RADIUS * (0.5 + loudness)) {
      return;
    }

    this.heardInterest = loudness;
    this.lastKnownPlayerPos = position.clone();
    this.buildInterestPath(position);
    this.setState(loudness > 0.7 ? 'HEAR_PLAYER' : 'INVESTIGATE', 3 + loudness * 2);
  }

  public triggerAmbush(target: Vector3, facility: Facility): void {
    if (!this.active) {
      return;
    }
    const ambushNode = facility.getNearestNodeToPoint(target, 'research') ?? facility.getNearestNodeToPoint(target, 'underground');
    if (ambushNode) {
      this.root.position.copy(ambushNode.position);
    }
    this.lastKnownPlayerPos = target.clone();
    this.buildInterestPath(target);
    this.setState('AMBUSH', 6);
  }

  public getDistanceToPlayer(player: Player): number {
    return this.root.position.distanceTo(player.position);
  }

  private chase(dt: number, player: Player, facility: Facility): void {
    const lastKnown = player.hiddenSpot ? this.lastKnownPlayerPos : player.position;
    if (!lastKnown) {
      this.setState('RETURN', 0);
      return;
    }

    const seesPlayer = facility.hasLineOfSight(this.root.position, player.position) && !player.hiddenSpot;
    if (seesPlayer) {
      this.lastKnownPlayerPos = player.position.clone();
      this.currentPath.length = 0;
      this.moveToward(player.position, dt, 4.6);
      this.stateTimer = 2.4;
      return;
    }

    if (this.lastKnownPlayerPos) {
      this.buildInterestPath(this.lastKnownPlayerPos);
      this.followInterest(dt, facility, 4);
    }

    if (this.stateTimer <= 0) {
      this.setState('LOSE_TARGET', 2.4);
    }
  }

  private searchArea(dt: number, facility: Facility): void {
    if (!this.lastKnownPlayerPos) {
      this.setState('RETURN', 0);
      return;
    }
    if (this.currentPath.length === 0) {
      const randomOffset = new Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
      this.buildInterestPath(this.lastKnownPlayerPos.clone().add(randomOffset));
    }
    this.followInterest(dt, facility, 2.2);
  }

  private followPatrol(dt: number, facility: Facility, speed: number): void {
    if (this.currentPath.length === 0) {
      const targetId = this.patrolNodeIds[this.patrolIndex % this.patrolNodeIds.length];
      this.patrolIndex += 1;
      const path = facility.findPathFromPoint(this.root.position, facility.getNodePosition(targetId));
      this.currentPath.splice(0, this.currentPath.length, ...path);
    }
    this.advanceAlongPath(dt, speed);
  }

  private followInterest(dt: number, facility: Facility, speed: number): void {
    if (this.currentPath.length === 0 && this.lastKnownPlayerPos) {
      const path = facility.findPathFromPoint(this.root.position, this.lastKnownPlayerPos);
      this.currentPath.splice(0, this.currentPath.length, ...path);
    }
    this.advanceAlongPath(dt, speed);
    if (this.currentPath.length === 0 && this.state === 'RETURN') {
      this.followPatrol(dt, facility, speed);
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
  }

  private buildInterestPath(target: Vector3): void {
    this.currentPath.length = 0;
    this.currentPath.push(target.clone());
  }

  private setState(state: SuppressorState, timer: number): void {
    this.state = state;
    this.stateTimer = timer;
    if (state === 'SEARCH') {
      this.searchTimer = 5 + this.heardInterest * 2.5;
    }
  }
}
