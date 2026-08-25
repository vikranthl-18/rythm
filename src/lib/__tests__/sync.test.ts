import { afterEach, describe, expect, it } from "vitest";
import { lastSyncedAt, pickSyncDirection, setLastSyncedAt } from "../sync";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("pickSyncDirection", () => {
  it("pushes when there is no cloud row (first sync)", () => {
    expect(pickSyncDirection("2026-08-10T10:00:00Z", null)).toEqual({ pull: false, push: true });
  });

  it("pulls when this device has never synced but the cloud exists", () => {
    expect(pickSyncDirection(null, "2026-08-10T10:00:00Z")).toEqual({ pull: true, push: false });
  });

  it("pulls when the cloud is newer", () => {
    expect(pickSyncDirection("2026-08-10T10:00:00Z", "2026-08-11T10:00:00Z")).toEqual({
      pull: true,
      push: false,
    });
  });

  it("pushes when local is newer than the cloud", () => {
    expect(pickSyncDirection("2026-08-12T10:00:00Z", "2026-08-11T10:00:00Z")).toEqual({
      pull: false,
      push: true,
    });
  });

  it("pushes on equal timestamps (idempotent upsert)", () => {
    expect(pickSyncDirection("2026-08-10T10:00:00Z", "2026-08-10T10:00:00Z")).toEqual({
      pull: false,
      push: true,
    });
  });
});

describe("lastSyncedAt", () => {
  it("returns null when nothing was synced", () => {
    expect(lastSyncedAt()).toBeNull();
  });

  it("round-trips the last sync timestamp", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    setLastSyncedAt("2026-08-11T09:30:00Z");
    expect(lastSyncedAt()).toBe("2026-08-11T09:30:00Z");
  });
});
