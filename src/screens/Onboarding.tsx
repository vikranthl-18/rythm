import { useState } from "react";
import { useStore } from "../store";
import { ageFromBirthday, isSupportedAge } from "../lib/age";

const GOALS = [
  "Sub-20 min 5k",
  "First marathon",
  "Couch to 10K",
  "Half-marathon",
  "Strength + mobility",
  "General fitness",
];

export default function Onboarding() {
  const s = useStore();
  const [name, setName] = useState(s.auth?.name ?? "");
  const [birthday, setBirthday] = useState("");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [phone, setPhone] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const age = birthday ? ageFromBirthday(birthday) : null;
  const ageOk = age !== null && isSupportedAge(age);
  const weight = parseFloat(weightKg);
  const height = parseFloat(heightCm);
  const canSave =
    name.trim().length > 0 &&
    ageOk &&
    !Number.isNaN(weight) &&
    weight >= 30 &&
    weight <= 300 &&
    !Number.isNaN(height) &&
    height >= 120 &&
    height <= 230;

  const submit = () => {
    if (!canSave) {
      setError(
        !name.trim()
          ? "Enter your name."
          : !ageOk
            ? "Enter a valid date of birth (must be 13–100 years old)."
            : "Check your weight (30–300 kg) and height (120–230 cm)."
      );
      return;
    }
    setBusy(true);
    setTimeout(() => {
      s.completeOnboarding({
        name: name.trim(),
        birthday,
        age: age!,
        sex,
        weightKg: weight,
        heightCm: height,
        phone: phone.trim() || undefined,
        goal: goal.trim() || GOALS[GOALS.length - 1],
      });
    }, 350);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="logo auth-logo">◢</span>
          <span className="auth-name">rythm</span>
        </div>
        <p className="auth-tagline">
          Welcome, {name.trim() || "athlete"} — a couple of details and we&apos;ll tune every
          metric, score and the AI coach to <b>you</b>.
        </p>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
        </label>

        <label className="field">
          <span>Date of birth</span>
          <input
            type="date"
            value={birthday}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBirthday(e.target.value)}
          />
          {birthday && (
            <span className={`hint-inline ${ageOk ? "age-ok" : "age-bad"}`} style={{ marginTop: 4 }}>
              {ageOk ? `That makes you ${age} — all engines use this for HR zones, VO₂max and recovery.` : "Pick a date that makes you 13–100 years old."}
            </span>
          )}
        </label>

        <div className="field">
          <span>Sex assigned at birth</span>
          <div className="seg">
            <button className={`seg-btn ${sex === "male" ? "active" : ""}`} onClick={() => setSex("male")}>
              Male
            </button>
            <button className={`seg-btn ${sex === "female" ? "active" : ""}`} onClick={() => setSex("female")}>
              Female
            </button>
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Weight (kg)</span>
            <input
              type="number"
              min={30}
              max={300}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g. 72"
            />
          </label>
          <label className="field">
            <span>Height (cm)</span>
            <input
              type="number"
              min={120}
              max={230}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g. 178"
            />
          </label>
        </div>

        <label className="field">
          <span>Phone number (optional)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +1 415 555 0131 — helps friends find you"
          />
          <span className="hint-inline" style={{ marginTop: 4 }}>
            Used only to match friends from your contacts — never shown publicly or sold.
          </span>
        </label>

        <div className="field">
          <span>Your main goal</span>
          <div className="goal-chips">
            {GOALS.map((g) => (
              <button
                key={g}
                className={`goal-chip ${goal === g ? "active" : ""}`}
                onClick={() => setGoal(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" onClick={submit} disabled={busy}>
          {busy ? "Setting up…" : "Start training"}
        </button>
        <p className="auth-note">
          Everything is computed from these details — you can change them anytime in Settings.
        </p>
      </div>
    </div>
  );
}
