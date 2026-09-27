import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Ray,
  RepeatWrapping,
  Texture,
  Vector3,
} from 'three';
import type { Scene } from 'three';
import { SURFACE_COLORS } from '../config/constants';
import type {
  Collider,
  DoorSaveState,
  PatrolNode,
  ProgressState,
  PuzzleState,
  SecurityCameraDefinition,
  TerminalDefinition,
  ZoneDefinition,
  ZoneId,
} from '../types';
import {
  BreakerInteractable,
  DocumentInteractable,
  Door,
  type DoorOptions,
  FuseBoxInteractable,
  HideSpotInteractable,
  KeypadInteractable,
  PickupInteractable,
  SwitchInteractable,
  TerminalInteractable,
  makeHideSpotView,
} from '../interaction/Interactable';

export class Facility {
  public readonly root = new Group();
  public readonly interactables: (
    | Door
    | PickupInteractable
    | DocumentInteractable
    | BreakerInteractable
    | FuseBoxInteractable
    | TerminalInteractable
    | KeypadInteractable
    | HideSpotInteractable
    | SwitchInteractable
  )[] = [];
  public readonly doors: Door[] = [];
  public readonly cameras = new Map<string, SecurityCameraDefinition>();
  public readonly terminals = new Map<string, TerminalDefinition>();
  public readonly zones: ZoneDefinition[] = [];
  public readonly nodes = new Map<string, PatrolNode>();
  public readonly sceneFog = new FogExp2(0x05070b, 0.035);

  private readonly colliders: Collider[] = [];
  private readonly lights: PointLight[] = [];
  private readonly animatedScreens: Mesh[] = [];
  private readonly fans: Object3D[] = [];
  private readonly particleLayers: Points[] = [];
  private readonly strangeDoors: Door[] = [];
  private readonly tempRay = new Ray();
  private researchLightLevel = 0.08;
  private emergencyLightLevel = 1;
  private coreLightLevel = 0.1;

  constructor(private readonly scene: Scene) {
    this.root.name = 'Facility';
    this.scene.add(this.root);
    this.scene.fog = this.sceneFog;
    this.buildLighting();
    this.buildFacility();
  }

  public update(dt: number, time: number, progress: ProgressState, puzzles: PuzzleState): void {
    this.researchLightLevel = MathUtils.damp(this.researchLightLevel, progress.researchPowerRestored ? 0.7 : 0.08, 1.1, dt);
    this.emergencyLightLevel = MathUtils.damp(this.emergencyLightLevel, progress.researchPowerRestored ? 0.55 : 1, 1.6, dt);
    this.coreLightLevel = MathUtils.damp(this.coreLightLevel, progress.coreEntered ? 0.9 : 0.18, 1.2, dt);

    for (const door of this.doors) {
      door.update(dt);
    }

    for (const interactable of this.interactables) {
      interactable.update(dt);
    }

    for (const light of this.lights) {
      const isResearch = light.userData.zone === 'research';
      const isCore = light.userData.zone === 'core';
      const base = light.userData.baseIntensity as number;
      const flicker = light.userData.flicker as boolean;
      const power = isResearch ? this.researchLightLevel : isCore ? this.coreLightLevel : 1;
      const emergency = light.userData.emergency as boolean;
      const emergencyScale = emergency ? this.emergencyLightLevel : 1;
      const noise = flicker ? Math.sin(time * (2 + (light.userData.seed as number)) + (light.userData.seed as number) * 12) * 0.12 : 0;
      light.intensity = Math.max(0, base * power * emergencyScale + noise);
    }

    for (const mesh of this.animatedScreens) {
      const material = mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.offsetHSL(0, 0, Math.sin(time * 1.1 + mesh.position.x) * 0.0008);
      }
    }

    for (const fan of this.fans) {
      fan.rotation.z += dt * (fan.userData.speed as number);
    }

    for (const layer of this.particleLayers) {
      layer.rotation.y += dt * (layer.userData.spin as number);
      layer.position.y = 1.2 + Math.sin(time * 0.14 + (layer.userData.phase as number)) * 0.14;
    }

    if (progress.researchPowerRestored && puzzles.archiveDoorUnlocked) {
      const camera = this.cameras.get('research-cam');
      if (camera) {
        camera.camera.lookAt(61, 1.6, 0);
      }
    }
  }

  public applyProgress(progress: ProgressState, puzzles: PuzzleState): void {
    const intakeDoor = this.getDoor('door-intake');
    if (intakeDoor && progress.intakeDoorUnlocked) {
      intakeDoor.forceUnlock();
    }

    const researchDoor = this.getDoor('door-research');
    if (researchDoor && progress.researchPowerRestored) {
      researchDoor.forceUnlock();
    }

    const archiveDoor = this.getDoor('door-underground');
    if (archiveDoor && puzzles.archiveDoorUnlocked) {
      archiveDoor.forceUnlock();
    }

    const coreDoor = this.getDoor('door-core');
    if (coreDoor && progress.coreKeyFound) {
      coreDoor.forceUnlock();
    }
  }

  public resolvePlayerCollision(next: Vector3, previous: Vector3, radius: number): void {
    const xCandidate = next.x;
    next.x = xCandidate;
    for (const collider of this.colliders) {
      if (!collider.enabled || collider.tag === 'sensor') {
        continue;
      }
      if (this.circleIntersectsBox(next.x, previous.z, radius, collider.box)) {
        next.x = previous.x;
        break;
      }
    }

    const zCandidate = next.z;
    next.z = zCandidate;
    for (const collider of this.colliders) {
      if (!collider.enabled || collider.tag === 'sensor') {
        continue;
      }
      if (this.circleIntersectsBox(next.x, next.z, radius, collider.box)) {
        next.z = previous.z;
        break;
      }
    }
  }

  public getFootstepSurface(position: Vector3): 'concrete' | 'metal' | 'water' {
    const zone = this.getZoneId(position);
    if (zone === 'underground') {
      return 'water';
    }
    if (zone === 'maintenance' || zone === 'core' || zone === 'research') {
      return 'metal';
    }
    return 'concrete';
  }

  public getZoneDarkness(position: Vector3): number {
    const zone = this.zones.find((entry) => entry.bounds.containsPoint(position));
    return zone?.darkness ?? 0.45;
  }

  public getZoneId(position: Vector3): ZoneId {
    const zone = this.zones.find((entry) => entry.bounds.containsPoint(position));
    return zone?.id ?? 'lobby';
  }

  public getZoneName(position: Vector3): string {
    const zone = this.zones.find((entry) => entry.bounds.containsPoint(position));
    return zone?.name ?? 'Main Lobby';
  }

  public hasLineOfSight(from: Vector3, to: Vector3): boolean {
    const origin = from.clone().setY(1.5);
    const target = to.clone().setY(1.5);
    const direction = target.clone().sub(origin).normalize();
    const maxDistance = origin.distanceTo(target);
    this.tempRay.set(origin, direction);

    for (const collider of this.colliders) {
      if (!collider.enabled) {
        continue;
      }
      const hit = this.tempRay.intersectBox(collider.box, new Vector3());
      if (hit && hit.distanceTo(origin) < maxDistance) {
        return false;
      }
    }
    return true;
  }

  public findPathFromPoint(from: Vector3, to: Vector3): Vector3[] {
    const start = this.getNearestNodeToPoint(from);
    const end = this.getNearestNodeToPoint(to);
    if (!start || !end) {
      return [to.clone()];
    }
    if (start.id === end.id) {
      return [to.clone()];
    }

    const queue: string[] = [start.id];
    const visited = new Set<string>([start.id]);
    const cameFrom = new Map<string, string | null>([[start.id, null]]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === end.id) {
        break;
      }
      const node = this.nodes.get(currentId);
      if (!node) {
        continue;
      }
      for (const neighbor of node.neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          cameFrom.set(neighbor, currentId);
          queue.push(neighbor);
        }
      }
    }

    if (!cameFrom.has(end.id)) {
      return [to.clone()];
    }

    const pathIds: string[] = [];
    let current: string | null = end.id;
    while (current) {
      pathIds.unshift(current);
      current = cameFrom.get(current) ?? null;
    }

    return pathIds
      .map((id) => this.nodes.get(id)?.position.clone())
      .filter((value): value is Vector3 => Boolean(value))
      .concat(to.clone());
  }

  public getNearestNodeToPoint(point: Vector3, preferredZone?: ZoneId): PatrolNode | null {
    let best: PatrolNode | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const node of this.nodes.values()) {
      if (preferredZone && node.zone !== preferredZone) {
        continue;
      }
      const distance = node.position.distanceToSquared(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    if (!best && preferredZone) {
      return this.getNearestNodeToPoint(point);
    }
    return best;
  }

  public getNodePosition(id: string): Vector3 {
    const node = this.nodes.get(id);
    return node ? node.position.clone() : new Vector3();
  }

  public serializeDoors(): DoorSaveState[] {
    return this.doors.map((door) => door.serialize());
  }

  public restoreDoors(states: DoorSaveState[]): void {
    for (const state of states) {
      const door = this.getDoor(state.id);
      if (door) {
        door.applyState(state);
      }
    }
  }

  public getDoor(id: string): Door | undefined {
    return this.doors.find((door) => door.id === id);
  }

  public triggerStrangeDoor(): Door | undefined {
    const candidates = this.strangeDoors.filter((door) => door.isOpen);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (chosen) {
      chosen.slamShut();
    }
    return chosen;
  }

  private buildLighting(): void {
    const ambient = new AmbientLight(0x0d1016, 0.22);
    const hemi = new HemisphereLight(0x5d6a86, 0x090a0c, 0.18);
    this.scene.add(ambient, hemi);
  }

  private buildFacility(): void {
    const hallwayTexture = this.createStripeTexture();
    hallwayTexture.wrapS = RepeatWrapping;
    hallwayTexture.wrapT = RepeatWrapping;
    hallwayTexture.repeat.set(8, 8);

    const intake = this.createRoom('intake', 0, 0, 8, 8, { east: [{ center: 0, width: 2.8 }] }, 0x20242b, hallwayTexture);
    this.decorateIntake(intake.group);

    this.createRoom('intake', 8, 0, 8, 4, { west: [{ center: 0, width: 2.8 }], east: [{ center: 0, width: 3 }] }, 0x1d2127, hallwayTexture);

    const lobby = this.createRoom('lobby', 20, 0, 18, 16, {
      west: [{ center: 0, width: 3 }],
      east: [{ center: 0, width: 3 }, { center: 6, width: 3 }],
      south: [{ center: -5, width: 2.8 }],
      north: [{ center: 4.5, width: 2.8 }],
    }, 0x1f242b, hallwayTexture);
    this.decorateLobby(lobby.group);

    const security = this.createRoom('security', 20, -14, 10, 10, { north: [{ center: 0, width: 2.8 }] }, 0x21262e, hallwayTexture);
    this.decorateSecurity(security.group);

    this.createRoom('maintenance', 34, 7, 10, 6, {
      west: [{ center: 0, width: 2.8 }],
      north: [{ center: 0, width: 2.8 }],
      south: [{ center: 0, width: 2.8 }],
    }, 0x21242a, hallwayTexture);
    const maintenance = this.createRoom('maintenance', 34, 18, 16, 16, { south: [{ center: 0, width: 2.8 }] }, 0x242a31, hallwayTexture);
    this.decorateMaintenance(maintenance.group);

    this.createRoom('research', 34, -6, 10, 6, {
      west: [{ center: 0, width: 2.8 }],
      east: [{ center: 0, width: 2.8 }],
      south: [{ center: 0, width: 2.8 }],
    }, 0x20252d, hallwayTexture);
    const research = this.createRoom('research', 48, -6, 18, 16, {
      west: [{ center: 0, width: 2.8 }],
      east: [{ center: 0, width: 2.6 }],
    }, 0x1e2329, hallwayTexture);
    this.decorateResearch(research.group);

    this.createRoom('research', 60, -6, 8, 6, {
      west: [{ center: 0, width: 2.6 }],
      east: [{ center: 0, width: 2.8 }],
    }, 0x1d2025, hallwayTexture);

    const underground = this.createRoom('underground', 74, -6, 24, 12, {
      west: [{ center: 0, width: 2.8 }],
      east: [{ center: 0, width: 2.8 }],
      north: [{ center: 6, width: 2.8 }],
    }, 0x1a1b20, hallwayTexture);
    this.decorateUnderground(underground.group);

    const shelter = this.createRoom('underground', 74, 8, 14, 10, { south: [{ center: 0, width: 2.8 }] }, 0x1c2026, hallwayTexture);
    this.decorateShelter(shelter.group);

    this.createRoom('core', 90, -6, 10, 8, {
      west: [{ center: 0, width: 2.8 }],
      east: [{ center: 0, width: 2.8 }],
    }, 0x181d23, hallwayTexture);
    const core = this.createRoom('core', 104, -6, 18, 16, { west: [{ center: 0, width: 2.8 }] }, 0x141a22, hallwayTexture);
    this.decorateCore(core.group);

    this.createDoors();
    this.createInteractables();
    this.createNodes();
    this.createCameras();
    this.createTerminals();
    this.createParticles();
  }

  private createRoom(
    zone: ZoneId,
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    openings: Partial<Record<'north' | 'south' | 'east' | 'west', { center: number; width: number }[]>>,
    wallColor: number,
    floorTexture: Texture,
  ): { group: Group; bounds: Box3 } {
    const group = new Group();
    const floorMaterial = new MeshStandardMaterial({ color: zone === 'underground' ? 0x1c2128 : SURFACE_COLORS.metal, roughness: 0.92, metalness: 0.12, map: floorTexture });
    const ceilingMaterial = new MeshStandardMaterial({ color: 0x0d1014, roughness: 1, metalness: 0.05 });
    const wallMaterial = new MeshStandardMaterial({ color: wallColor, roughness: 0.95, metalness: 0.08 });

    const floor = new Mesh(new BoxGeometry(width, 0.2, depth), floorMaterial);
    floor.position.set(centerX, -0.1, centerZ);
    floor.receiveShadow = true;
    group.add(floor);

    const ceiling = new Mesh(new BoxGeometry(width, 0.2, depth), ceilingMaterial);
    ceiling.position.set(centerX, 3.3, centerZ);
    group.add(ceiling);

    this.buildWallSegments(group, wallMaterial, centerX, centerZ, width, depth, 'north', openings.north);
    this.buildWallSegments(group, wallMaterial, centerX, centerZ, width, depth, 'south', openings.south);
    this.buildWallSegments(group, wallMaterial, centerX, centerZ, width, depth, 'east', openings.east);
    this.buildWallSegments(group, wallMaterial, centerX, centerZ, width, depth, 'west', openings.west);

    this.root.add(group);

    const bounds = new Box3(
      new Vector3(centerX - width / 2, -1, centerZ - depth / 2),
      new Vector3(centerX + width / 2, 4, centerZ + depth / 2),
    );
    this.zones.push({
      id: zone,
      name: this.zoneName(zone),
      ambient: zone,
      bounds,
      darkness: zone === 'intake' ? 0.88 : zone === 'core' ? 0.78 : zone === 'underground' ? 0.82 : zone === 'research' ? 0.64 : 0.56,
    });

    this.addCeilingLights(group, zone, centerX, centerZ, width, depth);
    return { group, bounds };
  }

  private buildWallSegments(
    group: Group,
    material: MeshStandardMaterial,
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    side: 'north' | 'south' | 'east' | 'west',
    openings: { center: number; width: number }[] | undefined,
  ): void {
    const totalLength = side === 'north' || side === 'south' ? width : depth;
    const sorted = [...(openings ?? [])].sort((a, b) => a.center - b.center);
    let cursor = -totalLength / 2;

    const createSegment = (segmentStart: number, segmentEnd: number): void => {
      const segmentLength = segmentEnd - segmentStart;
      if (segmentLength <= 0.2) {
        return;
      }
      const geometry = side === 'north' || side === 'south'
        ? new BoxGeometry(segmentLength, 3.2, 0.28)
        : new BoxGeometry(0.28, 3.2, segmentLength);
      const wall = new Mesh(geometry, material);
      wall.castShadow = true;
      wall.receiveShadow = true;
      if (side === 'north' || side === 'south') {
        wall.position.set(centerX + segmentStart + segmentLength / 2, 1.6, centerZ + (side === 'north' ? -depth / 2 : depth / 2));
      } else {
        wall.position.set(centerX + (side === 'west' ? -width / 2 : width / 2), 1.6, centerZ + segmentStart + segmentLength / 2);
      }
      group.add(wall);
      this.colliders.push({
        id: `${group.uuid}-${side}-${segmentStart.toFixed(2)}`,
        box: new Box3().setFromObject(wall),
        enabled: true,
        tag: 'wall',
      });
    };

    for (const opening of sorted) {
      const openStart = opening.center - opening.width / 2;
      const openEnd = opening.center + opening.width / 2;
      createSegment(cursor, openStart);
      cursor = openEnd;
    }
    createSegment(cursor, totalLength / 2);
  }

  private addCeilingLights(group: Group, zone: ZoneId, centerX: number, centerZ: number, width: number, depth: number): void {
    const countX = Math.max(1, Math.floor(width / 8));
    const countZ = Math.max(1, Math.floor(depth / 8));
    const spacingX = width / countX;
    const spacingZ = depth / countZ;

    for (let xIndex = 0; xIndex < countX; xIndex += 1) {
      for (let zIndex = 0; zIndex < countZ; zIndex += 1) {
        const positionX = centerX - width / 2 + spacingX * 0.5 + xIndex * spacingX;
        const positionZ = centerZ - depth / 2 + spacingZ * 0.5 + zIndex * spacingZ;
        const frame = new Mesh(
          new BoxGeometry(1.4, 0.08, 0.32),
          new MeshStandardMaterial({ color: 0x444d56, roughness: 0.4, metalness: 0.7 }),
        );
        frame.position.set(positionX, 3.15, positionZ);
        group.add(frame);

        const intensityBase = zone === 'research' || zone === 'core' ? 0.52 : zone === 'intake' ? 0.14 : 0.38;
        const light = new PointLight(zone === 'core' ? 0x9ac5ff : 0xdde6f9, intensityBase, 9, 2.2);
        light.position.set(positionX, 2.85, positionZ);
        light.userData = {
          zone,
          baseIntensity: intensityBase,
          flicker: Math.random() > 0.65,
          seed: Math.random() * 4 + 0.2,
          emergency: false,
        };
        if (zone === 'core') {
          light.castShadow = true;
          light.shadow.mapSize.set(512, 512);
        }
        this.lights.push(light);
        group.add(light);
      }
    }

    if (zone !== 'intake') {
      const emergency = new PointLight(0x7f1414, zone === 'core' ? 0.25 : 0.48, Math.max(width, depth) * 0.8, 2);
      emergency.position.set(centerX, 2.4, centerZ);
      emergency.userData = {
        zone,
        baseIntensity: zone === 'core' ? 0.25 : 0.48,
        flicker: true,
        seed: Math.random() * 3 + 1.5,
        emergency: true,
      };
      this.lights.push(emergency);
      group.add(emergency);
    }
  }

  private decorateIntake(group: Group): void {
    this.addBed(group, -2.1, -1.4, 0);
    this.addCabinet(group, 2.4, -2.4, 'small');
    this.addShelf(group, 2.7, 2.2, 1.6, 2.2);
    this.addPipeRun(group, -3.7, -3.7, 7.4, true);
    this.addWallMonitor(group, -1.8, 0.2, -3.88, Math.PI, 0x55a8ff);
  }

  private decorateLobby(group: Group): void {
    this.addDesk(group, 15, -2.8, 4.2);
    this.addDesk(group, 13.5, 2.8, 3.8);
    this.addBench(group, 24, 4.4, 4.2);
    this.addBench(group, 24, -4.2, 4.2);
    this.addShelf(group, 27, 6.2, 1.6, 2.4);
    this.addPlantPot(group, 27.5, -6.5);
    this.addWallMonitor(group, 20.5, 0.6, -7.9, Math.PI, 0x6fd2ff);
    this.addWallMonitor(group, 17.6, -0.6, -7.9, Math.PI, 0x6fd2ff);
    this.addFan(group, 24, 2.8);
    this.addPropDebris(group, 20, 6.7, 8);
  }

  private decorateSecurity(group: Group): void {
    this.addDesk(group, 18.5, -15.3, 3.2);
    this.addDesk(group, 22.2, -12.6, 3.6);
    this.addLocker(group, 16.5, -10.5, 3);
    this.addShelf(group, 23.6, -17.4, 1.5, 2.2);
    this.addWallMonitor(group, 20, 0.2, -18.88, 0, 0x87d1ff);
    this.addPipeRun(group, 15.4, -9.2, 7.8, false);
  }

  private decorateMaintenance(group: Group): void {
    this.addGenerator(group, 31, 20);
    this.addGenerator(group, 37.5, 20.8);
    this.addPipeRun(group, 27, 11, 14, false);
    this.addPipeRun(group, 41, 11.2, 14, false);
    this.addFan(group, 31.2, 26.5);
    this.addFan(group, 38.7, 26.2);
    this.addCabinet(group, 40.3, 12.8, 'large');
    this.addToolCart(group, 29.4, 13.4);
    this.addPropDebris(group, 34.2, 18, 10);
  }

  private decorateResearch(group: Group): void {
    this.addLabBench(group, 46, -10.6);
    this.addLabBench(group, 52.2, -10.8);
    this.addContainmentFrame(group, 48.4, -1.4);
    this.addContainmentFrame(group, 54.5, -1.4);
    this.addDesk(group, 43, -2.2, 3.6);
    this.addDesk(group, 55.5, -2.5, 3.2);
    this.addShelf(group, 57, -12.4, 1.5, 2.4);
    this.addLocker(group, 41.6, -13.2, 2);
    this.addWallMonitor(group, 48.8, -8.4, -13.88, 0, 0x5cc4ff);
    this.addFan(group, 57.4, -4.2);
  }

  private decorateUnderground(group: Group): void {
    this.addPipeRun(group, 62.5, -11.5, 23, false);
    this.addPipeRun(group, 62.8, -0.6, 23, false);
    this.addLocker(group, 67, -2.4, 3);
    this.addShelf(group, 82.4, -10.4, 1.6, 2.4);
    this.addFloodPlane(group, 74, -6, 20, 8);
    this.addPropDebris(group, 74, -6, 14);
    this.addCabinet(group, 84.5, -2.4, 'small');
  }

  private decorateShelter(group: Group): void {
    this.addDesk(group, 71.5, 9.3, 3.4);
    this.addBed(group, 76.8, 11.5, 1.2);
    this.addBed(group, 80.6, 11.5, 1.2);
    this.addWallMonitor(group, 74, 8.1, 3.12, Math.PI, 0x7ee0ff);
  }

  private decorateCore(group: Group): void {
    this.addCoreMachine(group, 104, -6);
    this.addControlRing(group, 104, -6);
    this.addDesk(group, 97.8, -2.3, 3.4);
    this.addWallMonitor(group, 104, -14.8, -13.88, 0, 0x94c8ff);
    this.addFan(group, 99.5, -10.2);
    this.addFan(group, 108.5, -10.2);
  }

  private createDoors(): void {
    this.doors.push(
      this.addDoor('door-intake', 4, 0, 'east', { locked: true, heavy: true, strange: true }),
      this.addDoor('door-lobby-maint', 29, 7, 'east', { heavy: true }),
      this.addDoor('door-lobby-research', 29, -6, 'east', { heavy: true }),
      this.addDoor('door-research', 39, -6, 'east', { locked: true, requiresPower: true, automatic: true }),
      this.addDoor('door-security', 20, -9, 'south', {}),
      this.addDoor('door-underground', 64, -6, 'east', { locked: true, heavy: true, strange: true }),
      this.addDoor('door-core', 95, -6, 'east', { locked: true, keycardId: 'keycard-level-3', heavy: true }),
    );
  }

  private createInteractables(): void {
    this.interactables.push(...this.doors);

    const flashlight = this.makePickup(
      'pickup-flashlight',
      this.createPickupMesh(2.6, 1.05, 2.2, 0x8ba6c9, 'flashlight'),
      {
        id: 'story-flashlight',
        name: 'FACILITY FLASHLIGHT',
        type: 'story',
        description: 'A dented tactical flashlight. The casing is warm as if recently used.',
        quantity: 1,
      },
      (game) => {
        game.progress.flashlightFound = true;
        game.player.flashlightOn = true;
        game.player.addBattery(30);
        const intakeDoor = this.getDoor('door-intake');
        if (intakeDoor) {
          intakeDoor.forceUnlock();
        }
        game.progress.intakeDoorUnlocked = true;
        game.queueSubtitle('ANNOUNCEMENT', 'Emergency lockdown eased in Intake. Proceed to the lobby.', 4.2);
        game.setObjective('leaveIntake');
      },
    );

    const battery1 = this.makePickup('pickup-battery-1', this.createPickupMesh(12.8, 0.72, -2.8, 0xc4b36a, 'battery'), {
      id: 'battery-pack',
      name: 'INDUSTRIAL BATTERY',
      type: 'battery',
      description: 'A half-charged lamp battery salvaged from emergency stock.',
      quantity: 1,
    }, (game) => game.player.addBattery(35));

    const battery2 = this.makePickup('pickup-battery-2', this.createPickupMesh(57.4, 0.72, -12.2, 0xc4b36a, 'battery'), {
      id: 'battery-pack-2',
      name: 'SEALED BATTERY PACK',
      type: 'battery',
      description: 'A sealed replacement pack for field lights and suit lamps.',
      quantity: 1,
    }, (game) => game.player.addBattery(35));

    const battery3 = this.makePickup('pickup-battery-3', this.createPickupMesh(82.5, 0.72, -9.8, 0xc4b36a, 'battery'), {
      id: 'battery-pack-3',
      name: 'SERVICE BATTERY',
      type: 'battery',
      description: 'A damp but usable battery cylinder wrapped in utility tape.',
      quantity: 1,
    }, (game) => game.player.addBattery(35));

    const medkit = this.makePickup('pickup-med', this.createPickupMesh(22.4, 0.72, -15.2, 0xa93434, 'medkit'), {
      id: 'med-supply',
      name: 'MEDICAL SUPPLIES',
      type: 'medical',
      description: 'Bandages, coagulant patches, and a sealed stimulant ampoule.',
      quantity: 1,
    }, (game) => game.player.heal(45));

    const fuse = this.makePickup('pickup-fuse', this.createPickupMesh(40.4, 0.72, 13.2, 0xdb9d43, 'fuse'), {
      id: 'fuse-main',
      name: 'MAIN FUSE',
      type: 'fuse',
      description: 'Industrial 220V fuse cartridge. Label: ROUTING PANEL B.',
      quantity: 1,
    });

    const level2Keycard = this.makePickup('pickup-keycard-2', this.createPickupMesh(18.4, 0.76, -15.4, 0x77a8c3, 'keycard'), {
      id: 'keycard-level-2',
      name: 'LEVEL 2 SECURITY KEYCARD',
      type: 'keycard',
      description: 'Access: Research Wing, Maintenance, Archive. Status: Damaged.',
      quantity: 1,
    });

    const level3Keycard = this.makePickup('pickup-keycard-3', this.createPickupMesh(71.6, 0.76, 9.7, 0x8ec6ff, 'keycard'), {
      id: 'keycard-level-3',
      name: 'LEVEL 3 CORE KEYCARD',
      type: 'keycard',
      description: 'Access: Suppression Core, lattice control, outbound emergency route.',
      quantity: 1,
    }, (game) => {
      game.progress.coreKeyFound = true;
      game.setObjective('reachCore');
    });

    const wrench = this.makePickup('pickup-tool', this.createPickupMesh(29.2, 0.78, 13.4, 0x8b8b8b, 'tool'), {
      id: 'maintenance-tool',
      name: 'INSULATED WRENCH',
      type: 'tool',
      description: 'Heavy tool used to reset seized couplers and breaker covers.',
      quantity: 1,
    });

    const intakeMemo = this.makeDocument(
      'doc-intake',
      this.createDocumentMesh(-1.7, 0.78, 1.2),
      'INTAKE INCIDENT MEMO',
      'Shift transfer note:\nIf suppression alarm cycles again, wait for security confirmation before opening the intake door. We are not to use the phrase from the archive in the lower halls. It agitates the observation chamber.',
      {
        id: 'doc-intake',
        name: 'INTAKE INCIDENT MEMO',
        type: 'document',
        description: 'A folded intake memo with a security warning scribbled in blue ink.',
        quantity: 1,
      },
    );

    const archiveNote = this.makeDocument(
      'doc-archive-code',
      this.createDocumentMesh(55.8, 0.78, -2.3),
      'ARCHIVE MAINTENANCE CODE',
      'The archive blast keypad desyncs after every suppression drill. Use the last four digits of chamber telemetry from Shift Kappa: 4138. Burn this after reset.',
      {
        id: 'doc-archive-code',
        name: 'ARCHIVE MAINTENANCE CODE',
        type: 'document',
        description: 'A grease-stained note listing the archive override code.',
        quantity: 1,
      },
    );

    const incidentReport = this.makeDocument(
      'doc-incident',
      this.createDocumentMesh(22.1, 0.78, -12.4),
      'SUPPRESSION EVENT REPORT',
      'Incident fragments:\n- Visual contact lost in Chamber 4\n- Containment lattice inverted itself\n- Staff reported hearing their own voices over sealed radios\n- Core access revoked without command authority\n- Entire observation line unaccounted for',
      {
        id: 'doc-incident',
        name: 'SUPPRESSION EVENT REPORT',
        type: 'document',
        description: 'A clipped report recovered from security. Several names are blacked out.',
        quantity: 1,
      },
    );

    const audioLog = this.makeDocument(
      'doc-audio-log',
      this.createDocumentMesh(79.4, 0.78, 11.1),
      'AUDIO LOG: DR. HALE',
      'Transcript:\nThe chamber did not fail. It answered. The suppression field was not containing it — it was keeping us separate from it. If you reach the core, do not let the lattice listen to you for too long.',
      {
        id: 'audio-log-hale',
        name: 'AUDIO RECORDING: DR. HALE',
        type: 'audio',
        description: 'A corrupted handheld recorder. Playback transcript recovered by the terminal.',
        quantity: 1,
      },
    );

    const breakers = [
      this.makeBreaker('breaker-a', 28.4, 1.1, 17.8, 'Primary Feed'),
      this.makeBreaker('breaker-b', 34.2, 1.1, 23.2, 'Research Relay'),
      this.makeBreaker('breaker-c', 39.3, 1.1, 17.2, 'Containment Bus'),
    ];

    const fuseBox = this.makeFuseBox('fuse-main-box', 36.2, 1.1, 13.1);
    const terminalSecurity = this.makeTerminal('terminal-security', 19.6, 1.05, -15.1, 'security-terminal');
    const terminalResearch = this.makeTerminal('terminal-research', 48.1, 1.05, -2.3, 'research-terminal');
    const terminalCore = this.makeTerminal('terminal-core', 97.8, 1.05, -2.2, 'core-terminal');
    const keypad = this.makeKeypad('keypad-archive', 63.8, 1.35, -7.0, 'archive-keypad');
    const locker1 = this.makeHideLocker('hide-locker-a', 41.2, -13.2);
    const locker2 = this.makeHideLocker('hide-locker-b', 67.2, -2.4);
    const underDesk = this.makeHideDesk('hide-desk-core', 97.6, -2.2);

    const coreSwitch1 = this.makeCoreSwitch('core-switch-1', 99.5, 1.2, -9.8, 0, 0);
    const coreSwitch2 = this.makeCoreSwitch('core-switch-2', 104.0, 1.2, -12.2, 1, 1);
    const coreSwitch3 = this.makeCoreSwitch('core-switch-3', 108.4, 1.2, -9.8, 2, 2);

    this.interactables.push(
      flashlight,
      battery1,
      battery2,
      battery3,
      medkit,
      fuse,
      level2Keycard,
      level3Keycard,
      wrench,
      intakeMemo,
      archiveNote,
      incidentReport,
      audioLog,
      ...breakers,
      fuseBox,
      terminalSecurity,
      terminalResearch,
      terminalCore,
      keypad,
      locker1,
      locker2,
      underDesk,
      coreSwitch1,
      coreSwitch2,
      coreSwitch3,
    );
  }

  private createNodes(): void {
    const nodes: PatrolNode[] = [
      { id: 'intake', position: new Vector3(0, 0, 0), neighbors: ['intake-hall'], zone: 'intake' },
      { id: 'intake-hall', position: new Vector3(8, 0, 0), neighbors: ['intake', 'lobby-west'], zone: 'intake' },
      { id: 'lobby-west', position: new Vector3(14, 0, 0), neighbors: ['intake-hall', 'lobby-center', 'security-hall'], zone: 'lobby' },
      { id: 'lobby-center', position: new Vector3(21, 0, 0), neighbors: ['lobby-west', 'research-entry', 'maint-hub'], zone: 'lobby' },
      { id: 'security-hall', position: new Vector3(20, 0, -10), neighbors: ['lobby-west', 'security-room'], zone: 'security' },
      { id: 'security-room', position: new Vector3(20, 0, -14), neighbors: ['security-hall'], zone: 'security' },
      { id: 'maint-hub', position: new Vector3(34, 0, 7), neighbors: ['lobby-center', 'maint-gen'], zone: 'maintenance' },
      { id: 'maint-gen', position: new Vector3(34, 0, 18), neighbors: ['maint-hub'], zone: 'maintenance' },
      { id: 'research-entry', position: new Vector3(34, 0, -6), neighbors: ['lobby-center', 'research-lab'], zone: 'research' },
      { id: 'research-lab', position: new Vector3(48, 0, -6), neighbors: ['research-entry', 'archive-hall'], zone: 'research' },
      { id: 'archive-hall', position: new Vector3(60, 0, -6), neighbors: ['research-lab', 'underground-west'], zone: 'research' },
      { id: 'underground-west', position: new Vector3(68, 0, -6), neighbors: ['archive-hall', 'underground-east', 'shelter'], zone: 'underground' },
      { id: 'underground-east', position: new Vector3(82, 0, -6), neighbors: ['underground-west', 'core-hall'], zone: 'underground' },
      { id: 'shelter', position: new Vector3(74, 0, 8), neighbors: ['underground-west'], zone: 'underground' },
      { id: 'core-hall', position: new Vector3(90, 0, -6), neighbors: ['underground-east', 'core-room'], zone: 'core' },
      { id: 'core-room', position: new Vector3(104, 0, -6), neighbors: ['core-hall'], zone: 'core' },
    ];

    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
  }

  private createCameras(): void {
    this.addCamera('lobby-cam', 'Lobby Camera 04', new Vector3(24, 2.6, -6.8), new Vector3(18, 1.4, 0), 'Reception and waiting area.');
    this.addCamera('research-cam', 'Research Corridor', new Vector3(52, 2.8, -12.8), new Vector3(48, 1.5, -6), 'Chamber corridor: occasional signal drop.');
    this.addCamera('archive-cam', 'Underground Tunnel', new Vector3(68, 2.6, -1), new Vector3(80, 1.5, -6), 'Archive blast hall and lower tunnel.');
    this.addCamera('core-cam', 'Core Chamber', new Vector3(104, 2.8, -13.2), new Vector3(104, 1.5, -6), 'Containment lattice observation.');
  }

  private createTerminals(): void {
    this.terminals.set('security-terminal', {
      id: 'security-terminal',
      name: 'SECURITY STATION',
      files: [
        {
          title: 'INCIDENT SNAPSHOT',
          body: 'Security seal log:\n- Multiple internal doors moved without user input\n- Camera 04 reported a figure in the lobby after evacuation\n- Suppression Core rejected remote unlock requests\n- Last live order: reroute power to Research and verify Chamber telemetry',
        },
        {
          title: 'STAFF MAIL: HALE',
          body: 'If Maintenance lost their access cards, the Level 2 security card stays in the lower desk drawer. Do not send anyone alone below the archive gate again.',
        },
      ],
      cameras: ['lobby-cam', 'research-cam'],
      actions: [
        { id: 'route-maintenance', label: 'Reroute grid diagnostics', description: 'Highlights Maintenance as the only active power route.' },
      ],
    });

    this.terminals.set('research-terminal', {
      id: 'research-terminal',
      name: 'RESEARCH ACCESS NODE',
      username: 'hale',
      password: 'suppression',
      files: [
        {
          title: 'FIELD NOTES / CHAMBER 4',
          body: 'The phenomenon mirrors pressure, voice, and intent. The more directly observed it becomes, the more physical it appears. We started calling the roaming residue the Suppressor when it began tracing staff routes on its own.',
        },
        {
          title: 'EMAIL / CORE LOCKDOWN',
          body: 'To reach the core you need the Level 3 card relocated to the lower shelter. Archive blast code remains unchanged: 4138. If anyone is still there, do not speak to the chamber through the lattice.',
        },
      ],
      cameras: ['research-cam', 'archive-cam'],
      actions: [
        { id: 'unlock-archive', label: 'Flag archive code in notes', description: 'Marks the archive code as verified in your objective log.' },
      ],
    });

    this.terminals.set('core-terminal', {
      id: 'core-terminal',
      name: 'SUPPRESSION CORE',
      files: [
        {
          title: 'LATTICE DIAGNOSTICS',
          body: 'Containment was never a cage. The lattice compressed perception, isolating the phenomenon from human observers. The event occurred when the system tried to suppress people and phenomenon alike.',
        },
        {
          title: 'ESCAPE ROUTING',
          body: 'Once all three lattice switches are restored you may either stabilize the suppression field and escape, or purge the facility with the entity still inside. Stabilization preserves the research. Purge burns everything.',
        },
      ],
      cameras: ['core-cam'],
      actions: [
        { id: 'ending-stabilize', label: 'Stabilize lattice', description: 'Restore the field and flee while the facility holds.' },
        { id: 'ending-purge', label: 'Purge containment', description: 'Overload the core, destroy the wing, and escape.' },
      ],
    });
  }

  private createParticles(): void {
    const layers = [
      { x: 20, z: 0, w: 18, d: 16, count: 200 },
      { x: 48, z: -6, w: 18, d: 16, count: 180 },
      { x: 74, z: -6, w: 24, d: 12, count: 260 },
    ];

    for (const layer of layers) {
      const positions = new Float32Array(layer.count * 3);
      for (let index = 0; index < layer.count; index += 1) {
        positions[index * 3 + 0] = (Math.random() - 0.5) * layer.w;
        positions[index * 3 + 1] = Math.random() * 2.8;
        positions[index * 3 + 2] = (Math.random() - 0.5) * layer.d;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const particles = new Points(
        geometry,
        new PointsMaterial({ color: 0x75849b, size: 0.04, transparent: true, opacity: 0.25 }),
      );
      particles.position.set(layer.x, 1.2, layer.z);
      particles.userData.spin = (Math.random() - 0.5) * 0.06;
      particles.userData.phase = Math.random() * 10;
      this.particleLayers.push(particles);
      this.root.add(particles);
    }
  }

  private addDoor(id: string, x: number, z: number, orientation: 'east' | 'south', options: DoorOptions): Door {
    const doorRoot = new Group();
    doorRoot.position.set(x, 0, z);
    const frameMaterial = new MeshStandardMaterial({ color: 0x444b55, roughness: 0.55, metalness: 0.7 });
    const panelMaterial = new MeshStandardMaterial({ color: 0x1d252f, roughness: 0.55, metalness: 0.8 });

    const frameL = new Mesh(new BoxGeometry(0.18, 3.1, 0.18), frameMaterial);
    const frameR = frameL.clone();
    const header = new Mesh(new BoxGeometry(1.42, 0.22, 0.18), frameMaterial);
    const panel = new Mesh(new BoxGeometry(1.2, 2.75, 0.12), panelMaterial);
    panel.castShadow = true;
    panel.receiveShadow = true;

    const panelGroup = new Group();
    panel.position.set(0.6, 1.36, 0);
    panelGroup.add(panel);

    frameL.position.set(0, 1.55, 0);
    frameR.position.set(1.2, 1.55, 0);
    header.position.set(0.6, 2.96, 0);

    doorRoot.add(frameL, frameR, header, panelGroup);
    if (orientation === 'south') {
      doorRoot.rotation.y = Math.PI / 2;
    }
    this.root.add(doorRoot);

    const collider = {
      id: `${id}-collider`,
      box: new Box3().setFromCenterAndSize(new Vector3(x, 1.4, z), orientation === 'east' ? new Vector3(0.3, 3, 1.5) : new Vector3(1.5, 3, 0.3)),
      enabled: true,
      tag: 'door',
    };
    this.colliders.push(collider);

    const door = new Door(id, doorRoot, panelGroup, collider, options);
    if (options.strange) {
      this.strangeDoors.push(door);
    }
    return door;
  }

  private makePickup(
    id: string,
    object: Object3D,
    item: { id: string; name: string; type: 'battery' | 'key' | 'keycard' | 'fuse' | 'tool' | 'medical' | 'document' | 'audio' | 'puzzle' | 'story'; description: string; quantity: number },
    onPickup?: (game: import('../game/Game').Game) => void,
  ): PickupInteractable {
    this.root.add(object);
    return new PickupInteractable(id, object, item, (game) => onPickup?.(game));
  }

  private makeDocument(id: string, object: Object3D, title: string, body: string, stored?: { id: string; name: string; type: 'document' | 'audio'; description: string; quantity: number }): DocumentInteractable {
    this.root.add(object);
    return new DocumentInteractable(id, object, title, body, stored);
  }

  private makeBreaker(id: string, x: number, y: number, z: number, label: string): BreakerInteractable {
    const box = new Mesh(new BoxGeometry(0.6, 0.9, 0.18), new MeshStandardMaterial({ color: 0x575e66, roughness: 0.6, metalness: 0.6 }));
    box.position.set(x, y, z);
    this.root.add(box);
    return new BreakerInteractable(id, box, id, label);
  }

  private makeFuseBox(id: string, x: number, y: number, z: number): FuseBoxInteractable {
    const box = new Mesh(new BoxGeometry(0.9, 1, 0.22), new MeshStandardMaterial({ color: 0x666d74, roughness: 0.65, metalness: 0.6 }));
    box.position.set(x, y, z);
    this.root.add(box);
    return new FuseBoxInteractable(id, box);
  }

  private makeTerminal(id: string, x: number, y: number, z: number, terminalId: string): TerminalInteractable {
    const group = new Group();
    const desk = new Mesh(new BoxGeometry(1.2, 0.75, 0.7), new MeshStandardMaterial({ color: 0x29313a, roughness: 0.7, metalness: 0.5 }));
    desk.position.y = 0.37;
    const screen = new Mesh(new BoxGeometry(0.85, 0.48, 0.05), new MeshBasicMaterial({ color: 0x66c5ff }));
    screen.position.set(0, 0.93, -0.15);
    group.add(desk, screen);
    group.position.set(x, 0, z);
    this.root.add(group);
    this.animatedScreens.push(screen);
    return new TerminalInteractable(id, group, terminalId);
  }

  private makeKeypad(id: string, x: number, y: number, z: number, keypadId: string): KeypadInteractable {
    const keypad = new Mesh(new BoxGeometry(0.35, 0.5, 0.08), new MeshStandardMaterial({ color: 0x738190, emissive: new Color(0x17334a), emissiveIntensity: 0.7 }));
    keypad.position.set(x, y, z);
    this.root.add(keypad);
    return new KeypadInteractable(id, keypad, keypadId);
  }

  private makeHideLocker(id: string, x: number, z: number): HideSpotInteractable {
    const group = new Group();
    const body = new Mesh(new BoxGeometry(1, 2.2, 0.95), new MeshStandardMaterial({ color: 0x374049, roughness: 0.75, metalness: 0.8 }));
    body.position.y = 1.1;
    group.add(body);
    group.position.set(x, 0, z);
    this.root.add(group);
    this.colliders.push({ id: `${id}-collider`, box: new Box3().setFromObject(group), enabled: true, tag: 'decor' });
    return new HideSpotInteractable(id, group, makeHideSpotView(id, group, new Vector3(0, 0, 0), new Vector3(1.4, 0, 0)));
  }

  private makeHideDesk(id: string, x: number, z: number): HideSpotInteractable {
    const anchor = new Group();
    const sensor = new Mesh(
      new BoxGeometry(1.4, 0.9, 1.2),
      new MeshStandardMaterial({ color: 0x2b3138, roughness: 1, metalness: 0, transparent: true, opacity: 0.01 }),
    );
    sensor.position.y = 0.45;
    anchor.add(sensor);
    anchor.position.set(x, 0, z);
    this.root.add(anchor);
    return new HideSpotInteractable(id, anchor, makeHideSpotView(id, anchor, new Vector3(0, 0, 1.3), new Vector3(0, 0, 2.1)));
  }

  private makeCoreSwitch(id: string, x: number, y: number, z: number, index: number, suffix: number): SwitchInteractable {
    const box = new Mesh(new BoxGeometry(0.5, 0.7, 0.18), new MeshStandardMaterial({ color: 0x5f6771, emissive: new Color(0x111319), emissiveIntensity: 0.4 }));
    box.position.set(x, y, z);
    this.root.add(box);
    return new SwitchInteractable(id, box, `Lattice switch ${suffix + 1} restored.`, (game) => game.activateCoreSwitch(index), '[E] RESTORE LATTICE');
  }

  private addCamera(id: string, name: string, position: Vector3, lookAt: Vector3, hint: string): void {
    const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 120);
    camera.position.copy(position);
    camera.lookAt(lookAt);
    this.scene.add(camera);
    this.cameras.set(id, {
      id,
      name,
      camera,
      hint,
      anomaly: id === 'research-cam' ? 'A thin silhouette can occasionally be seen crossing the far chamber.' : undefined,
    });
  }

  private createPickupMesh(x: number, y: number, z: number, color: number, kind: string): Group {
    const group = new Group();
    const material = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.65, emissive: new Color(color).multiplyScalar(0.12) });
    const body = new Mesh(new BoxGeometry(kind === 'battery' ? 0.22 : kind === 'keycard' ? 0.4 : 0.28, 0.12, kind === 'flashlight' ? 0.55 : 0.18), material);
    if (kind === 'flashlight') {
      const head = new Mesh(new BoxGeometry(0.18, 0.18, 0.18), material);
      head.position.z = -0.32;
      group.add(head);
    }
    group.add(body);
    group.position.set(x, y, z);
    return group;
  }

  private createDocumentMesh(x: number, y: number, z: number): Mesh {
    const texture = this.createPaperTexture();
    const mesh = new Mesh(
      new PlaneGeometry(0.45, 0.32),
      new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  private addDesk(group: Group, x: number, z: number, width: number): void {
    const material = new MeshStandardMaterial({ color: 0x40464e, roughness: 0.7, metalness: 0.6 });
    const top = new Mesh(new BoxGeometry(width, 0.1, 1.1), material);
    top.position.set(x, 0.78, z);
    group.add(top);
    for (const dx of [-width / 2 + 0.15, width / 2 - 0.15]) {
      for (const dz of [-0.45, 0.45]) {
        const leg = new Mesh(new BoxGeometry(0.1, 0.78, 0.1), material);
        leg.position.set(x + dx, 0.39, z + dz);
        group.add(leg);
      }
    }
    this.colliders.push({ id: `desk-${x}-${z}`, box: new Box3().setFromCenterAndSize(new Vector3(x, 0.55, z), new Vector3(width, 1.1, 1.3)), enabled: true, tag: 'decor' });
  }

  private addLabBench(group: Group, x: number, z: number): void {
    this.addDesk(group, x, z, 4);
    const equipment = new Mesh(new BoxGeometry(0.42, 0.65, 0.42), new MeshStandardMaterial({ color: 0x76808c, roughness: 0.4, metalness: 0.7 }));
    equipment.position.set(x - 1.2, 1.15, z);
    const tank = new Mesh(new BoxGeometry(0.28, 0.8, 0.28), new MeshStandardMaterial({ color: 0x4a6578, roughness: 0.3, metalness: 0.65 }));
    tank.position.set(x + 1.3, 1.18, z - 0.1);
    group.add(equipment, tank);
  }

  private addBench(group: Group, x: number, z: number, width: number): void {
    const material = new MeshStandardMaterial({ color: 0x50565f, roughness: 0.8, metalness: 0.25 });
    const seat = new Mesh(new BoxGeometry(width, 0.12, 0.5), material);
    const back = new Mesh(new BoxGeometry(width, 0.5, 0.1), material);
    seat.position.set(x, 0.55, z);
    back.position.set(x, 0.85, z - 0.2);
    group.add(seat, back);
  }

  private addShelf(group: Group, x: number, z: number, width: number, height: number): void {
    const material = new MeshStandardMaterial({ color: 0x46505a, roughness: 0.7, metalness: 0.65 });
    const sideL = new Mesh(new BoxGeometry(0.08, height, 0.6), material);
    const sideR = sideL.clone();
    sideL.position.set(x - width / 2, height / 2, z);
    sideR.position.set(x + width / 2, height / 2, z);
    group.add(sideL, sideR);
    for (let index = 0; index < 4; index += 1) {
      const board = new Mesh(new BoxGeometry(width, 0.07, 0.6), material);
      board.position.set(x, 0.2 + index * (height / 3.8), z);
      group.add(board);
    }
    this.colliders.push({ id: `shelf-${x}-${z}`, box: new Box3().setFromCenterAndSize(new Vector3(x, height / 2, z), new Vector3(width + 0.1, height, 0.75)), enabled: true, tag: 'decor' });
  }

  private addCabinet(group: Group, x: number, z: number, size: 'small' | 'large'): void {
    const width = size === 'large' ? 1.5 : 0.9;
    const depth = size === 'large' ? 0.8 : 0.55;
    const height = size === 'large' ? 1.5 : 1.1;
    const body = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: 0x4b525c, roughness: 0.8, metalness: 0.6 }));
    body.position.set(x, height / 2, z);
    group.add(body);
    this.colliders.push({ id: `cabinet-${x}-${z}`, box: new Box3().setFromObject(body), enabled: true, tag: 'decor' });
  }

  private addLocker(group: Group, x: number, z: number, count: number): void {
    const material = new MeshStandardMaterial({ color: 0x39424a, roughness: 0.75, metalness: 0.7 });
    for (let index = 0; index < count; index += 1) {
      const mesh = new Mesh(new BoxGeometry(0.8, 2.1, 0.85), material);
      mesh.position.set(x + index * 0.85, 1.05, z);
      group.add(mesh);
    }
    this.colliders.push({ id: `locker-${x}-${z}`, box: new Box3().setFromCenterAndSize(new Vector3(x + (count - 1) * 0.425, 1.05, z), new Vector3(count * 0.85, 2.1, 0.95)), enabled: true, tag: 'decor' });
  }

  private addPlantPot(group: Group, x: number, z: number): void {
    const pot = new Mesh(new BoxGeometry(0.45, 0.55, 0.45), new MeshStandardMaterial({ color: 0x4b403a, roughness: 0.85 }));
    const leaves = new Mesh(new BoxGeometry(0.7, 0.9, 0.7), new MeshStandardMaterial({ color: 0x293c33, roughness: 1 }));
    pot.position.set(x, 0.28, z);
    leaves.position.set(x, 1.05, z);
    group.add(pot, leaves);
  }

  private addWallMonitor(group: Group, x: number, z: number, wallZ: number, rotation: number, color: number): void {
    const screen = new Mesh(new BoxGeometry(1.4, 0.8, 0.06), new MeshBasicMaterial({ color }));
    screen.position.set(x, 1.8, wallZ);
    screen.rotation.y = rotation;
    group.add(screen);
    this.animatedScreens.push(screen);
  }

  private addPipeRun(group: Group, x: number, z: number, length: number, horizontal: boolean): void {
    const material = new MeshStandardMaterial({ color: 0x5d636d, roughness: 0.55, metalness: 0.85 });
    for (let index = 0; index < 3; index += 1) {
      const mesh = new Mesh(
        new BoxGeometry(horizontal ? length : 0.22, 0.22, horizontal ? 0.22 : length),
        material,
      );
      mesh.position.set(x, 2.8 - index * 0.35, z + index * 0.35);
      group.add(mesh);
    }
  }

  private addFan(group: Group, x: number, z: number): void {
    const root = new Group();
    root.position.set(x, 2.7, z);
    const hub = new Mesh(new BoxGeometry(0.15, 0.15, 0.15), new MeshStandardMaterial({ color: 0x69727a, roughness: 0.35, metalness: 0.85 }));
    root.add(hub);
    for (let index = 0; index < 4; index += 1) {
      const blade = new Mesh(new BoxGeometry(0.8, 0.04, 0.12), new MeshStandardMaterial({ color: 0x505962, roughness: 0.4, metalness: 0.7 }));
      blade.rotation.z = (Math.PI / 2) * index;
      blade.position.x = 0.4;
      const bladeRoot = new Group();
      bladeRoot.rotation.z = (Math.PI / 2) * index;
      bladeRoot.add(blade);
      root.add(bladeRoot);
    }
    root.userData.speed = 4 + Math.random() * 1.8;
    this.fans.push(root);
    group.add(root);
  }

  private addGenerator(group: Group, x: number, z: number): void {
    const body = new Mesh(new BoxGeometry(2.4, 1.7, 1.2), new MeshStandardMaterial({ color: 0x4e545b, roughness: 0.7, metalness: 0.8 }));
    body.position.set(x, 0.85, z);
    group.add(body);
    this.colliders.push({ id: `generator-${x}-${z}`, box: new Box3().setFromObject(body), enabled: true, tag: 'decor' });
  }

  private addToolCart(group: Group, x: number, z: number): void {
    const cart = new Mesh(new BoxGeometry(1.2, 0.95, 0.8), new MeshStandardMaterial({ color: 0x5b6067, roughness: 0.55, metalness: 0.75 }));
    cart.position.set(x, 0.48, z);
    group.add(cart);
    this.colliders.push({ id: `cart-${x}-${z}`, box: new Box3().setFromObject(cart), enabled: true, tag: 'decor' });
  }

  private addContainmentFrame(group: Group, x: number, z: number): void {
    const material = new MeshStandardMaterial({ color: 0x5a6770, roughness: 0.45, metalness: 0.85, emissive: new Color(0x143347), emissiveIntensity: 0.35 });
    const frame = new Mesh(new BoxGeometry(3.6, 2.8, 0.15), material);
    frame.position.set(x, 1.45, z);
    group.add(frame);
  }

  private addFloodPlane(group: Group, x: number, z: number, width: number, depth: number): void {
    const water = new Mesh(new BoxGeometry(width, 0.02, depth), new MeshStandardMaterial({ color: 0x243445, roughness: 0.18, metalness: 0.12, transparent: true, opacity: 0.72 }));
    water.position.set(x, 0.02, z);
    group.add(water);
  }

  private addBed(group: Group, x: number, z: number, rotation = 0): void {
    const frame = new Mesh(new BoxGeometry(2, 0.45, 0.9), new MeshStandardMaterial({ color: 0x525962, roughness: 0.72, metalness: 0.62 }));
    const mattress = new Mesh(new BoxGeometry(1.8, 0.18, 0.78), new MeshStandardMaterial({ color: 0x7c8186, roughness: 1 }));
    frame.position.set(x, 0.22, z);
    mattress.position.set(x, 0.53, z);
    frame.rotation.y = rotation;
    mattress.rotation.y = rotation;
    group.add(frame, mattress);
  }

  private addPropDebris(group: Group, x: number, z: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const mesh = new Mesh(
        new BoxGeometry(0.1 + Math.random() * 0.3, 0.06 + Math.random() * 0.1, 0.1 + Math.random() * 0.3),
        new MeshStandardMaterial({ color: 0x3e4349, roughness: 1, metalness: 0.1 }),
      );
      mesh.position.set(x + (Math.random() - 0.5) * 3.4, 0.05, z + (Math.random() - 0.5) * 3.4);
      mesh.rotation.y = Math.random() * Math.PI;
      group.add(mesh);
    }
  }

  private addCoreMachine(group: Group, x: number, z: number): void {
    const central = new Mesh(new BoxGeometry(2.4, 5.2, 2.4), new MeshStandardMaterial({ color: 0x4c5460, roughness: 0.35, metalness: 0.82, emissive: new Color(0x10374f), emissiveIntensity: 0.3 }));
    central.position.set(x, 2.6, z);
    group.add(central);
    this.colliders.push({ id: 'core-machine', box: new Box3().setFromObject(central), enabled: true, tag: 'decor' });
  }

  private addControlRing(group: Group, x: number, z: number): void {
    const material = new MeshStandardMaterial({ color: 0x67717d, roughness: 0.42, metalness: 0.85 });
    const offsets: Array<[number, number]> = [[-3.2, 0], [3.2, 0], [0, -3.2], [0, 3.2]];
    for (const [ox, oz] of offsets) {
      const pillar = new Mesh(new BoxGeometry(0.8, 2.1, 0.8), material);
      pillar.position.set(x + ox, 1.05, z + oz);
      group.add(pillar);
    }
  }

  private createStripeTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) {
      return new CanvasTexture(canvas);
    }
    context.fillStyle = '#232830';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += 32) {
      context.fillStyle = y % 64 === 0 ? '#303842' : '#242c34';
      context.fillRect(0, y, canvas.width, 16);
    }
    for (let x = 0; x < canvas.width; x += 64) {
      context.fillStyle = 'rgba(255,255,255,0.025)';
      context.fillRect(x, 0, 6, canvas.height);
    }
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createPaperTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) {
      return new CanvasTexture(canvas);
    }
    context.fillStyle = '#cdc8ba';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(20,20,20,0.18)';
    for (let y = 24; y < canvas.height; y += 20) {
      context.beginPath();
      context.moveTo(16, y);
      context.lineTo(canvas.width - 16, y + Math.sin(y * 0.1) * 2);
      context.stroke();
    }
    context.fillStyle = '#1d2127';
    context.fillRect(20, 18, 112, 16);
    context.fillStyle = '#45413c';
    context.fillRect(20, 48, 180, 5);
    context.fillRect(20, 76, 155, 5);
    context.fillRect(20, 104, 164, 5);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private circleIntersectsBox(x: number, z: number, radius: number, box: Box3): boolean {
    const closestX = Math.max(box.min.x, Math.min(x, box.max.x));
    const closestZ = Math.max(box.min.z, Math.min(z, box.max.z));
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }

  private zoneName(zone: ZoneId): string {
    switch (zone) {
      case 'intake': return 'Intake Chamber';
      case 'lobby': return 'Main Lobby';
      case 'security': return 'Security';
      case 'research': return 'Research Wing';
      case 'maintenance': return 'Maintenance';
      case 'underground': return 'Underground';
      case 'core': return 'Suppression Core';
      default:
        return 'Facility';
    }
  }
}
