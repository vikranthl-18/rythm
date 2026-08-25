import { useId, useState, type ReactNode } from "react";

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Circular progress ring
// ---------------------------------------------------------------------------

export function Ring({
  size = 148,
  stroke = 12,
  pct,
  color = "var(--green)",
  track = "var(--t-10)",
  children,
}: {
  size?: number;
  stroke?: number;
  pct: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp01(pct));
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="ring">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.4,0,.2,1), stroke .5s" }}
        />
      </svg>
      <div className="ring-inner">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semi-circular gauge (strain 0–21)
// ---------------------------------------------------------------------------

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  // sweep=1 draws in the *increasing*-angle direction, so an arc from 180°
  // to 0° passes through 270° — over the top — giving the classic gauge:
  // flat chord at the bottom, 0 at bottom-left, max at bottom-right, and the
  // value sweeping up over the top.
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function StrainGauge({
  strain,
  target = 0,
  max = 21,
  color = "var(--green)",
  height = 110,
  showTarget = true,
}: {
  strain: number;
  target?: number;
  max?: number;
  color?: string;
  height?: number;
  showTarget?: boolean;
}) {
  // Classic gauge orientation: the flat chord sits at the bottom (0 at the
  // left end, max at the right end) and the value sweeps up over the top.
  // cy/r are tuned so the whole arc fits inside the viewBox with the labels
  // below the chord — no clipping, and the fill length matches the value.
  const width = height * 2;
  const cx = width / 2;
  const cy = height - 16;
  const r = height - 32;
  const frac = clamp01(strain / max);
  const tFrac = clamp01(target / max);
  // 180° = left end (0), 360° = right end (max); increasing angle goes up
  // over the top, so valueEnd = 180 + 180·frac sweeps 0 → full arc.
  const valueEnd = 180 + 180 * frac;
  const targetDeg = 180 + 180 * tFrac;
  const [tx, ty] = polar(cx, cy, r - 6, targetDeg);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="gauge" style={{ width: "100%" }}>
      <path
        d={arcPath(cx, cy, r, 180, 0)}
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
        style={{ stroke: "var(--t-10)" }}
      />
      <path
        d={arcPath(cx, cy, r, 180, valueEnd)}
        stroke={color}
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
        style={{ transition: "d .6s ease, stroke .5s" }}
      />
      {showTarget && (
        <line x1={tx} y1={ty - 4} x2={tx} y2={ty + 4} strokeWidth={2} style={{ stroke: "var(--text)", opacity: 0.75 }} />
      )}
      <text x={8} y={cy + 7} fontSize={10} style={{ fill: "var(--text-faint)" }}>
        0
      </text>
      <text x={width - 8} y={cy + 7} fontSize={10} textAnchor="end" style={{ fill: "var(--text-faint)" }}>
        {max}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (SVG polyline + area fill)
// ---------------------------------------------------------------------------

export function Sparkline({
  data,
  w = 150,
  h = 42,
  color = "var(--green)",
  fill = true,
}: {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
}) {
  const gid = useId();
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - 3 - ((v - min) / span) * (h - 6),
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="spark">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line} L ${w},${h} L 0,${h} Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trend line chart (dots + min/max labels) for metric detail views
// ---------------------------------------------------------------------------

export function TrendChart({
  data,
  color = "var(--green)",
  height = 130,
  unit = "",
  labels = true,
  selectedIndex,
  onSelect,
  times,
}: {
  data: number[];
  color?: string;
  height?: number;
  unit?: string;
  labels?: boolean;
  /** index of the highlighted point (the day being viewed) */
  selectedIndex?: number;
  /** called with the point index when a data point is tapped */
  onSelect?: (i: number) => void;
  /** per-point secondary label (e.g. the time the value was measured) */
  times?: string[];
}) {
  const gid = useId();
  const w = 320;
  const padX = 20;
  const top = 24;
  const bottom = 20;
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    padX + (i / (data.length - 1)) * (w - padX * 2),
    top + ((max - v) / span) * (height - top - bottom),
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const sel = Math.max(0, Math.min(data.length - 1, selectedIndex ?? data.length - 1));
  const selPt = pts[sel];
  const selVal = data[sel];
  const chip = Number.isInteger(selVal) ? selVal.toLocaleString() : selVal.toFixed(1);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="trend" style={{ width: "100%" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L ${w - padX},${height} L ${padX},${height} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />

      {/* guide line + value chip for the selected day */}
      {onSelect && (
        <line
          x1={selPt[0]}
          y1={top}
          x2={selPt[0]}
          y2={height - bottom}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.45}
        />
      )}
      {(() => {
        const time = times?.[sel];
        const chipW = time ? 74 : 54;
        const chipH = time ? 24 : 14;
        return (
          <g>
            <rect x={selPt[0] - chipW / 2} y={top - 18} width={chipW} height={chipH} rx={8} fill={color} opacity={0.14} />
            <text
              x={selPt[0]}
              y={top - 7}
              fontSize={9.5}
              textAnchor="middle"
              fontWeight={700}
              fill={color}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {chip}
              {unit}
            </text>
            {time && (
              <text
                x={selPt[0]}
                y={top + 3}
                fontSize={8.5}
                textAnchor="middle"
                fill={color}
                opacity={0.9}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {time}
              </text>
            )}
          </g>
        );
      })()}

      {pts.map((p, i) => {
        const isSel = i === sel;
        return (
          <g
            key={i}
            style={{ cursor: onSelect ? "pointer" : "default" }}
            onClick={onSelect ? () => onSelect(i) : undefined}
          >
            {/* invisible fat hit target so taps land easily */}
            {onSelect && <circle cx={p[0]} cy={p[1]} r={11} fill="transparent" />}
            <circle
              cx={p[0]}
              cy={p[1]}
              r={isSel ? 5.5 : 3}
              fill={isSel ? color : "var(--card)"}
              stroke={color}
              strokeWidth={1.6}
            />
          </g>
        );
      })}

      {labels && (
        <>
          <text x={padX} y={height - 5} fontSize={10} fill="var(--text-faint)" style={{ fontVariantNumeric: "tabular-nums" }}>
            {min}
            {unit}
          </text>
          <text x={w - padX} y={height - 5} fontSize={10} fill="var(--text-faint)" textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
            {max}
            {unit}
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Intraday line chart — one day, time-of-day x-axis ("the up and down of it")
// ---------------------------------------------------------------------------

function fmtClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

/**
 * Same-day chart: x = minutes since local midnight (0–1440), y = value.
 * Points are tappable — a chip shows the exact time + value of the tap.
 * Only draws when there are ≥ 2 samples; the caller decides when to render.
 */
export function IntradayChart({
  samples,
  color = "var(--green)",
  height = 150,
  unit = "",
}: {
  samples: { t: number; value: number }[];
  color?: string;
  height?: number;
  unit?: string;
}) {
  const gid = useId();
  const [sel, setSel] = useState(() => null as number | null);
  // Drop out-of-range / malformed points, then sort by time of day.
  const pts = samples
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.value) && s.t >= 0 && s.t < 1440)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const w = 320;
  const padX = 26;
  const top = 34;
  const bottom = 22;
  const min = Math.min(...pts.map((p) => p.value));
  const max = Math.max(...pts.map((p) => p.value));
  const span = max - min || 1;
  const x = (t: number) => padX + (t / 1440) * (w - padX * 2);
  const y = (v: number) => top + ((max - v) / span) * (height - top - bottom);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const si = sel !== null ? Math.min(sel, pts.length - 1) : pts.length - 1;
  const selPt = pts[si];
  const chipVal = Number.isInteger(selPt.value) ? selPt.value.toLocaleString() : selPt.value.toFixed(1);
  const ticks = [0, 360, 720, 1080, 1439];

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="trend" style={{ width: "100%" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L ${w - padX},${height} L ${padX},${height} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* hour gridlines + time labels */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)}
            y1={top}
            x2={x(t)}
            y2={height - bottom}
            stroke="var(--text)"
            strokeWidth={1}
            opacity={0.08}
          />
          <text x={x(t)} y={height - 7} fontSize={9} textAnchor={t === 0 ? "start" : t === 1439 ? "end" : "middle"} fill="var(--text-faint)" style={{ fontVariantNumeric: "tabular-nums" }}>
            {t === 1439 ? "12a" : fmtClock(t)}
          </text>
        </g>
      ))}

      {/* selection chip: time + value of the tapped point */}
      <g>
        <line x1={x(selPt.t)} y1={top} x2={x(selPt.t)} y2={height - bottom} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
        <rect x={x(selPt.t) - 46} y={top - 26} width={92} height={20} rx={9} fill={color} opacity={0.14} />
        <text x={x(selPt.t)} y={top - 12} fontSize={10} textAnchor="middle" fontWeight={700} fill={color} style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtClock(selPt.t)} · {chipVal}
          {unit}
        </text>
      </g>

      {/* clickable points */}
      {pts.map((p, i) => (
        <g
          key={`${p.t}-${i}`}
          style={{ cursor: "pointer" }}
          onClick={() => setSel(i)}
        >
          <circle cx={x(p.t)} cy={y(p.value)} r={11} fill="transparent" />
          <circle
            cx={x(p.t)}
            cy={y(p.value)}
            r={i === si ? 5 : 3.2}
            fill={i === si ? color : "var(--card)"}
            stroke={color}
            strokeWidth={1.5}
          />
        </g>
      ))}

      {/* min / max labels */}
      <text x={padX} y={top - 4} fontSize={9} fill="var(--text-faint)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {max}
        {unit}
      </text>
      <text x={padX} y={height - bottom + 11} fontSize={9} fill="var(--text-faint)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {min}
        {unit}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Simple bar chart
// ---------------------------------------------------------------------------

export function Bars({
  data,
  color = "var(--green)",
  height = 64,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="bar-col" title={`${d.label}: ${d.value}`}>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ height: `${(d.value / max) * 100}%`, background: color, opacity: 0.35 + 0.65 * (d.value / max) }}
            />
          </div>
          <span className="bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits & pieces
// ---------------------------------------------------------------------------

export function Section({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card section ${className}`}>
      {(title || right) && (
        <div className="section-head">
          <h3>{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <div className="stat">
      {icon && <div className="stat-icon">{icon}</div>}
      <div className="stat-label">{label}</div>
      <div className={`stat-value tone-${tone}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Delta({ value, suffix = "", invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`delta ${good ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
      {suffix}
    </span>
  );
}

export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${clamp01(pct) * 100}%`, background: color }} />
    </div>
  );
}
