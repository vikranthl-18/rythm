import { APP_NAME, APP_VERSION } from "../lib/version";

export type LegalDoc = "privacy" | "terms";

/** Hosted versions of these documents — deployed with the PWA at /legal/*. */
export const LEGAL_URLS: Record<LegalDoc, string> = {
  privacy: "/legal/privacy.html",
  terms: "/legal/terms.html",
};

function Privacy() {
  return (
    <div className="legal-body">
      <p>
        <b>{APP_NAME}</b> is a wellness and performance platform. This privacy notice explains
        what we collect and why. It applies to this build (v{APP_VERSION}).
      </p>
      <h4>1. What we collect</h4>
      <ul>
        <li>
          <b>Account details</b> — name, email, and (if you sign in with Google) your profile
          picture, only to identify you.
        </li>
        <li>
          <b>Profile &amp; physiology</b> — date of birth, sex, weight, height and training goal,
          which feed the recovery, strain, VO₂max and AI-metric engines.
        </li>
        <li>
          <b>Health metrics</b> — heart rate, HRV, resting HR, steps, sleep, SpO₂, skin
          temperature and workout GPS tracks you record or connect.
        </li>
      </ul>
      <h4>2. Where your data lives</h4>
      <p>
        In this build your data is stored <b>locally in your browser</b> (localStorage) and is
        never sent to a server unless you explicitly use a configured AI service. When you sign
        in with Google, Google's own privacy policy applies to the sign-in itself. GPS routes
        are stored only on your device. We do not sell or share your health data with anyone.
      </p>
      <h4>3. AI features</h4>
      <p>
        The AI coach and score reviews are powered by an LLM (e.g. Gemini) when configured. The
        physiological context used to build your coaching reply (recovery, sleep, strain,
        habits) is sent to the model provider to generate the response. Do not enter
        information you would not want processed this way. When no AI provider is configured,
        everything runs on-device.
      </p>
      <h4>4. Your rights &amp; control</h4>
      <ul>
        <li><b>Export</b> — download all of your data anytime (Settings → Data → Export).</li>
        <li><b>Delete</b> — delete your account and all stored data (Settings → Data → Delete account).</li>
        <li>
          <b>Clearing the browser</b> — because data is local, clearing this site's storage in
          your browser also removes it.
        </li>
      </ul>
      <h4>5. Not medical advice</h4>
      <p>
        {APP_NAME} is for training and wellness awareness, not diagnosis or treatment of any
        medical condition. Consult a qualified professional for medical decisions.
      </p>
      <h4>6. Changes</h4>
      <p>
        We may update this notice as the app evolves. Continued use after changes means you
        accept the updated notice.
      </p>
    </div>
  );
}

function Terms() {
  return (
    <div className="legal-body">
      <p>
        By creating an account or using <b>{APP_NAME}</b> you agree to these terms.
      </p>
      <h4>1. What the service is</h4>
      <p>
        {APP_NAME} helps you track recovery, strain, sleep, habits and workouts and receive
        AI-generated coaching suggestions. It is a training tool, not a medical device, and
        its outputs (scores, VO₂max estimates, biological age, coaching advice) are estimates
        for motivation and awareness.
      </p>
      <h4>2. Your data</h4>
      <p>
        You own the data you enter or record. You can export it or delete it at any time. We
        process it only to provide the features you use.
      </p>
      <h4>3. Acceptable use</h4>
      <p>
        Don't misuse the service: don't attempt to break it, scrape other users' data, or use
        it to harass anyone. This is a test build — features may change or disappear.
      </p>
      <h4>4. Availability</h4>
      <p>
        This build is provided "as is" for testing. We may pause, change or discontinue it
        without notice, and we're not liable for losses from using it. If it's unavailable,
        your locally stored data remains on your device.
      </p>
      <h4>5. AI coaching disclaimer</h4>
      <p>
        AI-generated suggestions are best-effort and can be wrong. Always use your judgment —
        don't train through injury, and see a professional for anything beyond general fitness
        advice.
      </p>
      <h4>6. Age</h4>
      <p>
        You must be at least 13 years old (or the minimum age in your country) to use {APP_NAME}.
      </p>
      <h4>7. Contact</h4>
      <p>
        Questions? Use Settings → Send feedback or email feedback@rythm.app.
      </p>
    </div>
  );
}

export default function LegalSheet({
  doc,
  onClose,
}: {
  doc: LegalDoc;
  onClose: () => void;
}) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">⚖️</div>
          <h2>{doc === "privacy" ? "Privacy Policy" : "Terms of Use"}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {doc === "privacy" ? <Privacy /> : <Terms />}
          <a className="link" style={{ display: "block", marginTop: 14 }} href={LEGAL_URLS[doc]} target="_blank" rel="noreferrer">
            Open the full hosted {doc === "privacy" ? "Privacy Policy" : "Terms of Use"} ↗
          </a>
          <button className="btn-start" style={{ marginTop: 14 }} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
