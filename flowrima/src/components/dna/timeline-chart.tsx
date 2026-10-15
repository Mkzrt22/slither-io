"use client";
import { useId, useState } from "react";

interface Point {
  label: string; // track title
  date: string | null;
  value: number;
}

/**
 * Small single-series line chart with crosshair + tooltip on hover/focus.
 * Two measures are shown as two small multiples by the caller — never on a
 * dual axis.
 */
const FORMATS = {
  decimal: (v: number) => v.toFixed(1),
  percent: (v: number) => `${Math.round(v)} %`,
};

export function TimelineChart({ title, points, unit }: { title: string; points: Point[]; unit: keyof typeof FORMATS }) {
  const format = FORMATS[unit];
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <p className="text-sm text-muted">Il faut au moins 2 titres datés pour voir une évolution.</p>;
  const W = 320;
  const H = 120;
  const pad = { l: 34, r: 12, t: 12, b: 22 };
  const values = points.map((p) => p.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.15;
  hi += span * 0.15;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.8];
  const a = active ?? points.length - 1;

  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted">
          {points[a].label} : <strong className="text-foreground">{format(points[a].value)}</strong>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-labelledby={`${id}-t`}
        onMouseLeave={() => setActive(null)}
      >
        <title id={`${id}-t`}>
          {title} : {points.map((p) => `${p.label} ${format(p.value)}`).join(", ")}
        </title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} />
        )}
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={i === a ? 5 : 4} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />
            {/* generous hit target */}
            <rect
              x={x(i) - (W - pad.l - pad.r) / (points.length - 1) / 2}
              y={0}
              width={(W - pad.l - pad.r) / (points.length - 1)}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={`${p.label}${p.date ? ` (${p.date.slice(0, 4)})` : ""} : ${format(p.value)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          </g>
        ))}
        <text x={pad.l} y={H - 6} fontSize={10} fill="var(--muted)">
          {points[0].date?.slice(0, 4) ?? points[0].label.slice(0, 12)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize={10} fill="var(--muted)">
          {points.at(-1)!.date?.slice(0, 4) ?? points.at(-1)!.label.slice(0, 12)}
        </text>
      </svg>
    </figure>
  );
}
