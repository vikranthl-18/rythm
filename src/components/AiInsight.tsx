// Reusable "AI analysis" block for the score sheets — a compact, collapsed
// accordion that lives at the bottom of each sheet. Snapshots the insight
// spec on mount (so the 1.5s sim tick never re-fires model calls) and lets
// the user re-run with live data after expanding.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { llmComplete } from "../engine/coach";
import type { InsightSpec } from "../engine/aiInsight";

export interface AiInsightState {
  text: string | null; // null while loading
  source: "ai" | "engine";
  refresh: () => void;
}

export function useAiInsight(spec: InsightSpec): AiInsightState {
  const [text, setText] = useState<string | null>(null);
  const [source, setSource] = useState<"ai" | "engine">("engine");
  const [gen, setGen] = useState(0);
  const specRef = useRef(spec);
  specRef.current = spec; // refresh() should use the latest numbers
  // When the user turned AI off, never call the model — the deterministic
  // engine answer is used (the block itself is hidden by the component below).
  const aiOn = useStore((s) => s.features.aiCoach);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    (async () => {
      const s = specRef.current;
      const reply = aiOn ? await llmComplete(s.system, [{ role: "user", text: s.user }]) : null;
      if (cancelled) return;
      setSource(reply ? "ai" : "engine");
      setText(reply ?? s.fallback);
    })();
    return () => {
      cancelled = true;
    };
  }, [gen, aiOn]);

  return { text, source, refresh: () => setGen((g) => g + 1) };
}

export default function AiInsight({
  spec,
  title = "AI analysis",
  icon = "✨",
}: {
  spec: InsightSpec;
  title?: string;
  icon?: string;
}) {
  const aiOn = useStore((s) => s.features.aiCoach);
  const { text, source, refresh } = useAiInsight(spec);
  const [open, setOpen] = useState(false);
  if (!aiOn) return null; // feature off — hide the AI analysis block entirely
  return (
    <div className={`ai-insight${open ? " open" : ""}`}>
      <button
        className="ai-insight-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="ai-insight-title">
          {icon} {title}
        </span>
        <span className={`chip ${text === null ? "" : source === "ai" ? "" : "engine"}`}>
          {text === null ? "thinking…" : source === "ai" ? "✨ AI-powered" : "on-device engine"}
        </span>
        <span className="ai-insight-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="ai-insight-open">
          <p className="ai-insight-body">
            {text ?? (
              <span className="typing-dots" aria-label="AI is thinking">
                <i />
                <i />
                <i />
              </span>
            )}
          </p>
          <button className="ai-insight-refresh" onClick={refresh} disabled={text === null}>
            ↻ Re-run with live data
          </button>
        </div>
      )}
    </div>
  );
}
