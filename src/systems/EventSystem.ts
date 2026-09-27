import type { Game } from '../game/Game';

export class EventSystem {
  private cooldown = 10;
  private firstAnomalyDone = false;
  private lastEvent = '';

  public reset(): void {
    this.cooldown = 10;
    this.firstAnomalyDone = false;
    this.lastEvent = '';
  }

  public update(dt: number, game: Game): void {
    this.cooldown -= dt;

    if (game.progress.intakeDoorUnlocked && !this.firstAnomalyDone && game.facility.getZoneId(game.player.position) === 'lobby') {
      this.firstAnomalyDone = true;
      game.progress.introSightedSuppressor = true;
      const door = game.facility.triggerStrangeDoor();
      game.audio.playMetalCreak();
      game.queueSubtitle('UNKNOWN', '...hello?', 3.2);
      if (door) {
        game.ui.flashNotice('A heavy door slams somewhere behind you.');
      }
      this.cooldown = 14;
      return;
    }

    if (this.cooldown > 0 || !game.progress.flashlightFound) {
      return;
    }

    const zone = game.facility.getZoneId(game.player.position);
    const possible: string[] = [];

    if (zone !== 'intake') {
      possible.push('radio');
    }
    if (zone === 'research' || zone === 'maintenance') {
      possible.push('door', 'footsteps');
    }
    if (zone === 'underground') {
      possible.push('whisper', 'door');
    }
    if (game.progress.researchPowerRestored && zone !== 'core') {
      possible.push('ambush');
    }
    if (zone === 'core') {
      possible.push('whisper', 'radio');
    }

    const filtered = possible.filter((item) => item !== this.lastEvent);
    if (filtered.length === 0) {
      this.cooldown = 8;
      return;
    }

    const event = filtered[Math.floor(Math.random() * filtered.length)];
    this.lastEvent = event;
    this.cooldown = 18 + Math.random() * 16;

    switch (event) {
      case 'door': {
        const door = game.facility.triggerStrangeDoor();
        if (door) {
          game.audio.playDoor(true, false);
          game.notifyNoise(door.object.position, 0.8);
        }
        break;
      }
      case 'footsteps':
        game.audio.playFootstepsInDistance();
        game.ui.pushSubtitle('[DISTANT FOOTSTEPS]', '', 2.4);
        break;
      case 'radio':
        game.audio.playRadioBurst();
        game.queueSubtitle('ANNOUNCEMENT', 'Containment failure persists. Avoid visual fixation. Seek routed power and core access.', 5.4);
        break;
      case 'whisper':
        game.audio.playDistortedWhisper();
        game.queueSubtitle('UNKNOWN', 'Do you remember opening the door?', 3.7);
        break;
      case 'ambush':
        if (game.suppressor.active) {
          game.suppressor.triggerAmbush(game.player.position, game.facility);
        }
        break;
      default:
        break;
    }
  }
}
