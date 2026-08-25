import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { ageFromBirthday } from "../lib/age";
import {
  buildExportPayload,
  dailyMetricsCsv,
  downloadCsv,
  downloadJson,
  workoutsCsv,
} from "../lib/dataExport";
import { APP_VERSION, buildInfo, diagnosticInfo, feedbackHref } from "../lib/version";
import { getLastError } from "../lib/errors";
import {
  decryptVault,
  encryptVault,
  restoreLocalData,
  snapshotLocalData,
  vaultAvailable,
} from "../lib/vault";
import { supabase, supabaseAvailable } from "../lib/supabase";

/** Collapsible settings section: a button row that opens/closes its body. */
function SettingsGroup({
  icon,
  title,
  sub,
  open,
  onToggle,
  children,
}: {
  icon: string;
  title: string;
  sub: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`settings-group ${open ? "open" : ""}`}>
      <button className="settings-group-btn" onClick={onToggle} aria-expanded={open}>
        <span className="sg-icon">{icon}</span>
        <span className="sg-title">{title}</span>
        <span className="sg-sub">{sub}</span>
        <span className="sg-chevron">▸</span>
      </button>
      {open && <div className="settings-group-body">{children}</div>}
    </div>
  );
}

/** Preset app colors. First entry (null) = the theme's default (brick/purple
 * for primary, sage/emerald for secondary), rest are hand-picked hexes that
 * read well on both light and dark surfaces. */
const ACCENT_PRESETS: (string | null)[] = [
  null,
  "#c75b39",
  "#d98e32",
  "#c9a227",
  "#3b82c4",
  "#4f6fd4",
  "#7c6cff",
  "#9b4dca",
  "#d44e7d",
];
const GREEN_PRESETS: (string | null)[] = [
  null,
  "#2e9e6b",
  "#2f8f8f",
  "#3aa58a",
  "#3b82c4",
  "#5b8cff",
  "#8b7cf6",
  "#8a8f3d",
  "#c05b4a",
];

export default function Settings() {
  const s = useStore();
  const theme = s.theme;
  const auth = s.auth;
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [vaultPass, setVaultPass] = useState("");
  const [vaultMsg, setVaultMsg] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [passBusy, setPassBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string>("account");
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) => setOpenGroup((cur) => (cur === id ? "" : id));

  const savePassword = async () => {
    setPassMsg(null);
    if (!supabase) return setPassMsg("Password changes need the app connected to its backend.");
    if (newPass.length < 6) return setPassMsg("Use at least 6 characters.");
    if (newPass !== confirmPass) return setPassMsg("The two passwords don't match.");
    setPassBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) setPassMsg(error.message);
      else {
        setPassMsg("Password saved — you can now sign in with this email + password.");
        setNewPass("");
        setConfirmPass("");
      }
    } catch (e) {
      setPassMsg(String(e));
    }
    setPassBusy(false);
  };

  const exportVault = async () => {
    setVaultMsg(null);
    if (!vaultAvailable()) return setVaultMsg("Encryption isn't available in this browser (needs a secure context).");
    if (vaultPass.length < 8) return setVaultMsg("Use a passphrase of at least 8 characters.");
    setVaultBusy(true);
    try {
      const vault = await encryptVault(snapshotLocalData(), vaultPass);
      const blob = new Blob([vault], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rythm-backup-${new Date().toISOString().slice(0, 10)}.ryv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setVaultMsg("Backup downloaded — keep the file and your passphrase safe. Only you can open it.");
    } catch (e) {
      setVaultMsg(`Export failed: ${String(e)}`);
    } finally {
      setVaultBusy(false);
    }
  };

  const restoreVault = async (file: File) => {
    setVaultMsg(null);
    if (!vaultPass) return setVaultMsg("Enter the passphrase you used for this backup first.");
    setVaultBusy(true);
    try {
      const text = await file.text();
      const snapshot = await decryptVault(text.trim(), vaultPass);
      restoreLocalData(snapshot);
      setVaultMsg("Restored ✓ reloading…");
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setVaultMsg("Couldn't open that backup — wrong passphrase or a corrupted file.");
    } finally {
      setVaultBusy(false);
    }
  };

  // Profile photo: pick a file, cover-crop it to a small square, store as a
  // data URL in the profile (synced with the cloud profile row).
  const changeAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setAvatarMsg("Pick an image file.");
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const scale = Math.max(size / img.width, size / img.height);
        const w = size / scale;
        const h = size / scale;
        ctx.fillStyle = "#fdf8ef";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        s.updateProfile({ avatar: canvas.toDataURL("image/jpeg", 0.85) });
        setAvatarMsg("Photo updated ✓");
        setTimeout(() => setAvatarMsg(null), 1800);
      };
      img.onerror = () => setAvatarMsg("Couldn't read that image.");
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  // local profile form (synced when the store profile changes, e.g. reset demo)
  const [name, setName] = useState(s.profile.name);
  const [birthday, setBirthday] = useState(s.profile.birthday ?? "");
  const [age, setAge] = useState(String(s.profile.age));
  const [sex, setSex] = useState<"male" | "female">(s.profile.sex);
  const [weightKg, setWeightKg] = useState(String(s.profile.weightKg));
  const [heightCm, setHeightCm] = useState(String(s.profile.heightCm));
  const [phone, setPhone] = useState(s.profile.phone ?? "");
  const [goal, setGoal] = useState(s.profile.goal);

  useEffect(() => {
    setName(s.profile.name);
    setBirthday(s.profile.birthday ?? "");
    setAge(String(s.profile.age));
    setSex(s.profile.sex);
    setWeightKg(String(s.profile.weightKg));
    setHeightCm(String(s.profile.heightCm));
    setPhone(s.profile.phone ?? "");
    setGoal(s.profile.goal);
  }, [s.profile]);

  const save = () => {
    // A valid birthday always wins over the age field (they stay in sync).
    const bdAge = birthday ? ageFromBirthday(birthday) : null;
    const a = bdAge !== null ? bdAge : parseInt(age, 10);
    const w = parseFloat(weightKg);
    const h = parseFloat(heightCm);
    if (!name.trim() || Number.isNaN(a) || a < 13 || a > 100) return;
    if (Number.isNaN(w) || w < 30 || w > 300) return;
    if (Number.isNaN(h) || h < 120 || h > 230) return;
    s.updateProfile({
      name: name.trim(),
      birthday: birthday || undefined,
      age: a,
      sex,
      weightKg: w,
      heightCm: h,
      phone: phone.trim() || undefined,
      goal: goal.trim() || s.profile.goal,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const ageOk = !Number.isNaN(parseInt(age, 10)) && parseInt(age, 10) >= 13 && parseInt(age, 10) <= 100;
  const weightOk = !Number.isNaN(parseFloat(weightKg)) && parseFloat(weightKg) >= 30 && parseFloat(weightKg) <= 300;
  const heightOk = !Number.isNaN(parseFloat(heightCm)) && parseFloat(heightCm) >= 120 && parseFloat(heightCm) <= 230;
  const canSave = !!name.trim() && ageOk && weightOk && heightOk;

  const heroAvatar = s.profile.avatar ?? auth?.picture;

  // Effective accent/secondary defaults (used for the "default" swatch).
  const defaultAccent = theme === "dark" ? "#8b7cff" : "#bd4444";
  const defaultGreen = theme === "dark" ? "#34d399" : "#73976a";

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span>
          <span className="brand-name">Settings</span>
        </div>
      </header>

      {/* Profile hero — always visible; tap the photo to change it */}
      <div className="settings-hero">
        <div className="hero-top">
          <button className="avatar-btn" onClick={() => avatarRef.current?.click()} title="Change profile photo">
            {heroAvatar ? <img src={heroAvatar} alt="" /> : (auth?.name ?? s.profile.name).charAt(0).toUpperCase()}
          </button>
          <input
            ref={avatarRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              changeAvatar(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="acct-body">
            <div className="acct-name">{auth?.name ?? s.profile.name}</div>
            <div className="acct-email">{auth?.email ?? "Local profile — not signed in"}</div>
            <div className="acct-meta">
              {auth && (
                <span className="chip">{auth.provider === "google" ? "Google account" : "Email account"}</span>
              )}
              <span className="hint-inline">tap the photo to change it</span>
            </div>
            {heroAvatar && (
              <button
                className="link-btn"
                style={{ marginTop: 2, padding: 0 }}
                onClick={() => s.updateProfile({ avatar: undefined })}
              >
                remove photo
              </button>
            )}
            {avatarMsg && <div className="hint-inline" style={{ color: "var(--green)" }}>{avatarMsg}</div>}
          </div>
        </div>
        {auth && (
          <button className="btn-ghost btn-danger hero-logout" onClick={() => s.logout()}>
            Log out
          </button>
        )}
      </div>

      <div className="settings-groups">
        <SettingsGroup
          icon="👤"
          title="Account & profile"
          sub="name, age, weight, goal"
          open={openGroup === "account"}
          onToggle={() => toggle("account")}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            These feed the AI metrics — VO₂max, biological age, fitness score and resting
            metabolic rate are all computed from the numbers below.
          </p>
          <div className="habit-form">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Date of birth</span>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={birthday}
                  onChange={(e) => {
                    setBirthday(e.target.value);
                    const a = e.target.value ? ageFromBirthday(e.target.value) : null;
                    if (a !== null && a >= 13 && a <= 100) setAge(String(a));
                  }}
                />
              </label>
              <label className="field">
                <span>Age</span>
                <input
                  type="number"
                  min={13}
                  max={100}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </label>
              <div className="field">
                <span>Sex</span>
                <div className="seg">
                  <button className={`seg-btn ${sex === "male" ? "active" : ""}`} onClick={() => setSex("male")}>
                    Male
                  </button>
                  <button className={`seg-btn ${sex === "female" ? "active" : ""}`} onClick={() => setSex("female")}>
                    Female
                  </button>
                </div>
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
                />
              </label>
            </div>
            <label className="field">
              <span>Goal</span>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Sub-20 min 5k" />
            </label>
            <label className="field">
              <span>Phone (optional)</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +1 415 555 0131 — friends find you by this"
              />
              <span className="hint-inline" style={{ marginTop: 4 }}>
                Used only to match friends from your contacts.
              </span>
            </label>
            <button className="btn-start" onClick={save} disabled={!canSave}>
              {saved ? "✓ Saved" : "Save profile"}
            </button>
          </div>
        </SettingsGroup>

        <SettingsGroup
          icon="🔐"
          title="Sign-in & sync"
          sub="password, cloud sync"
          open={openGroup === "signin"}
          onToggle={() => toggle("signin")}
        >
          {supabaseAvailable && auth && (
            <div style={{ marginBottom: 14 }}>
              <p className="hint" style={{ marginTop: 0 }}>
                Set a password to sign in with this email + password instead of Google — handy on
                new devices and when Google isn&apos;t available.
              </p>
              <div className="pass-grid">
                <label className="field">
                  <span>New password</span>
                  <input
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    placeholder="Repeat it"
                    autoComplete="new-password"
                    onKeyDown={(e) => e.key === "Enter" && void savePassword()}
                  />
                </label>
              </div>
              {passMsg && <p className={`hint ${passMsg.startsWith("Password saved") ? "pass-ok" : "pass-err"}`}>{passMsg}</p>}
              <button className="btn-start" onClick={() => void savePassword()} disabled={passBusy} style={{ marginTop: 4 }}>
                {passBusy ? "Saving…" : auth.provider === "google" ? "Set a password" : "Change password"}
              </button>
            </div>
          )}
          <p className="hint" style={{ marginTop: 0 }}>
            <b>Local-first by default.</b> Your data lives on this device and nothing is
            synced until you turn this on. When enabled, your metrics, workouts, habits and
            friends back up to your Supabase account and follow you across devices
            (last-write-wins by time).
          </p>
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">Sync to the cloud</div>
              <div className="hint-inline">
                {supabaseAvailable
                  ? "Back up this account's data to Supabase and restore it on other devices."
                  : "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) to enable real accounts + sync."}
              </div>
            </div>
            <button
              className={`toggle ${s.syncEnabled ? "on" : ""}`}
              role="switch"
              aria-checked={s.syncEnabled}
              disabled={!supabaseAvailable}
              onClick={() => void s.setSyncEnabled(!s.syncEnabled)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          {s.syncEnabled && supabaseAvailable && (
            <>
              <div className="btn-row" style={{ marginTop: 4 }}>
                <button className="btn-ghost" disabled={s.syncStatus === "syncing"} onClick={() => void s.syncNow()}>
                  {s.syncStatus === "syncing" ? "Syncing…" : "Sync now"}
                </button>
                <span
                  className={`pill ${
                    s.syncStatus === "synced" ? "pill-good" : s.syncStatus === "error" ? "pill-bad" : "pill-neutral"
                  }`}
                >
                  {s.syncStatus === "synced" ? "Synced" : s.syncStatus === "error" ? "Sync error" : s.syncStatus === "syncing" ? "Syncing…" : "Off"}
                </span>
              </div>
              {s.syncError && (
                <p className="hint" style={{ color: "var(--text-dim)" }}>{s.syncError}</p>
              )}
              {s.lastSyncedAt && (
                <p className="hint">Last synced {new Date(s.lastSyncedAt).toLocaleString()}.</p>
              )}
            </>
          )}
        </SettingsGroup>

        <SettingsGroup
          icon="🎨"
          title="Appearance"
          sub="light or dark"
          open={openGroup === "appearance"}
          onToggle={() => toggle("appearance")}
        >
          <div className="field" style={{ marginBottom: 10 }}>
            <span>Theme</span>
            <div className="seg">
              <button
                className={`seg-btn ${theme === "light" ? "active" : ""}`}
                onClick={() => s.setTheme("light")}
              >
                ☀️ Light
              </button>
              <button
                className={`seg-btn ${theme === "dark" ? "active" : ""}`}
                onClick={() => s.setTheme("dark")}
              >
                🌙 Dark
              </button>
            </div>
          </div>
          <div className="theme-preview">
            <span className="theme-swatch" style={{ background: "#fdf8ef" }} />
            <span className="theme-swatch" style={{ background: theme === "dark" ? "#8b7cff" : "#bd4444" }} />
            <span className="theme-swatch" style={{ background: theme === "dark" ? "#34d399" : "#73976a" }} />
            <span className="hint-inline" style={{ marginLeft: "auto" }}>
              Light = cream &amp; brick · Dark = the original night look
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="toggle-title" style={{ marginBottom: 6 }}>App colors</div>
            <p className="hint" style={{ marginTop: 0 }}>
              Default is brick + sage. Tap a color to re-theme the whole app — the first
              swatch is always the current theme&apos;s default.
            </p>
            <div className="swatch-group">
              <div className="swatch-label">Primary — buttons, highlights, logo</div>
              <div className="swatch-grid">
                {ACCENT_PRESETS.map((hex) => {
                  const val = hex ?? defaultAccent;
                  const selected = hex === null ? !s.accentColor : s.accentColor === hex;
                  return (
                    <button
                      key={hex ?? "default"}
                      className={`swatch-btn ${selected ? "selected" : ""}`}
                      style={{ background: val }}
                      title={hex ? `Primary ${hex}` : "Default"}
                      aria-label={hex ? `Primary color ${hex}` : "Primary color (default)"}
                      onClick={() => s.setAccentColor(hex)}
                    />
                  );
                })}
              </div>
            </div>
            <div className="swatch-group">
              <div className="swatch-label">Secondary — recovery rings, streaks, positives</div>
              <div className="swatch-grid">
                {GREEN_PRESETS.map((hex) => {
                  const val = hex ?? defaultGreen;
                  const selected = hex === null ? !s.greenColor : s.greenColor === hex;
                  return (
                    <button
                      key={hex ?? "default"}
                      className={`swatch-btn ${selected ? "selected" : ""}`}
                      style={{ background: val }}
                      title={hex ? `Secondary ${hex}` : "Default"}
                      aria-label={hex ? `Secondary color ${hex}` : "Secondary color (default)"}
                      onClick={() => s.setGreenColor(hex)}
                    />
                  );
                })}
              </div>
            </div>
            {(s.accentColor || s.greenColor) && (
              <button
                className="btn-ghost"
                style={{ marginTop: 4 }}
                onClick={() => {
                  s.setAccentColor(null);
                  s.setGreenColor(null);
                }}
              >
                ↺ Reset to default colors
              </button>
            )}
          </div>
        </SettingsGroup>

        <SettingsGroup
          icon="🎙️"
          title="Location & audio"
          sub="GPS routes, spoken coach"
          open={openGroup === "location"}
          onToggle={() => toggle("location")}
        >
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">GPS routes</div>
              <div className="hint-inline">
                Used only to record outdoor workout routes — never stored on a server.
              </div>
            </div>
            <span
              className={`pill ${
                s.gpsPermission === "granted"
                  ? "pill-good"
                  : s.gpsPermission === "denied"
                    ? "pill-bad"
                    : "pill-neutral"
              }`}
            >
              {s.gpsPermission === "granted"
                ? "On"
                : s.gpsPermission === "denied"
                  ? "Off"
                  : s.gpsPermission === "unsupported"
                    ? "Unavailable"
                    : "Not asked"}
            </span>
          </div>
          {s.gpsPermission === "granted" ? (
            <p className="hint">
              Location access is on. You can revoke it anytime in your browser&apos;s site settings
              (padlock icon → Location).
            </p>
          ) : (
            <button
              className="btn-ghost"
              style={{ marginTop: 10 }}
              disabled={s.gpsPermission === "unsupported"}
              onClick={async () => {
                const r = await s.requestGpsPermission();
                if (r.blocked) {
                  alert(
                    "Location is blocked in this browser — allow it in the site settings (padlock icon → Location), then tap Enable again."
                  );
                }
              }}
            >
              Enable GPS
            </button>
          )}
          <div style={{ height: 10 }} />
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">Spoken coaching during workouts</div>
              <div className="hint-inline">
                HR zone cues, pace vs goal, kilometer splits and ghost-race gaps — spoken out loud
                as you train.
              </div>
            </div>
            <button
              className={`toggle ${s.audioCoachOn ? "on" : ""}`}
              role="switch"
              aria-checked={s.audioCoachOn}
              onClick={() => s.setAudioCoach(!s.audioCoachOn)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </SettingsGroup>

        <SettingsGroup
          icon="⚙️"
          title="Features"
          sub="AI, digest, gamification"
          open={openGroup === "features"}
          onToggle={() => toggle("features")}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Everything is on by default — switch off anything you don&apos;t want running.
            Turning AI off keeps every engine on-device: no data leaves your browser.
          </p>
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">AI coach &amp; insights</div>
              <div className="hint-inline">
                The chat coach, the AI analysis in every score sheet and the AI-written
                digest call a cloud model with your stats. Off = fully on-device — no data
                ever leaves your browser.
              </div>
            </div>
            <button
              className={`toggle ${s.features.aiCoach ? "on" : ""}`}
              role="switch"
              aria-checked={s.features.aiCoach}
              onClick={() => s.setFeature("aiCoach", !s.features.aiCoach)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">Weekly digest</div>
              <div className="hint-inline">
                The Monday-morning retrospective card on your home page.
              </div>
            </div>
            <button
              className={`toggle ${s.features.weeklyDigest ? "on" : ""}`}
              role="switch"
              aria-checked={s.features.weeklyDigest}
              onClick={() => s.setFeature("weeklyDigest", !s.features.weeklyDigest)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">Beat last week</div>
              <div className="hint-inline">
                The gamified &quot;vs last week&quot; comparison card on your home page.
              </div>
            </div>
            <button
              className={`toggle ${s.features.beatLastWeek ? "on" : ""}`}
              role="switch"
              aria-checked={s.features.beatLastWeek}
              onClick={() => s.setFeature("beatLastWeek", !s.features.beatLastWeek)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="toggle-row">
            <div className="toggle-body">
              <div className="toggle-title">Auto-complete habits</div>
              <div className="hint-inline">
                Habits linked to biometrics (like &quot;Sleep 8h&quot;) tick themselves off
                from your wearable data. Off = you mark them manually.
              </div>
            </div>
            <button
              className={`toggle ${s.features.autoHabits ? "on" : ""}`}
              role="switch"
              aria-checked={s.features.autoHabits}
              onClick={() => s.setFeature("autoHabits", !s.features.autoHabits)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </SettingsGroup>

        <SettingsGroup
          icon="🛡️"
          title="Privacy & backup"
          sub="encrypted backup, export, delete"
          open={openGroup === "privacy"}
          onToggle={() => toggle("privacy")}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            <b>Local-first.</b> Your physiology never leaves this device — data is stored in your
            browser, never synced or sold. For a portable, <b>end-to-end encrypted</b> backup, set a
            passphrase and export: the file is AES-256 encrypted with a key derived from your
            passphrase (PBKDF2), so only you can open it.
          </p>
          <div className="field" style={{ marginBottom: 10 }}>
            <span>Passphrase</span>
            <input
              type="password"
              value={vaultPass}
              onChange={(e) => setVaultPass(e.target.value)}
              placeholder="At least 8 characters — don't forget it"
            />
          </div>
          <div className="btn-row">
            <button className="btn-ghost" disabled={vaultBusy} onClick={exportVault}>
              🔐 Export encrypted backup
            </button>
            <button className="btn-ghost" disabled={vaultBusy} onClick={() => fileRef.current?.click()}>
              🔓 Restore backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".ryv,application/octet-stream"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void restoreVault(f);
                e.target.value = "";
              }}
            />
          </div>
          {vaultMsg && <p className="hint" style={{ color: "var(--text-dim)" }}>{vaultMsg}</p>}
          <div style={{ height: 12 }} />
          <p className="hint" style={{ marginTop: 0 }}>
            You own your data. Export everything rythm knows about this account as JSON or CSV
            spreadsheets — great for backups or moving to another app.
          </p>
          <div className="btn-row">
            <button
              className="btn-ghost"
              onClick={() => {
                const payload = buildExportPayload({
                  email: s.auth?.email ?? "",
                  name: s.auth?.name ?? s.profile.name,
                  profile: s.profile,
                  days: s.days,
                  workouts: s.workouts,
                  habits: s.habits,
                  friends: s.friends,
                  devices: s.devices,
                });
                downloadJson(payload);
              }}
            >
              ⬇ Export all (JSON)
            </button>
            <button
              className="btn-ghost"
              onClick={() => downloadCsv(`rythm-metrics-${new Date().toISOString().slice(0, 10)}.csv`, dailyMetricsCsv(s.days))}
            >
              ⬇ Metrics (CSV)
            </button>
            <button
              className="btn-ghost"
              onClick={() => downloadCsv(`rythm-workouts-${new Date().toISOString().slice(0, 10)}.csv`, workoutsCsv(s.workouts))}
            >
              ⬇ Workouts (CSV)
            </button>
          </div>
          <div style={{ height: 12 }} />
          <p className="hint" style={{ marginTop: 0 }}>
            Restore the demo dataset: reseeds 14 days of history, devices, workouts and
            friends.
          </p>
          <button className="btn-ghost" onClick={() => s.resetDemo()}>
            Reset demo data
          </button>
          <div style={{ height: 12 }} />
          <p className="hint" style={{ marginTop: 0 }}>
            Permanently delete <b>{s.auth?.email}</b> and all locally stored rythm data. This
            cannot be undone.
          </p>
          <button
            className={`btn-ghost btn-danger ${confirmDelete ? "confirm" : ""}`}
            onClick={() => {
              if (confirmDelete) s.deleteAccount();
              else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 4000);
              }
            }}
          >
            {confirmDelete ? "Tap again to confirm — this deletes everything" : "Delete my account"}
          </button>
        </SettingsGroup>

        <SettingsGroup
          icon="💬"
          title="Support & about"
          sub="feedback, diagnostics, tour"
          open={openGroup === "support"}
          onToggle={() => toggle("support")}
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Found a bug or have an idea? Your message is prefilled with build info ({APP_VERSION})
            so we know exactly which version you're on.
          </p>
          <div className="btn-row">
            <a className="btn-ghost" href={feedbackHref()}>
              📮 Send feedback
            </a>
            <button
              className="btn-ghost"
              onClick={() => {
                const err = getLastError();
                const text = `${diagnosticInfo()}${err ? `\n\nLast error: ${err.message}` : ""}`;
                try {
                  void navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              {copied ? "Copied ✓" : "Copy diagnostics"}
            </button>
          </div>
          <div style={{ height: 12 }} />
          <p className="hint" style={{ marginTop: 0 }}>
            <b>rythm</b> v{APP_VERSION} — a unified athlete ecosystem. Recovery, strain, habits,
            workouts, device priority and the AI coach are all driven by real engines running in
            your browser. The wearable integration (Health Connect / HealthKit / BLE) plugs into
            the same simulation layer the live demo uses.
          </p>
          <p className="hint">{buildInfo()}</p>
          <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => s.setTourSeen(false)}>
            🎓 Replay the intro tour
          </button>
        </SettingsGroup>
      </div>
    </div>
  );
}
