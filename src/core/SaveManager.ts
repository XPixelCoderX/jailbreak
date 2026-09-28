import { DEFAULT_SAVE_SLOT, SAVE_SLOTS } from '../config/constants';
import { migrateSettings, type GameSettings, type SaveData } from '../types';

const SETTINGS_KEY = 'lost-suppression-settings';
const SLOT_PREFIX = 'lost-suppression-slot-';

export interface SaveSlotSummary {
  slot: number;
  label: string;
  timestamp: number;
  exists: boolean;
}

export class SaveManager {
  public save(slot: number, data: SaveData): void {
    localStorage.setItem(`${SLOT_PREFIX}${slot}`, JSON.stringify(data));
  }

  public load(slot: number): SaveData | null {
    const raw = localStorage.getItem(`${SLOT_PREFIX}${slot}`);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as SaveData;
    } catch (error) {
      console.error('Failed to parse save slot', slot, error);
      return null;
    }
  }

  public listSlots(): SaveSlotSummary[] {
    return Array.from({ length: SAVE_SLOTS }, (_, index) => {
      const slot = index + 1;
      const data = this.load(slot);
      return {
        slot,
        label: data?.label ?? `Empty Slot ${slot}`,
        timestamp: data?.timestamp ?? 0,
        exists: Boolean(data),
      };
    });
  }

  public getLatestSave(): SaveData | null {
    const saves = this.listSlots()
      .filter((slot) => slot.exists)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (saves.length === 0) {
      return null;
    }
    return this.load(saves[0].slot);
  }

  public saveSettings(settings: GameSettings): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  public loadSettings(): GameSettings | null {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return null;
    }
    try {
      return migrateSettings(JSON.parse(raw));
    } catch (error) {
      console.error('Failed to parse settings', error);
      return null;
    }
  }

  public getDefaultContinueSlot(): number {
    return this.getLatestSave()?.slot ?? DEFAULT_SAVE_SLOT;
  }
}
