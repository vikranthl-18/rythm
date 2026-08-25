import { afterEach, describe, expect, it } from "vitest";
import {
  accountDataFor,
  clearDeletedAccount,
  demoAccountData,
  deviceLayerActive,
  freshAccountData,
  isDeletedAccount,
  loadAccountData,
  markDeletedAccount,
  saveAccountData,
  wipeAccountKeys,
} from "../accountData";
import { isDemoEmail } from "../../data/seed";

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

describe("isDemoEmail", () => {
  it("demo chooser accounts are demo", () => {
    expect(isDemoEmail("alex.rivera@gmail.com")).toBe(true);
    expect(isDemoEmail("SAM.PATEL@GMAIL.COM")).toBe(true);
  });
  it("everyone else is a real user", () => {
    expect(isDemoEmail("real.user@gmail.com")).toBe(false);
    expect(isDemoEmail("user@company.com")).toBe(false);
  });
});

describe("freshAccountData", () => {
  it("starts a real account blank: one day, no history, no devices", () => {
    const f = freshAccountData();
    expect(f.days.length).toBe(1);
    expect(f.workouts).toEqual([]);
    expect(f.habits).toEqual([]);
    expect(f.devices).toEqual([]);
  });

  it("carries NO seed vitals — no sleep score, HRV, recovery or temp from the demo dataset", () => {
    const f = freshAccountData();
    const d = f.days[0];
    expect(d.sleep.score).toBe(0);
    expect(d.sleep.durationMin).toBe(0);
    expect(d.sleep.needMin).toBe(0);
    expect(d.hrv).toBe(0);
    expect(d.restingHR).toBe(0);
    expect(d.recovery).toBe(0);
    expect(d.skinTemp).toBe(0);
    expect(d.spo2).toBe(0);
    expect(d.respRate).toBe(0);
    expect(d.steps).toBe(0);
    expect(d.calories).toBe(0);
    expect(d.strain).toBe(0);
  });
});

describe("deviceLayerActive", () => {
  it("demo accounts always have a device layer (the seeded dataset)", () => {
    expect(deviceLayerActive([], false, "alex.rivera@gmail.com")).toBe(true);
    expect(deviceLayerActive([], false, "SAM.PATEL@GMAIL.COM")).toBe(true);
  });
  it("a configured device slot or live BLE enables the layer", () => {
    expect(deviceLayerActive([{}], false, "real.user@gmail.com")).toBe(true);
    expect(deviceLayerActive([], true, "real.user@gmail.com")).toBe(true);
  });
  it("a real account with no device has NO layer — the sim must not fabricate", () => {
    expect(deviceLayerActive([], false, "real.user@gmail.com")).toBe(false);
    expect(deviceLayerActive([], false, "user@company.com")).toBe(false);
  });
});

describe("demoAccountData", () => {
  it("seeds the full demo dataset", () => {
    const d = demoAccountData();
    expect(d.days.length).toBeGreaterThan(1);
    expect(d.workouts.length).toBeGreaterThan(0);
    expect(d.habits.length).toBeGreaterThan(0);
    expect(d.devices.length).toBeGreaterThan(0);
  });
});

describe("deletion tombstone", () => {
  it("marks and clears a deleted account (per email)", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    expect(isDeletedAccount("real.user@gmail.com")).toBe(false);
    markDeletedAccount("real.user@gmail.com");
    expect(isDeletedAccount("real.user@gmail.com")).toBe(true);
    expect(isDeletedAccount("other@gmail.com")).toBe(false);
    clearDeletedAccount("real.user@gmail.com");
    expect(isDeletedAccount("real.user@gmail.com")).toBe(false);
  });

  it("wipeAccountKeys removes every per-account key for one email only", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    localStorage.setItem("rythm-data-real.user@gmail.com", "x");
    localStorage.setItem("rythm-friends-real.user@gmail.com", "x");
    localStorage.setItem("rythm-onboarded-real.user@gmail.com", "1");
    localStorage.setItem("rythm-tour-real.user@gmail.com", "1");
    localStorage.setItem("rythm-data-other@gmail.com", "keep");
    wipeAccountKeys("REAL.USER@GMAIL.COM"); // case-insensitive
    expect(localStorage.getItem("rythm-data-real.user@gmail.com")).toBeNull();
    expect(localStorage.getItem("rythm-friends-real.user@gmail.com")).toBeNull();
    expect(localStorage.getItem("rythm-onboarded-real.user@gmail.com")).toBeNull();
    expect(localStorage.getItem("rythm-tour-real.user@gmail.com")).toBeNull();
    expect(localStorage.getItem("rythm-data-other@gmail.com")).toBe("keep");
  });
});

describe("accountDataFor", () => {
  it("demo accounts get the seeded dataset", () => {
    const d = accountDataFor("alex.rivera@gmail.com");
    expect(d.workouts.length).toBeGreaterThan(0);
  });

  it("real accounts start blank and stay blank across calls", () => {
    const a = accountDataFor("real.user@gmail.com");
    const b = accountDataFor("real.user@gmail.com");
    expect(a.workouts).toEqual([]);
    expect(a.days.length).toBe(1);
    expect(b.days.length).toBe(1);
  });

  it("saved data always wins over the seed", () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    saveAccountData("alex.rivera@gmail.com", {
      days: freshAccountData().days,
      workouts: [],
      habits: [],
      devices: [],
    });
    const d = accountDataFor("alex.rivera@gmail.com");
    expect(d.workouts).toEqual([]);
    expect(loadAccountData("alex.rivera@gmail.com")).not.toBeNull();
  });
});
