import type { InventoryItemData, ItemType } from '../types';

export class Inventory {
  private items: InventoryItemData[] = [];

  public add(item: Omit<InventoryItemData, 'quantity'> & { quantity?: number }): InventoryItemData {
    const quantity = item.quantity ?? 1;
    const existing = this.items.find((entry) => entry.id === item.id);
    if (existing) {
      existing.quantity += quantity;
      return existing;
    }

    const created: InventoryItemData = {
      ...item,
      quantity,
    };
    this.items.push(created);
    return created;
  }

  public remove(id: string, amount = 1): boolean {
    const existing = this.items.find((entry) => entry.id === id);
    if (!existing) {
      return false;
    }
    existing.quantity -= amount;
    if (existing.quantity <= 0) {
      this.items = this.items.filter((entry) => entry !== existing);
    }
    return true;
  }

  public has(id: string): boolean {
    return this.items.some((entry) => entry.id === id && entry.quantity > 0);
  }

  public findByType(type: ItemType): InventoryItemData[] {
    return this.items.filter((entry) => entry.type === type);
  }

  public get(id: string): InventoryItemData | undefined {
    return this.items.find((entry) => entry.id === id);
  }

  public serialize(): InventoryItemData[] {
    return this.items.map((item) => ({
      ...item,
      metadata: item.metadata ? { ...item.metadata } : undefined,
    }));
  }

  public deserialize(items: InventoryItemData[]): void {
    this.items = items.map((item) => ({
      ...item,
      metadata: item.metadata ? { ...item.metadata } : undefined,
    }));
  }

  public clear(): void {
    this.items = [];
  }

  public getItems(): InventoryItemData[] {
    return this.items;
  }
}
