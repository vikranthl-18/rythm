import { useState } from "react";
import type { Tab } from "../App";
import { useStore } from "../store";

// ---------------------------------------------------------------------------
// First-run feature tour — teaches every new user rythm's signature features.
// Shown once per account right after onboarding + GPS consent, with a "Show
// me" button per step that jumps to the real feature. Replayable from
// Settings → About.
// ---------------------------------------------------------------------------

export type TourSub = "feed" | "records" | "friends";

interface TourStep {
  icon: string;
  title: string;
  body: string;
  points: string[];
  tab: Tab;
  sub?: TourSub;
  cta: string;
}

const STEPS: TourStep[] = [
  {
    icon: "💠",
    title: "The Rythm Score",
    body: "Your signature metric — recovery, sleep, training, habits and consistency rolled into a single 0–100 score. Nothing like it anywhere else.",
    points: [
      "Tap the card for a full breakdown of why you got that score",
      "Every suggestion in the app is aimed at raising it",
    ],
    tab: "home",
    cta: "See it on Home",
  },
  {
    icon: "💚",
    title: "Recovery, Strain & Readiness",
    body: "Whoop-style recovery and strain computed from YOUR baselines — the app spends about a week learning your numbers before scores unlock.",
    points: [
      "Tap Recovery for today's training load and the session rythm recommends",
      "Readiness sits right underneath it",
    ],
    tab: "home",
    cta: "See it on Home",
  },
  {
    icon: "🏃",
    title: "GPS Workouts & Records",
    body: "Record runs, rides and hikes with live GPS maps — real routes with your permission, simulated otherwise.",
    points: [
      "Personal records at every distance live in Records & PRs",
      "Finish a workout for honest insights: what you did well and what's next",
    ],
    tab: "activity",
    sub: "records",
    cta: "Open Records & PRs",
  },
  {
    icon: "🏁",
    title: "Race Mode",
    body: "Pick a goal race and rythm reverse-builds an 8–16 week plan — base, build, peak, taper — adapted to your recovery every single day.",
    points: [
      "The long run ramps from your actual longest run, then cuts 65% in the taper",
      "A red recovery day bends the plan into a recovery session",
    ],
    tab: "home",
    cta: "Back to Home",
  },
  {
    icon: "✅",
    title: "Habits",
    body: "A Notion-style habit tracker with streaks, heatmaps and completion rates.",
    points: [
      "Biometric habits auto-complete from your devices — “sleep 8 hours” ticks itself off",
      "Tap any past day to fix a log you got wrong",
    ],
    tab: "habits",
    cta: "Open Habits",
  },
  {
    icon: "👻",
    title: "Ghost Race",
    body: "Race a friend's run live — their pace line on your map and the gap in real time.",
    points: [
      "Pick any friend's GPS workout from the Friends tab",
      "The finish verdict compares fairly over what you actually ran",
    ],
    tab: "activity",
    sub: "friends",
    cta: "Open Friends",
  },
  {
    icon: "🤖",
    title: "The AI Coach",
    body: "A coach that knows your physiology — recovery, strain, sleep, habits and your goal, all in context.",
    points: [
      "Ask “why is my recovery low today?” and get an answer grounded in your data",
      "A morning readiness brief lands every day",
    ],
    tab: "coach",
    cta: "Meet your coach",
  },
  {
    icon: "🔐",
    title: "Devices & Privacy",
    body: "Pair a real health device over Bluetooth for live heart rate — or run the sim.",
    points: [
      "Your physiology stays on your device: export, encrypted backup, delete",
      "Cloud sync is opt-in, never the default",
    ],
    tab: "devices",
    cta: "Open Devices",
  },
];

export default function FeatureTour({
  onNavigate,
}: {
  onNavigate: (t: Tab, sub?: TourSub) => void;
}) {
  const setTourSeen = useStore((s) => s.setTourSeen);
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = () => setTourSeen(true);

  return (
    <div className="tour-overlay">
      <div className="tour-card">
        <div className="tour-head">
          <span className="tour-brand">
            ◢ <b>rythm</b>
            <span className="tour-brand-sub">your first tour</span>
          </span>
          <button className="tour-skip" onClick={finish}>
            Skip tour
          </button>
        </div>

        <div className="tour-icon">{step.icon}</div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <ul className="tour-points">
          {step.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>

        <button className="tour-show" onClick={() => onNavigate(step.tab, step.sub)}>
          {step.cta} →
        </button>

        <div className="tour-foot">
          <button
            className="tour-back"
            onClick={() => setI(i - 1)}
            disabled={i === 0}
            aria-label="Previous step"
          >
            ‹ Back
          </button>
          <div className="tour-dots">
            {STEPS.map((_, d) => (
              <span key={d} className={`tour-dot ${d === i ? "active" : ""}`} />
            ))}
          </div>
          <button className="tour-next" onClick={last ? finish : () => setI(i + 1)}>
            {last ? "Start training" : "Next ›"}
          </button>
        </div>

        <p className="tour-count">
          {i + 1} of {STEPS.length}
        </p>
      </div>
    </div>
  );
}
