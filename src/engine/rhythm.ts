// ---------------------------------------------------------------------------
// Rythm Score — the signature metric.
// 0–100 blend of the six pillars of the ecosystem:
//   Recovery 25% · Sleep 20% · Training 20% · Activity 15% · Habits 10% · Consistency 10%
// Every pillar carries a "why" (the number behind it) and an "improve" hint.
// ---------------------------------------------------------------------------

export interface RythmInput {
  recovery: number; // 0–100
  sleepScore: number; // 0–100
  strainNow: number; // 0–21 today so far
  strainTarget: number; // recovery-scaled target for today
  acwr: number; // acute:chronic workload ratio
  loadStatus: string; // Underloading / Balanced / Spiking / Overloading
  steps: number;
  stepsGoal: number;
  zoneMinutes: number;
  zoneMinGoal: number; // WHO weekly target, e.g. 150
  habitToday: number; // completed today
  habitDue: number; // due today
  habitWeekPct: number; // completion rate over the last 7 days (0–100)
  sessionsDays: number; // distinct days with a workout in the last 14
}

export interface RythmPart {
  key: string;
  label: string;
  icon: string;
  weight: number; // 0–1
  score: number; // 0–100 pillar score
  reason: string; // the numbers behind the score
  improve: string; // what would raise it
}

export interface RythmScore {
  score: number; // 0–100
  color: "green" | "yellow" | "red";
  parts: RythmPart[];
}

export function rythmColor(score: number): "green" | "yellow" | "red" {
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function computeRythmScore(input: RythmInput): RythmScore {
  const {
    recovery,
    sleepScore,
    strainNow,
    strainTarget,
    acwr,
    loadStatus,
    steps,
    stepsGoal,
    zoneMinutes,
    zoneMinGoal,
    habitToday,
    habitDue,
    habitWeekPct,
    sessionsDays,
  } = input;

  // Recovery — the score itself.
  const recoveryPart: RythmPart = {
    key: "recovery",
    label: "Recovery",
    icon: "🛡️",
    weight: 0.25,
    score: recovery,
    reason: `Today's recovery is ${recovery}% — ${recovery >= 67 ? "green zone" : recovery >= 34 ? "yellow zone" : "red zone"} (HRV ${recovery >= 67 ? "holds up" : "is suppressed"}, baseline vs 7-day norms).`,
    improve: `Higher HRV and lower resting HR push recovery up — consistent sleep and lighter evenings help.`,
  };

  // Sleep.
  const sleepPart: RythmPart = {
    key: "sleep",
    label: "Sleep",
    icon: "😴",
    weight: 0.2,
    score: sleepScore,
    reason: `Sleep scored ${sleepScore}/100 (duration vs need, efficiency, deep+REM).`,
    improve: `Pay down sleep debt — each extra hour toward your need lifts the score.`,
  };

  // Training — load balance (ACWR) is the core, with a small strain-vs-target check.
  let trainingScore: number;
  if (acwr >= 0.8 && acwr <= 1.3) trainingScore = 100 - Math.abs(acwr - 1) * 40;
  else if (acwr < 0.8) trainingScore = 40 + acwr * 40; // underloading: mild
  else trainingScore = clamp(100 - (acwr - 1.3) * 80); // spiking/overloading: steep
  const strainPct = strainTarget > 0 ? (strainNow / strainTarget) * 100 : 50;
  if (strainPct > 110) trainingScore = clamp(trainingScore - 12); // overshooting today
  const trainingPart: RythmPart = {
    key: "training",
    label: "Training",
    icon: "🏋️",
    weight: 0.2,
    score: Math.round(trainingScore),
    reason: `Load balance is ${loadStatus.toLowerCase()} — 7-day load is ${acwr.toFixed(2)}× your 28-day baseline (sweet spot 0.8–1.3). Today you've used ${Math.round(strainPct)}% of your strain target.`,
    improve:
      acwr > 1.3
        ? `Ease back — one or two easy days will pull the ratio into the 0.8–1.3 sweet spot.`
        : acwr < 0.8
          ? `Add a quality session — your body is adapted and ready for more stimulus.`
          : `Keep the balance — consistent, controlled load is exactly what builds fitness.`,
  };

  // Activity — steps + zone minutes vs goals.
  const stepsPct = clamp((steps / Math.max(1, stepsGoal)) * 100);
  const zonePct = clamp((zoneMinutes / Math.max(1, zoneMinGoal)) * 100);
  const activityScore = Math.round(0.5 * stepsPct + 0.5 * zonePct);
  const activityPart: RythmPart = {
    key: "activity",
    label: "Activity",
    icon: "👟",
    weight: 0.15,
    score: activityScore,
    reason: `You're at ${Math.round(stepsPct)}% of ${stepsGoal.toLocaleString()} steps and ${Math.round(zonePct)}% of ${zoneMinGoal} weekly zone minutes.`,
    improve: `A brisk 20-min walk closes the steps gap; pushing a few minutes into zone 2–3 adds zone minutes fast.`,
  };

  // Habits — today's completion blended with the week's rate.
  const todayPct = habitDue > 0 ? (habitToday / habitDue) * 100 : 100;
  const habitScore = Math.round(0.6 * todayPct + 0.4 * habitWeekPct);
  const habitPart: RythmPart = {
    key: "habits",
    label: "Habits",
    icon: "✅",
    weight: 0.1,
    score: habitScore,
    reason: `${habitToday}/${habitDue} habits done today (${Math.round(todayPct)}%), ${Math.round(habitWeekPct)}% completion over the last 7 days.`,
    improve: `Knock out the remaining ${Math.max(0, habitDue - habitToday)} habit${habitDue - habitToday === 1 ? "" : "s"} today — they're the cheapest score points available.`,
  };

  // Consistency — training regularity over the last 14 days.
  const consistencyScore = Math.round((sessionsDays / 14) * 100);
  const consistencyPart: RythmPart = {
    key: "consistency",
    label: "Consistency",
    icon: "📅",
    weight: 0.1,
    score: consistencyScore,
    reason: `Workouts on ${sessionsDays} of the last 14 days (${consistencyScore}% training consistency).`,
    improve:
      sessionsDays < 7
        ? `Two short easy sessions this week will move the needle more than one long one.`
        : `Great rhythm — keep the cadence and protect it on busy weeks.`,
  };

  const parts = [recoveryPart, sleepPart, trainingPart, activityPart, habitPart, consistencyPart];
  const score = Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0));

  return { score, color: rythmColor(score), parts };
}
