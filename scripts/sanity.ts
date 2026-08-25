import { buildSeed } from "../src/data/seed";
import { workoutStrainFromZones, strainFromWeighted, accrueStrain, hrMax } from "../src/engine/zones";
import { computeSleepScore, sleepNeedMin, nextSleepDebt } from "../src/engine/sleep";

const max = hrMax(28);

console.log("--- strain calibration ---");
console.log("rest day 16h Z1:", strainFromWeighted(16 * 60 * 0.01).toFixed(1));
console.log("active day (14h Z1 + 2h Z2):", strainFromWeighted(14 * 60 * 0.01 + 2 * 60 * 0.1).toFixed(1));
console.log("tempo run zones:", workoutStrainFromZones(5, 12, 22, 8, 0).toFixed(1));
console.log("easy run zones:", workoutStrainFromZones(14, 18, 8, 0, 0).toFixed(1));
console.log("trail zones:", workoutStrainFromZones(10, 22, 24, 8, 0).toFixed(1));
console.log("strength zones:", workoutStrainFromZones(26, 18, 10, 0, 0).toFixed(1));
console.log("recovery jog zones:", workoutStrainFromZones(24, 14, 2, 0, 0).toFixed(1));

let st = { strain: 0, weightedMinutes: 0 };
for (let m = 0; m < 60; m++) st = accrueStrain(st, 68, max, 1); // idle
console.log("1h idle HR 68:", st.strain.toFixed(2));
for (let m = 0; m < 40; m++) st = accrueStrain(st, 150, max, 1); // run Z3
console.log("then 40min run Z3:", st.strain.toFixed(2));

console.log("\n--- sleep chain ---");
let debt = 0;
let prev = 8;
for (let i = 0; i < 5; i++) {
  const need = sleepNeedMin(prev, debt);
  const actual = 390;
  const score = computeSleepScore({ durationMin: actual, deepMin: 70, remMin: 90, awakeMin: 15, needMin: need });
  console.log(`day ${i}: need ${need}, actual ${actual}, score ${score}, debt ${debt}`);
  debt = nextSleepDebt(need, actual, debt);
  prev = 12;
}

console.log("\n--- seed summary ---");
const seed = buildSeed();
const days = seed.days;
for (const d of days.slice(-7)) {
  console.log(
    `${d.date} rec ${d.recovery} strain ${d.strain} sleep ${(d.sleep.durationMin / 60).toFixed(1)}h/${(d.sleep.needMin / 60).toFixed(1)}h score ${d.sleep.score} hrv ${d.hrv} rhr ${d.restingHR}`
  );
}
console.log("workouts:", seed.workouts.map((w) => `${w.title} strain ${w.strain}`).join(" | "));
console.log("devices:", seed.devices.map((d) => `${d.name} slot${d.priorityRank} ${d.connected ? "on" : "off"}`).join(" | "));
const hab = seed.habits.map((h) => `${h.icon}${h.title} (${Object.values(h.logs).filter((v) => v >= h.targetValue).length}/14 logs)`);
console.log("habits:", hab.join(" | "));
