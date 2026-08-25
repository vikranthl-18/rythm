import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Digest } from "../engine/digest";
import { buildDigest, buildDigestFallback } from "../engine/digest";
import type { DigestInput } from "../engine/digest";

export default function DigestSheet({
  input,
  onClose,
}: {
  input: DigestInput;
  onClose: () => void;
}) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const aiOn = useStore((s) => s.features.aiCoach);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // AI off → the on-device engine writes it (no model call, nothing sent).
    const run = aiOn ? buildDigest(input) : Promise.resolve(buildDigestFallback(input));
    run.then((d) => {
      if (cancelled) return;
      setDigest(d);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [input, aiOn]);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-icon">📖</div>
          <h2>Weekly digest</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {loading ? (
            <div className="digest-loading">
              <div className="typing-dots">
                <i />
                <i />
                <i />
              </div>
              <p className="hint">Reviewing your last 7 days…</p>
            </div>
          ) : digest ? (
            <>
              <span className={`chip ${digest.ai ? "chip live" : ""}`} style={{ marginBottom: 12 }}>
                {digest.ai ? "✨ AI-powered" : "on-device engine"}
              </span>
              <div className="digest-body">
                {digest.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <p className="hint">
                {digest.ai
                  ? "Written by the model from your actual last-7-days numbers."
                  : "Formula-grounded summary — the AI path writes this too when a model is configured."}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
