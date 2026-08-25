import { afterEach, describe, expect, it } from "vitest";
import { loadTourSeen, saveTourSeen } from "../tour";

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

describe("tour persistence", () => {
  it("is unseen by default", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    expect(loadTourSeen("alex.rivera@gmail.com")).toBe(false);
  });

  it("round-trips seen/unseen per account", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    saveTourSeen("alex.rivera@gmail.com", true);
    expect(loadTourSeen("alex.rivera@gmail.com")).toBe(true);
    // A different account is untouched.
    expect(loadTourSeen("sam.patel@gmail.com")).toBe(false);
    // Replaying clears it.
    saveTourSeen("alex.rivera@gmail.com", false);
    expect(loadTourSeen("alex.rivera@gmail.com")).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    expect(() => saveTourSeen("x@y.com", true)).not.toThrow();
    expect(loadTourSeen("x@y.com")).toBe(false);
  });
});
