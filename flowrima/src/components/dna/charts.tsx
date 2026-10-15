/**
 * DNA visuals (pure SVG/HTML, server-rendered, theme-aware via CSS variables).
 * Following the dataviz method: single-series marks use --chart-1 (accent
 * step validated ≥ 3:1 on both surfaces), hairline solid grid, values always
 * available as text next to the chart (no colour-only / tooltip-only reading).
 */
import { cn } from "@/lib/utils";

/** Radar of theme weights (4–8 axes) + the same data as a ranked list. */
export function ThemesRadar({ themes }: { themes: Array<{ name: string; weight: number }> }) {
  const data = themes.slice(0, 8);
  if (data.length < 3) return <ThemeBars themes={data} />;
  const size = 300;
  const c = size / 2;
  const r = 100;
  // Side padding so axis labels ("L'ambition", "Solitude"…) are never clipped.
  const padX = 80;
  const padY = 12;
  const angle = (i: number) => (Math.PI * 2 * i) / data.length - Math.PI / 2;
  const point = (i: number, v: number) => [c + Math.cos(angle(i)) * r * v, c + Math.sin(angle(i)) * r * v] as const;
  const polygon = data.map((t, i) => point(i, Math.max(0.04, t.weight)).join(",")).join(" ");
  return (
    <figure className="space-y-4">
      <svg
        viewBox={`${-padX} ${-padY} ${size + padX * 2} ${size + padY * 2}`}
        role="img"
        aria-labelledby="radar-title"
        className="mx-auto w-full max-w-[420px]"
      >
        <title id="radar-title">Radar des thèmes : {data.map((t) => `${t.name} ${Math.round(t.weight * 100)} %`).join(", ")}</title>
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <polygon
            key={k}
            points={data.map((_, i) => point(i, k).join(",")).join(" ")}
            fill="none"
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}
        {data.map((_, i) => {
          const [x, y] = point(i, 1);
          return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />;
        })}
        <polygon points={polygon} fill="var(--chart-1)" fillOpacity={0.16} stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" />
        {data.map((t, i) => {
          const [x, y] = point(i, Math.max(0.04, t.weight));
          return <circle key={i} cx={x} cy={y} r={4} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />;
        })}
        {data.map((t, i) => {
          const [x, y] = point(i, 1.14);
          const anchor = Math.abs(x - c) < 8 ? "middle" : x > c ? "start" : "end";
          return (
            <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize={12} fill="var(--muted)">
              {t.name.length > 18 ? `${t.name.slice(0, 17)}…` : t.name}
            </text>
          );
        })}
      </svg>
      <figcaption>
        <ThemeBars themes={data} />
      </figcaption>
    </figure>
  );
}

/** Ranked horizontal bars (also the table twin of the radar). */
export function ThemeBars({ themes, unit = "%" }: { themes: Array<{ name: string; weight: number }>; unit?: string }) {
  return (
    <ul className="space-y-3">
      {themes.map((t) => (
        <li key={t.name} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">{t.name}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {Math.round(t.weight * 100)}
              {unit === "%" ? " %" : ""}
            </span>
          </div>
          <span className="mt-1 block h-2 rounded-full bg-surface-2" aria-hidden>
            <span className="block h-2 rounded-full bg-chart-1" style={{ width: `${Math.round(t.weight * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Word cloud: size encodes frequency (one hue); signature words are the
 * emphasis (accent), frequent words stay neutral. Counts are in the label.
 */
export function WordCloud({
  signature,
  frequent,
}: {
  signature: Array<{ word: string; count: number }>;
  frequent: Array<[string, number]>;
}) {
  const sig = new Set(signature.map((s) => s.word));
  const words = [
    ...signature.map((s) => ({ word: s.word, count: s.count, signature: true })),
    ...frequent.filter(([w]) => !sig.has(w)).slice(0, 25).map(([word, count]) => ({ word, count, signature: false })),
  ];
  if (!words.length) return <p className="text-sm text-muted">Pas assez de texte.</p>;
  const max = Math.max(...words.map((w) => w.count));
  const min = Math.min(...words.map((w) => w.count));
  const size = (n: number) => 0.85 + (max === min ? 0.5 : ((n - min) / (max - min)) * 1.35);
  // Stable, interleaved order (big words spread across the cloud)
  const ordered = [...words].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  const interleaved = ordered.map((_, i) => ordered[i % 2 === 0 ? i / 2 : ordered.length - 1 - (i - 1) / 2]);
  return (
    <ul className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 py-2" aria-label="Nuage de mots">
      {interleaved.map((w) => (
        <li
          key={w.word}
          style={{ fontSize: `${size(w.count)}rem` }}
          className={cn("leading-tight", w.signature ? "font-semibold text-accent-text" : "text-muted")}
          title={`${w.word} : ${w.count} occurrence(s)${w.signature ? " — mot signature" : ""}`}
        >
          {w.word}
          <span className="sr-only"> ({w.count})</span>
        </li>
      ))}
    </ul>
  );
}

/** Reliability as a meter (not a gauge dial). */
export function ReliabilityMeter({ score, label }: { score: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">Fiabilité de l&apos;ADN</span>
        <span className="text-2xl font-bold">
          {score}
          <span className="text-sm font-normal text-muted">/100 · {label}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Fiabilité de l'ADN"
        className="h-2.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-chart-1" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
