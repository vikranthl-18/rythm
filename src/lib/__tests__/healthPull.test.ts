import { describe, expect, it } from "vitest";
import {
  MAX_WINDOW_DAYS,
  WINDOW_DAYS,
  blankDay,
  canonicalSourceCounts,
  computeDeviceTruth,
  decodeSleepSamples,
  healthRowsToDays,
  recomputeDayScores,
  windowForRows,
  type HealthSampleRow,
} from "../healthPull";

const WINDOW = ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"];

const rows: HealthSampleRow[] = [
  {
    date: "2026-08-10",
    source: "hc:com.google.android.apps.fitness",
    metric: "hrv",
    samples: [
      { t: 360, value: 62 },
      { t: 370, value: 66 },
    ],
  },
  { date: "2026-08-10", source: "hc:com.google.android.apps.fitness", metric: "restingHR", samples: [{ t: 360, value: 54 }] },
  {
    date: "2026-08-10",
    source: "hc:com.google.android.apps.fitness",
    metric: "steps",
    samples: [
      { t: 120, value: 500 },
      { t: 300, value: 1200 },
    ],
  },
  {
    date: "2026-08-10",
    source: "hc:com.google.android.apps.fitness",
    metric: "sleep",
    samples: [
      { t: 0, value: 480 }, // total
      { t: 1, value: 100 }, // deep
      { t: 2, value: 110 }, // rem
      { t: 3, value: 230 }, // light
      { t: 4, value: 40 }, // awake
    ],
  },
  { date: "2026-08-09", source: "apple-watch", metric: "steps", samples: [{ t: 60, value: 900 }] },
  // A second device (the ring) records the same physical steps the same day —
  // only ONE device's numbers may count, or steps double.
  {
    date: "2026-08-10",
    source: "hc:com.colmi.smartring",
    metric: "steps",
    samples: [
      { t: 120, value: 480 },
      { t: 300, value: 1150 },
    ],
  },
  // Legacy flat rows from pre-per-origin builds must be ignored.
  {
    date: "2026-08-10",
    source: "pixel-watch",
    metric: "steps",
    samples: [{ t: 0, value: 38000 }],
  },
];

describe("healthRowsToDays", () => {
  it("aggregates metrics into a DailyMetrics day", () => {
    const { days } = healthRowsToDays(rows, WINDOW);
    const d = days.find((x) => x.date === "2026-08-10")!;
    expect(d.hrv).toBe(64); // avg(62, 66)
    expect(d.restingHR).toBe(54);
    expect(d.steps).toBe(1700); // winning device's sum — NOT watch + ring
    expect(d.sleep.durationMin).toBe(480);
    expect(d.sleep.deepMin).toBe(100);
    expect(d.sleep.remMin).toBe(110);
    expect(d.sleep.lightMin).toBe(230);
    expect(d.sleep.awakeMin).toBe(40);
  });

  it("never sums two devices' steps — one device wins per metric per day", () => {
    const { days } = healthRowsToDays(rows, WINDOW);
    const d = days.find((x) => x.date === "2026-08-10")!;
    // The ring's 1630 and the watch's 1700 both exist; the watch (Fit origin)
    // ranks first, so 1700 wins and 38000 legacy is ignored entirely.
    expect(d.steps).toBe(1700);
  });

  it("falls back to the next device when the top device has no reading that day", () => {
    // Only the ring wrote steps on 08-08 — the watch has no row → impute (Rule 3).
    const partial = [
      ...rows,
      {
        date: "2026-08-08",
        source: "hc:com.colmi.smartring",
        metric: "steps",
        samples: [{ t: 60, value: 6400 }],
      },
    ];
    const { days } = healthRowsToDays(partial, WINDOW);
    expect(days.find((x) => x.date === "2026-08-08")!.steps).toBe(6400);
  });

  it("carries intraday samples through so same-day charts can draw", () => {
    const { days } = healthRowsToDays(rows, WINDOW);
    const d = days.find((x) => x.date === "2026-08-10")!;
    // Raw readings ride along keyed by metric — the detail view's up/down chart.
    expect(d.intraday?.hrv).toEqual([
      { t: 360, value: 62 },
      { t: 370, value: 66 },
    ]);
    expect(d.intraday?.steps).toEqual([
      { t: 120, value: 500 },
      { t: 300, value: 1200 },
    ]);
    // Sleep's stage-encoded cluster is NOT exposed as an intraday series.
    expect(d.intraday?.sleep).toBeUndefined();
    // A date with no rows has no intraday series at all.
    expect(days.find((x) => x.date === "2026-08-07")!.intraday).toEqual({});
  });

  it("keeps the daily total consistent when steps arrive as hourly buckets", () => {
    const hourlyRows: HealthSampleRow[] = [
      {
        date: "2026-08-10",
        source: "hc:com.google.android.apps.fitness",
        metric: "steps",
        samples: [
          { t: 0, value: 120 },
          { t: 60, value: 340 },
          { t: 420, value: 1500 },
          { t: 720, value: 2100 },
        ],
      },
    ];
    const { days } = healthRowsToDays(hourlyRows, WINDOW);
    const d = days.find((x) => x.date === "2026-08-10")!;
    expect(d.steps).toBe(4060); // sum of the hours == the day total
    expect(d.intraday?.steps).toHaveLength(4);
  });

  it("fills window dates without data as blank days", () => {
    const { days } = healthRowsToDays(rows, WINDOW);
    expect(days).toHaveLength(WINDOW.length);
    const blank = days.find((x) => x.date === "2026-08-07")!;
    expect(blank.steps).toBe(0);
    expect(blank.hrv).toBe(0);
    expect(blank.sleep.durationMin).toBe(0);
  });

  it("preserves base days (engine outputs) for dates the pull can't fill", () => {
    const base = [
      { ...blankDay("2026-08-08"), recovery: 42, strain: 8.5 },
      { ...blankDay("2026-08-10"), recovery: 77, strain: 12.1 },
    ];
    // Only 08-09 has health data; 08-08 and 08-10 must keep their base values.
    const partialRows = rows.filter((r) => r.date === "2026-08-09");
    const { days } = healthRowsToDays(partialRows, WINDOW, base);
    expect(days.find((x) => x.date === "2026-08-08")!.recovery).toBe(42);
    expect(days.find((x) => x.date === "2026-08-10")!.recovery).toBe(77);
    expect(days.find((x) => x.date === "2026-08-09")!.steps).toBe(900);
  });

  it("registers one device per data origin with friendly names", () => {
    const { devices } = healthRowsToDays(rows, WINDOW);
    expect(devices.map((d) => d.id)).toEqual([
      "hc:com.google.android.apps.fitness",
      "apple-watch",
      "hc:com.app.cq.ring",
    ]);
    expect(devices[0].name).toBe("Pixel Watch");
    expect(devices[1].name).toBe("Apple Watch");
    expect(devices[2].name).toBe("Smart Ring");
    expect(devices[0].priorityRank).toBe(1);
    expect(devices[1].priorityRank).toBe(2);
    expect(devices[0].source).toBe("HEALTH_CONNECT");
    expect(devices[1].source).toBe("HEALTHKIT");
    expect(devices[2].source).toBe("HEALTH_CONNECT");
  });

  it("merges one ring's companion-app packages into a single slot", () => {
    // A smart ring's app can write via several packages (qring / smartring /
    // colmi) — the Devices tab must show ONE Smart Ring, never three, and
    // only the preferred package's numbers count.
    const multiRing: HealthSampleRow[] = [
      { date: "2026-08-10", source: "hc:com.zing.qring", metric: "steps", samples: [{ t: 60, value: 100 }] },
      { date: "2026-08-10", source: "hc:com.zing.smartring", metric: "steps", samples: [{ t: 60, value: 200 }] },
      { date: "2026-08-10", source: "hc:com.colmi.smartring", metric: "steps", samples: [{ t: 60, value: 300 }] },
    ];
    const { devices, days } = healthRowsToDays(multiRing, WINDOW);
    expect(devices.map((d) => d.id)).toEqual(["hc:com.app.cq.ring"]);
    expect(devices[0].name).toBe("Smart Ring");
    // Preferred package (qring) wins — 100, not the 600 a naive sum would give.
    expect(days.find((x) => x.date === "2026-08-10")!.steps).toBe(100);
  });

  it("folds the watch's Fitbit app and the phone's Health Connect storage into their devices", () => {
    // The real-world cloud mix for a Pixel Watch + ring + phone: the watch
    // writes via BOTH Google Fit and its Fitbit app; the phone writes via its
    // per-phone Health Connect storage id (random hash suffix); the ring via
    // its app. The Devices tab must show exactly three slots, named clearly.
    const realWorld: HealthSampleRow[] = [
      { date: "2026-08-10", source: "hc:com.google.android.apps.fitness", metric: "steps", samples: [{ t: 60, value: 100 }] },
      { date: "2026-08-10", source: "hc:com.fitbit.FitbitMobile", metric: "steps", samples: [{ t: 60, value: 200 }] },
      {
        date: "2026-08-10",
        source: "hc:com.android.healthconnect.phone.j6cc43f5e3f423f02aa7e616d57e0fe91",
        metric: "steps",
        samples: [{ t: 60, value: 300 }],
      },
      { date: "2026-08-10", source: "hc:com.app.cq.ring", metric: "steps", samples: [{ t: 60, value: 400 }] },
    ];
    const { devices, days } = healthRowsToDays(realWorld, WINDOW);
    expect(devices.map((d) => d.id)).toEqual([
      "hc:com.google.android.apps.fitness", // watch (Fit ranks first in its group)
      "hc:com.android.healthconnect.phone", // phone (hash collapsed)
      "hc:com.app.cq.ring", // ring
    ]);
    expect(devices.map((d) => d.name)).toEqual(["Pixel Watch", "Phone", "Smart Ring"]);
    // Fit ranks first in the watch group → its 100 wins, never summed.
    expect(days.find((x) => x.date === "2026-08-10")!.steps).toBe(100);
  });

  it("merges one physical device's Google origins into a single slot", () => {
    // A Pixel Watch writes via three packages — the app must show it ONCE and
    // count only ONE origin's numbers (never sum the same steps twice).
    const multi: HealthSampleRow[] = [
      { date: "2026-08-10", source: "hc:com.google.android.apps.fitness", metric: "steps", samples: [{ t: 60, value: 100 }] },
      { date: "2026-08-10", source: "hc:com.google.android.wearable.healthservices", metric: "steps", samples: [{ t: 60, value: 200 }] },
      { date: "2026-08-10", source: "hc:com.google.android.apps.wearables.maestro", metric: "steps", samples: [{ t: 60, value: 300 }] },
      { date: "2026-08-10", source: "hc:com.google.android.gms", metric: "steps", samples: [{ t: 60, value: 400 }] },
    ];
    const { devices, days } = healthRowsToDays(multi, WINDOW);
    expect(devices.map((d) => d.id)).toEqual([
      "hc:com.google.android.apps.fitness",
      "hc:com.android.healthconnect.phone", // GMS (Play Services) folds in with the phone
    ]);
    expect(devices[0].name).toBe("Pixel Watch");
    expect(devices[1].name).toBe("Phone");
    // Preferred origin (Fit) wins — 100, not the 600 a naive sum would give.
    expect(days.find((x) => x.date === "2026-08-10")!.steps).toBe(100);
  });

  it("recommends the more consistent device when two wearables disagree", () => {
    // Watch (Fit) records HRV on 8 days, ring on all 10 — the ring is more
    // consistent, so it should be recommended even though it measures higher.
    const rows: HealthSampleRow[] = [];
    for (let i = 1; i <= 10; i++) {
      const date = `2026-08-${String(i).padStart(2, "0")}`;
      rows.push({ date, source: "hc:com.app.cq.ring", metric: "hrv", samples: [{ t: 360, value: 55 }] });
      if (i <= 8) rows.push({ date, source: "hc:com.google.android.apps.fitness", metric: "hrv", samples: [{ t: 360, value: 62 }] });
    }
    const truth = computeDeviceTruth(rows);
    expect(truth).toHaveLength(1);
    const t = truth[0];
    expect(t.metric).toBe("hrv");
    expect(t.perDevice).toHaveLength(2);
    const ring = t.perDevice.find((d) => d.name === "Smart Ring")!;
    const watch = t.perDevice.find((d) => d.name === "Pixel Watch")!;
    expect(ring.days).toBe(10);
    expect(watch.days).toBe(8);
    // They disagree by >10% on every shared day → the report says so.
    expect(t.agreePct).toBe(0);
    expect(t.note).toContain("disagree");
    expect(t.note).toContain("Smart Ring");
  });

  it("does not build truth with only one device", () => {
    const rows: HealthSampleRow[] = [
      { date: "2026-08-01", source: "hc:com.google.android.apps.fitness", metric: "steps", samples: [{ t: 0, value: 5000 }] },
      { date: "2026-08-02", source: "hc:com.google.android.apps.fitness", metric: "steps", samples: [{ t: 0, value: 6000 }] },
    ];
    expect(computeDeviceTruth(rows)).toEqual([]);
  });

  it("returns no devices when there is no data", () => {
    const { devices, days, sourceCounts } = healthRowsToDays([], WINDOW);
    expect(devices).toHaveLength(0);
    expect(days.every((d) => d.steps === 0)).toBe(true);
    expect(sourceCounts).toEqual({});
  });

  it("reports raw batch counts per cloud source (diagnostics, incl. legacy)", () => {
    const { sourceCounts } = healthRowsToDays(rows, WINDOW);
    // 4 batches from the Fit origin, 1 from apple-watch, 1 ring, 1 legacy.
    expect(sourceCounts["hc:com.google.android.apps.fitness"]).toBe(4);
    expect(sourceCounts["apple-watch"]).toBe(1);
    expect(sourceCounts["hc:com.colmi.smartring"]).toBe(1);
    expect(sourceCounts["pixel-watch"]).toBe(1); // legacy counted, never a device
  });

  it("aggregates batch counts up to canonical device slots and isolates true legacy rows", () => {
    const { counts, orphans } = canonicalSourceCounts({
      "hc:com.google.android.apps.fitness": 66,
      "hc:com.fitbit.FitbitMobile": 147, // the watch's Fitbit app — same slot
      "hc:com.android.healthconnect.phone.j6cc43f5e3f423f02aa7e616d57e0fe91": 66, // phone hash
      "hc:com.app.cq.ring": 4,
      "pixel-watch": 364, // true legacy
      "hc:unknown": 2, // true legacy
    });
    expect(counts).toEqual({
      "hc:com.google.android.apps.fitness": 213, // 66 + 147 — the watch's total
      "hc:com.android.healthconnect.phone": 66, // hash collapsed into the phone
      "hc:com.app.cq.ring": 4,
    });
    expect(orphans).toEqual({ "pixel-watch": 364, "hc:unknown": 2 });
  });

  it("uses legacy pixel-watch rows only as a fallback — never a device, never beside per-device rows", () => {
    // Only a legacy row exists → it still fills the day (old build, no re-read yet).
    const onlyLegacy = healthRowsToDays(
      [
        {
          date: "2026-08-10",
          source: "pixel-watch",
          metric: "steps",
          samples: [{ t: 0, value: 38000 }],
        },
      ],
      WINDOW
    );
    expect(onlyLegacy.devices).toHaveLength(0);
    expect(onlyLegacy.days.find((x) => x.date === "2026-08-10")!.steps).toBe(38000);
    // Per-device rows beat the legacy row for the same (date, metric).
    const mixed = healthRowsToDays(rows, WINDOW); // fixture includes legacy 38000
    expect(mixed.days.find((x) => x.date === "2026-08-10")!.steps).toBe(1700);
    expect(mixed.devices.some((d) => d.id === "pixel-watch")).toBe(false);
  });

  it("skips orphaned hc:unknown rows (old sleep build) — no phantom device", () => {
    const orphaned: HealthSampleRow[] = [
      ...rows,
      {
        date: "2026-08-09",
        source: "hc:unknown",
        metric: "sleep",
        samples: [{ t: 0, value: 430 }],
      },
    ];
    const { devices } = healthRowsToDays(orphaned, WINDOW);
    expect(devices.some((d) => d.id === "hc:unknown")).toBe(false);
    expect(devices.map((d) => d.id)).toEqual([
      "hc:com.google.android.apps.fitness",
      "apple-watch",
      "hc:com.app.cq.ring",
    ]);
  });

  it("honors the user's device reorder when resolving", () => {
    const { days } = healthRowsToDays(rows, WINDOW, [], [
      {
        id: "hc:com.colmi.smartring",
        name: "Smartring",
        model: "hc:com.colmi.smartring",
        source: "HEALTH_CONNECT",
        priorityRank: 1,
        battery: 100,
        connected: true,
        lastSyncMin: 2,
        color: "#a78bfa",
        specialty: ["steps"],
        metricOrder: Object.fromEntries([
          "hr", "sleep", "restingHR", "hrv", "steps", "activeEnergy", "calories", "zoneMinutes", "skinTemp", "spo2", "respRate",
        ].map((m) => [m, ["hc:com.colmi.smartring", "hc:com.google.android.apps.fitness"]])),
      },
    ] as unknown as import("../../types").UserDevice[]);
    const d = days.find((x) => x.date === "2026-08-10")!;
    expect(d.steps).toBe(1630); // ring ranked first by the user → its steps win
  });

  it("gives cloud-derived devices a FULL metric order so priority rotation works", () => {
    const { devices } = healthRowsToDays(rows, WINDOW);
    const watch = devices.find((d) => d.id === "hc:com.google.android.apps.fitness")!;
    const ring = devices.find((d) => d.id === "hc:com.app.cq.ring")!;
    // Regression: deviceFor defaulted metricOrder to [self], so the Devices
    // tab's "tap to rotate" was a silent no-op (guard requires >= 2 entries).
    expect(watch.metricOrder.steps.length).toBeGreaterThanOrEqual(2);
    expect(ring.metricOrder.steps).toEqual(watch.metricOrder.steps);
    expect(watch.metricOrder.steps[0]).toBe("hc:com.google.android.apps.fitness");
  });

  it("preserves a saved reorder onto freshly derived devices", () => {
    const base = [
      {
        id: "hc:com.colmi.smartring",
        name: "Smart Ring",
        model: "hc:com.colmi.smartring",
        source: "HEALTH_CONNECT",
        priorityRank: 1,
        battery: 100,
        connected: true,
        lastSyncMin: 2,
        color: "#a78bfa",
        specialty: ["steps"],
        metricOrder: Object.fromEntries(
          ["hr", "sleep", "restingHR", "hrv", "steps", "activeEnergy", "calories", "zoneMinutes", "skinTemp", "spo2", "respRate"].map((m) => [
            m,
            ["hc:com.colmi.smartring", "hc:com.google.android.apps.fitness", "apple-watch"],
          ])
        ),
      },
    ] as unknown as import("../../types").UserDevice[];
    const { devices } = healthRowsToDays(rows, WINDOW, [], base);
    const watch = devices.find((d) => d.id === "hc:com.google.android.apps.fitness")!;
    // The ring-first order the user saved survives the pull — the next 60s
    // sync must not reset it to the default watch-first order.
    expect(watch.metricOrder.steps[0]).toBe("hc:com.colmi.smartring");
    expect(watch.metricOrder.steps).toContain("hc:com.google.android.apps.fitness");
    const d = daysOf(healthRowsToDays(rows, WINDOW, [], base));
    expect(d.steps).toBe(1630);
  });
});

function daysOf(p: { days: { date: string; steps: number }[] }) {
  return p.days.find((x) => x.date === "2026-08-10")!;
}

describe("recomputeDayScores", () => {
  it("computes sleep score + recovery from raw pulled days", () => {
    const d1 = { ...blankDay("2026-08-09"), hrv: 60, restingHR: 55, skinTemp: 36.6, strain: 7.5 };
    const d2 = {
      ...blankDay("2026-08-10"),
      hrv: 66,
      restingHR: 53,
      skinTemp: 36.5,
      sleep: { ...blankDay("2026-08-10").sleep, durationMin: 460, deepMin: 90, remMin: 110, lightMin: 240, awakeMin: 20 },
    };
    const out = recomputeDayScores([d1, d2]);
    expect(out[1].sleep.needMin).toBeGreaterThan(0);
    expect(out[1].sleep.score).toBeGreaterThan(0);
    expect(out[1].recovery).toBeGreaterThan(0);
    // Days with no vitals and no sleep stay at 0 — honest "no data".
    expect(out[0].sleep.score).toBe(0);
  });

  it("carries sleep debt across days", () => {
    const short = {
      ...blankDay("2026-08-09"),
      sleep: { ...blankDay("2026-08-09").sleep, durationMin: 300, deepMin: 60, remMin: 70, lightMin: 160, awakeMin: 10 },
      hrv: 60,
    };
    const next = { ...blankDay("2026-08-10"), hrv: 62, sleep: { ...blankDay("2026-08-10").sleep, durationMin: 480, deepMin: 100, remMin: 110, lightMin: 250, awakeMin: 20 } };
    const out = recomputeDayScores([short, next]);
    // The second night's need is inflated by the first night's shortfall.
    expect(out[1].sleep.needMin).toBeGreaterThan(out[0].sleep.needMin);
  });
});

describe("windowForRows", () => {
  it("spans at least WINDOW_DAYS with no data", () => {
    const win = windowForRows([], "2026-08-10");
    expect(win).toHaveLength(WINDOW_DAYS);
    expect(win[win.length - 1]).toBe("2026-08-10");
    expect(win[0]).toBe("2026-07-12"); // 30 days back incl. today
  });

  it("extends to the earliest row so full history shows", () => {
    const win = windowForRows([{ date: "2026-06-01", source: "pixel-watch", metric: "steps", samples: [{ t: 0, value: 1 }] }], "2026-08-10");
    expect(win[0]).toBe("2026-06-01");
    expect(win[win.length - 1]).toBe("2026-08-10");
  });

  it("caps very old history at MAX_WINDOW_DAYS", () => {
    const win = windowForRows([{ date: "2020-01-01", source: "pixel-watch", metric: "steps", samples: [{ t: 0, value: 1 }] }], "2026-08-10");
    expect(win).toHaveLength(MAX_WINDOW_DAYS);
    expect(win[win.length - 1]).toBe("2026-08-10");
  });
});

describe("decodeSleepSamples", () => {
  it("decodes a full 5-sample cluster", () => {
    const out = decodeSleepSamples([
      { t: 0, value: 480 },
      { t: 1, value: 100 },
      { t: 2, value: 110 },
      { t: 3, value: 230 },
      { t: 4, value: 40 },
    ]);
    expect(out.durationMin).toBe(480);
    expect(out.deepMin).toBe(100);
    expect(out.remMin).toBe(110);
    expect(out.lightMin).toBe(230);
    expect(out.awakeMin).toBe(40);
  });

  it("handles a lone duration sample (no stages)", () => {
    const out = decodeSleepSamples([{ t: 0, value: 452 }]);
    expect(out.durationMin).toBe(452);
    expect(out.deepMin).toBe(0);
  });

  it("decodes two sessions in one night without merging or losing data", () => {
    // The native bridge spaces each session's cluster apart (seq * 10000) so
    // a watch AND a ring writing the same night (or a nap) can't collide.
    // Night 1 ends 06:31 (t=391), night 2 ends 06:33 (t=393) — the legacy
    // adjacency scheme would have merged these and dropped night 2 entirely.
    const out = decodeSleepSamples([
      { t: 391, value: 389 }, // night 1 total (asleep)
      { t: 392, value: 80 }, // deep
      { t: 393, value: 95 }, // rem
      { t: 394, value: 190 }, // light
      { t: 395, value: 26 }, // awake
      { t: 10393, value: 40 }, // night 2 total (a 40-min nap)
      { t: 10394, value: 5 },
      { t: 10395, value: 10 },
      { t: 10396, value: 20 },
      { t: 10397, value: 5 },
    ]);
    expect(out.durationMin).toBe(429);
    expect(out.deepMin).toBe(85);
    expect(out.remMin).toBe(105);
    expect(out.lightMin).toBe(210);
    expect(out.awakeMin).toBe(31);
  });
});
