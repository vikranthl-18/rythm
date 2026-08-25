import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoachContext } from "../coach";
import { llmComplete } from "../coach";
import { loadInsight, metricsInsight, readinessInsight, rhythmInsight } from "../aiInsight";
import type { AiInput, AiMetrics } from "../aiMetrics";
import type { RythmScore } from "../rhythm";

const ctx: CoachContext = {
  goal: "Sub-20 min 5k",
  age: 28,
  recovery: 67,
  recoveryColor: "green",
  strain: 4.2,
  strainTarget: 14.5,
  hrv: 62,
  hrvBaseline: 58,
  rhr: 53,
  rhrBaseline: 54,
  sleepScore: 79,
  sleepMin: 371,
  needMin: 525,
  sleepDebtMin: 154,
  steps: 5200,
  habits: [],
  habitsDone: 0,
  habitsDue: 3,
  weekMileageKm: 18.3,
  weekSessions: 3,
  weekStrain: 30.6,
  workouts7: [
    { title: "Tempo run", when: "Mon", durationMin: 40, km: 8.1, strain: 14.2 },
  ],
};

const input: AiInput = {
  age: 28,
  sex: "male",
  weightKg: 72,
  heightCm: 180,
  restingHR: 53,
  hrv: 62,
  days: [],
};

const ai: AiMetrics = {
  maxHr: 192,
  vo2max: 51.2,
  vo2Expected: 46.2,
  vo2Label: "Excellent",
  vo2Pct: 75,
  hrvNorm: 62,
  rhrNorm: 60.6,
  fitnessScore: 78,
  fitnessLabel: "Very good",
  biologicalAge: 26.8,
  cardioAge: 24.5,
  trainingStatus: "Productive",
  rmrKcal: 1712,
  weeklyLoad: 8.4,
  recoveryTrend: 68,
};

const rythm: RythmScore = {
  score: 73,
  color: "green",
  parts: [
    { key: "recovery", label: "Recovery", icon: "🛡️", weight: 0.25, score: 67, reason: "rec", improve: "sleep" },
    { key: "sleep", label: "Sleep", icon: "😴", weight: 0.2, score: 79, reason: "sleep", improve: "debt" },
    { key: "training", label: "Training", icon: "🏋️", weight: 0.2, score: 99, reason: "load", improve: "keep" },
    { key: "activity", label: "Activity", icon: "👟", weight: 0.15, score: 56, reason: "steps", improve: "walk" },
    { key: "habits", label: "Habits", icon: "✅", weight: 0.1, score: 86, reason: "habits", improve: "knock out" },
    { key: "consistency", label: "Consistency", icon: "📅", weight: 0.1, score: 43, reason: "days", improve: "two short" },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("metricsInsight", () => {
  it("embeds the athlete's real numbers in the prompt", () => {
    const spec = metricsInsight(ai, input, ctx);
    expect(spec.system).toContain("51.2"); // vo2max
    expect(spec.system).toContain("Sub-20 min 5k"); // goal
    expect(spec.system).toContain("26.8"); // biological age
    expect(spec.system).toContain("1712"); // rmr
    expect(spec.user).toContain("AI metrics");
  });

  it("fallback names the value and the weakest signal", () => {
    const spec = metricsInsight(ai, input, ctx);
    expect(spec.fallback).toContain("51.2");
    expect(spec.fallback).toContain("weakest signal");
    // HRV is at its norm while VO2max and resting HR are above theirs — HRV is the weakest
    expect(spec.fallback).toContain("HRV");
  });
});

describe("rhythmInsight", () => {
  it("lists every pillar with its weight in the prompt", () => {
    const spec = rhythmInsight(rythm, ctx);
    for (const p of rythm.parts) {
      expect(spec.system).toContain(p.label);
    }
    expect(spec.system).toContain("73/100");
  });

  it("fallback prioritizes the biggest weighted gap (weight × gap)", () => {
    const spec = rhythmInsight(rythm, ctx);
    // Recovery: (100-67)*0.25 = 8.25 — the biggest weighted gap → named first
    // (Consistency has the biggest raw gap at 57, but only 10% weight)
    expect(spec.fallback).toContain("Recovery");
    expect(spec.fallback).toContain("sleep"); // Recovery's improve lever
  });
});

describe("loadInsight", () => {
  it("embeds acute/chronic/ACWR and grounds the fallback in the recommendation", () => {
    const spec = loadInsight(
      { acute: 10.2, chronic: 9.9, acwr: 1.03, status: "Balanced", chronicDays: 28, learned: true },
      67,
      { title: "Quality session", body: "sweet spot", tone: "good" },
      ctx
    );
    expect(spec.system).toContain("1.03");
    expect(spec.system).toContain("Balanced");
    expect(spec.fallback).toContain("Quality session");
    expect(spec.fallback).toContain("safe building zone");
  });
});

describe("readinessInsight", () => {
  it("includes the verdict and names the limiting factor", () => {
    const spec = readinessInsight(
      {
        score: 76,
        status: "Ready",
        verdict: "Green light. Recovery is 67% and sleep scored 79/100 — primed.",
        parts: [
          { label: "Recovery", score: 67, weight: 0.55 },
          { label: "Sleep", score: 79, weight: 0.3 },
          { label: "Freshness", score: 95, weight: 0.15 },
        ],
      },
      ctx
    );
    expect(spec.system).toContain("76/100");
    expect(spec.fallback).toContain("Green light");
    expect(spec.fallback).toContain("Recovery"); // lowest component
  });
});

describe("llmComplete shared path", () => {
  it("prefers the serverless function when both paths are configured", async () => {
    vi.stubEnv("VITE_COACH_API", "https://example.com/api/coach");
    vi.stubEnv("VITE_GEMINI_API_KEY", "gem-key");
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ reply: "from serverless" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await llmComplete("sys", [{ role: "user", text: "hi" }]);
    expect(reply).toBe("from serverless");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://example.com/api/coach");
  });

  it("returns null when nothing is configured", async () => {
    vi.stubEnv("VITE_COACH_API", "");
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
    expect(await llmComplete("sys", [{ role: "user", text: "hi" }])).toBeNull();
  });
});
