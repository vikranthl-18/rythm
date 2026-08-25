import { describe, expect, it } from "vitest";
import { buildRythmReport } from "../rhythmReport";
import { buildChallengeProgress, challengeEndIso, makeChallenge, workoutsValue } from "../challenges";
import { computeDataInsights } from "../correlations";
import { buildRaceDayStrategy, type RaceDayWeather } from "../raceDay";
import { blankDay } from "../../lib/healthPull";
import type { DailyMetrics, Workout } from "../../types";

const NO_WEATHER: RaceDayWeather = { tempC: null, precipPct: null, windKmh: null, source: "test" };

const mkDay = (date: string, patch: Partial<DailyMetrics> = {}): DailyMetrics => ({
  ...blankDay(date),
  ...patch,
});

const mkRun = (startIso: string, distanceM: number, durationSec: number, strain = 8): Workout => ({
  id: "w-" + startIso,
  type: "run",
  title: "Run",
  startIso,
  endIso: new Date(new Date(startIso).getTime() + durationSec * 1000).toISOString(),
  durationSec,
  distanceM,
  elevationGainM: 0,
  avgHr: 150,
  maxHr: 180,
  strain,
  zones: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
  splitsSec: [],
  route: [],
});

describe("buildRythmReport", () => {
  it("sums volume, finds PRs and the sleep story", () => {
    const days = [
      mkDay("2026-08-01", { recovery: 80, steps: 9000, activeZoneMin: 30, sleep: { ...blankDay("2026-08-01").sleep, durationMin: 480, needMin: 450, score: 82 } }),
      mkDay("2026-08-02", { recovery: 60, steps: 5000, sleep: { ...blankDay("2026-08-02").sleep, durationMin: 300, needMin: 450, score: 40 } }),
      mkDay("2026-08-03", { recovery: 40, sleep: { ...blankDay("2026-08-03").sleep, durationMin: 420, needMin: 450, score: 55 } }),
    ];
    const workouts = [mkRun("2026-08-01T07:00:00", 5000, 1500), mkRun("2026-08-02T07:00:00", 10100, 3300, 12)];
    const r = buildRythmReport(days, workouts, "Sub-20 min 5k");
    expect(r.sessions).toBe(2);
    expect(r.totalKm).toBe(15.1);
    expect(r.prs.find((p) => p.label === "5K")?.paceSecPerKm).toBe(300); // 1500s/5km
    expect(r.prs.find((p) => p.label === "10K")?.paceSecPerKm).toBeCloseTo(326.7, 1); // 3300s/10.1km
    expect(r.sleep.nights).toBe(3);
    expect(r.sleep.avgMin).toBe(400);
    expect(r.goal).toBe("Sub-20 min 5k");
    expect(r.trend).toHaveLength(3);
  });
});

describe("challenges", () => {
  const c = makeChallenge({
    title: "50 km week",
    icon: "🥇",
    metric: "distanceKm",
    target: 50,
    days: 7,
    createdBy: "me@x.co",
    memberEmails: ["friend@x.co"],
  });

  it("computes the inclusive window", () => {
    expect(challengeEndIso(c)).toBe(new Date(new Date(c.startIso + "T00:00:00").getTime() + 6 * 86400000).toISOString().slice(0, 10));
  });

  it("sums distance only inside the window", () => {
    const inWin = mkRun(`${c.startIso}T07:00:00`, 10000, 3000);
    const out = mkRun("2020-01-01T07:00:00", 99999, 3000);
    expect(workoutsValue([inWin, out], "distanceKm", c.startIso, challengeEndIso(c))).toBe(10);
  });

  it("builds member progress (me first) with friends' workouts", () => {
    const friendWorkouts = [mkRun(`${c.startIso}T07:00:00`, 20000, 6000)];
    const p = buildChallengeProgress(c, "me@x.co", [mkRun(`${c.startIso}T07:00:00`, 10000, 3000)], [
      { id: "f1", name: "Sam", email: "friend@x.co", joinedAt: "", emoji: "🏃", color: "#73976a", goal: "", workouts: friendWorkouts },
    ]);
    expect(p.members[0].isMe).toBe(true);
    expect(p.members[0].value).toBe(10);
    expect(p.members[1].value).toBe(20);
    expect(p.members[1].pct).toBe(40);
  });
});

describe("computeDataInsights", () => {
  it("finds the evening-training sleep penalty", () => {
    const days = [];
    for (let i = 0; i < 10; i++) {
      const date = `2026-08-${String(i + 1).padStart(2, "0")}`;
      days.push(mkDay(date, { sleep: { ...blankDay(date).sleep, durationMin: 420, score: i % 2 ? 60 : 90 } }));
    }
    // Evenings (22:00 ends) → low scores; mornings → high scores.
    const workouts = [
      ...days.slice(0, 5).map((d) => mkRun(`${d.date}T22:00:00`, 8000, 2400, 12)),
      ...days.slice(5).map((d) => mkRun(`${d.date}T07:00:00`, 8000, 2400, 8)),
    ];
    const ins = computeDataInsights(days, workouts);
    expect(ins.some((i) => i.title.includes("Evening sessions"))).toBe(true);
  });

  it("returns nothing with too little data", () => {
    expect(computeDataInsights([mkDay("2026-08-01")], [])).toEqual([]);
  });
});

describe("buildRaceDayStrategy", () => {
  const race = { distanceKm: 21.0975, dateIso: "2026-10-01", targetPaceSecPerKm: 300 };

  it("keeps the goal pace on a green, mild, flat day", () => {
    const s = buildRaceDayStrategy({ race, recovery: 80, weather: NO_WEATHER, elevationGainM: 0 });
    expect(s.adjustedPaceSecPerKm).toBe(300);
    expect(s.bands.map((b) => b.label)).toEqual(["Conservative", "Goal", "Aggressive"]);
  });

  it("slows down in heat, wind, red recovery and climb", () => {
    const s = buildRaceDayStrategy({
      race,
      recovery: 30,
      weather: { tempC: 32, precipPct: 60, windKmh: 35, source: "test" },
      elevationGainM: 400,
    });
    // 1.08 (red) × 1.10 (hot) × 1.05 (wind) × ~1.019 (climb) ≈ 1.27 → ~381
    expect(s.adjustedPaceSecPerKm).toBeGreaterThan(360);
    expect(s.tips.length).toBeGreaterThanOrEqual(4);
    expect(s.conditions).toContain("32°C");
  });
});
