import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  loadFeatures,
  saveFeatures,
  type FeatureFlags,
} from "../featureFlags";

// A minimal in-memory localStorage for the node test env.
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

describe("loadFeatures", () => {
  it("returns all-on defaults when nothing is stored", () => {
    expect(loadFeatures()).toEqual(DEFAULT_FEATURES);
  });

  it("sanitizes a stored payload: unknown keys fall back to on", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    localStorage.setItem("rythm-features", JSON.stringify({ aiCoach: false }));
    const f = loadFeatures();
    expect(f.aiCoach).toBe(false);
    expect(f.weeklyDigest).toBe(true);
    expect(f.beatLastWeek).toBe(true);
    expect(f.autoHabits).toBe(true);
  });

  it("ignores a corrupt payload and uses defaults", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    localStorage.setItem("rythm-features", "{not json");
    expect(loadFeatures()).toEqual(DEFAULT_FEATURES);
  });
});

describe("saveFeatures", () => {
  it("round-trips through localStorage", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    const f: FeatureFlags = {
      aiCoach: false,
      weeklyDigest: false,
      beatLastWeek: false,
      autoHabits: false,
    };
    saveFeatures(f);
    expect(loadFeatures()).toEqual(f);
  });

  it("never throws when storage is unavailable", () => {
    expect(() => saveFeatures(DEFAULT_FEATURES)).not.toThrow();
  });
});
