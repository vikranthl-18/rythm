import { describe, expect, it } from "vitest";
import type { DailyMetrics, Habit } from "../../types";
import { addDaysIso } from "../../lib/rng";
import {
  autoCompleted,
  completedOn,
  completionRate,
  currentStreak,
  habitDueOn,
  isCompleted,
  longestStreak,
} from "../habits";

function mkHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    title: "Test",
    icon: "✅",
    color: "#34d399",
    targetType: "BOOLEAN",
    targetValue: 1,
    unit: "",
    frequency: "DAILY",
    customDays: [],
    timesPerWeek: 7,
    autoMetric: null,
    autoOp: null,
    logs: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const TODAY = "2026-08-10"; // a Monday

describe("habitDueOn", () => {
  it("daily is always due", () => {
    const h = mkHabit({ frequency: "DAILY" });
    expect(habitDueOn(h, "2026-08-10")).toBe(true);
    expect(habitDueOn(h, "2026-08-15")).toBe(true);
  });
  it("weekdays skips weekends", () => {
    const h = mkHabit({ frequency: "WEEKDAYS" });
    expect(habitDueOn(h, "2026-08-10")).toBe(true); // Mon
    expect(habitDueOn(h, "2026-08-15")).toBe(false); // Sat
  });
  it("custom days only on listed days", () => {
    const h = mkHabit({ frequency: "CUSTOM", customDays: [1, 3, 5] });
    expect(habitDueOn(h, "2026-08-10")).toBe(true); // Mon(1)
    expect(habitDueOn(h, "2026-08-11")).toBe(false); // Tue(2)
  });
});

describe("streaks", () => {
  it("counts consecutive completed days", () => {
    const logs: Record<string, number> = {};
    for (let i = 1; i <= 5; i++) logs[addDaysIso(TODAY, -i)] = 1;
    const h = mkHabit({ logs });
    expect(currentStreak(h, TODAY, null)).toBe(5);
    expect(longestStreak(h, TODAY, null)).toBe(5);
  });

  it("streak breaks on a missed day", () => {
    const logs: Record<string, number> = {};
    for (let i = 1; i <= 5; i++) logs[addDaysIso(TODAY, -i)] = 1;
    logs[addDaysIso(TODAY, -3)] = 0; // missed 3 days ago
    const h = mkHabit({ logs });
    expect(currentStreak(h, TODAY, null)).toBe(2); // today pending, counts from yesterday
    expect(longestStreak(h, TODAY, null)).toBe(2);
  });

  it("today's completion extends the streak", () => {
    const logs: Record<string, number> = { [TODAY]: 1 };
    for (let i = 1; i <= 4; i++) logs[addDaysIso(TODAY, -i)] = 1;
    const h = mkHabit({ logs });
    expect(currentStreak(h, TODAY, null)).toBe(5);
  });

  it("weekdays streak ignores weekends", () => {
    // Mon 8/10 (today), Fri 8/7, Thu 8/6 — Sat/Sun not due
    const logs: Record<string, number> = {
      "2026-08-10": 1,
      "2026-08-07": 1,
      "2026-08-06": 1,
    };
    const h = mkHabit({ frequency: "WEEKDAYS", logs });
    expect(currentStreak(h, TODAY, null)).toBe(3);
  });
});

describe("auto-completion", () => {
  it("auto-completes sleep habit from biometrics", () => {
    const h = mkHabit({
      targetType: "DURATION",
      targetValue: 480,
      autoMetric: "sleepDuration",
      autoOp: "gte",
    });
    const day = { sleep: { durationMin: 495 } } as unknown as DailyMetrics;
    expect(autoCompleted(h, day)).toBe(true);
    expect(completedOn(h, TODAY, TODAY, day)).toBe(true);
  });

  it("respects <= operators (e.g. resting HR cap)", () => {
    const h = mkHabit({
      targetType: "NUMERIC",
      targetValue: 60,
      autoMetric: "restingHR",
      autoOp: "lte",
    });
    const day = { restingHR: 54 } as unknown as DailyMetrics;
    expect(autoCompleted(h, day)).toBe(true);
    const bad = { restingHR: 66 } as unknown as DailyMetrics;
    expect(autoCompleted(h, bad)).toBe(false);
  });

  it("manual log overrides auto-completion", () => {
    const h = mkHabit({
      targetType: "NUMERIC",
      targetValue: 8000,
      autoMetric: "steps",
      autoOp: "gte",
      logs: { [TODAY]: 0 },
    });
    const day = { steps: 12000 } as unknown as DailyMetrics;
    expect(autoCompleted(h, day)).toBe(true);
    expect(completedOn(h, TODAY, TODAY, day)).toBe(false); // explicit 0 wins
    expect(isCompleted(h, TODAY)).toBe(false);
  });

  it("auto-completion can be disabled by the user (opts.auto=false)", () => {
    const h = mkHabit({
      targetType: "DURATION",
      targetValue: 480,
      autoMetric: "sleepDuration",
      autoOp: "gte",
    });
    const day = { sleep: { durationMin: 495 } } as unknown as DailyMetrics;
    expect(completedOn(h, TODAY, TODAY, day, { auto: false })).toBe(false);
    expect(completedOn(h, TODAY, TODAY, day)).toBe(true); // default stays on
    // streaks ignore auto-completed days when disabled
    expect(currentStreak(h, TODAY, day, { auto: false })).toBe(0);
    expect(currentStreak(h, TODAY, day)).toBe(1);
  });
});

describe("completionRate", () => {
  it("measures due vs done", () => {
    const logs: Record<string, number> = {};
    for (let i = 1; i <= 27; i++) logs[addDaysIso(TODAY, -i)] = 1;
    // 2 misses over the trailing 28-day window → 26/28 ≈ 93%
    logs[addDaysIso(TODAY, -4)] = 0;
    logs[addDaysIso(TODAY, -17)] = 0;
    const h = mkHabit({ logs });
    const rate = completionRate(h, TODAY, null, 28);
    expect(rate).toBeGreaterThanOrEqual(85);
    expect(rate).toBeLessThanOrEqual(100);
  });
});
