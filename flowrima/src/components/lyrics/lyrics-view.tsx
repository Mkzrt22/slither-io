import { renderSections, type RenderedLine, type Segment } from "@/lib/text/render";
import { sectionUsesTarget } from "@/lib/text/flow";
import { cn } from "@/lib/utils";

export function SegmentView({ seg }: { seg: Segment }) {
  if (seg.kind === "rhyme")
    return (
      <span className="rhyme" style={{ ["--rhyme-color" as string]: `var(--rhyme-${seg.colorIndex})` }}>
        {seg.text}
      </span>
    );
  if (seg.kind === "adlib") return <span className="italic text-muted">{seg.text}</span>;
  if (seg.kind === "breath")
    return (
      <span className="mx-0.5 font-semibold text-accent-text" title="Respiration" aria-label="respiration">
        /
      </span>
    );
  return <>{seg.text}</>;
}

export function SyllableBadge({ line, target }: { line: Pick<RenderedLine, "syllables" | "min" | "max">; target?: { min: number; max: number } }) {
  const off = target && (line.syllables < target.min || line.syllables > target.max);
  return (
    <span
      className={cn(
        "inline-flex min-w-7 justify-center rounded-md px-1 font-mono text-xs tabular-nums",
        off ? "bg-warning/15 text-warning" : "text-muted",
      )}
      title={`${line.syllables} syllabes (${line.min}–${line.max} selon les élisions)`}
      aria-label={`${line.syllables} syllabes`}
    >
      {line.syllables}
    </span>
  );
}

export function RhymeLetter({ family, colorIndex }: { family: string | null; colorIndex: number | null }) {
  if (!family) return <span className="inline-block w-5" aria-hidden />;
  return (
    <span
      className="inline-flex w-5 justify-center rounded font-mono text-xs font-bold"
      style={{ color: `var(--rhyme-${colorIndex})` }}
      title={`Famille de rimes ${family}`}
      aria-label={`rime ${family}`}
    >
      {family}
    </span>
  );
}

/**
 * Read-only lyrics with syllables in the margin, rhymes coloured by family
 * (letter shown too, colour is never the only signal), ad-libs and breaths.
 */
export function LyricsView({
  sections,
  target,
  showFlow = true,
  className,
}: {
  sections: Array<{ label: string; type?: string; flow?: { pace: string; notes: string }; lines: string[] }>;
  target?: { min: number; max: number };
  showFlow?: boolean;
  className?: string;
}) {
  const rendered = renderSections(sections);
  return (
    <div className={cn("lyrics space-y-5", className)}>
      {rendered.map((s, si) => (
        <section key={si} aria-label={s.label}>
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-accent-text">[{s.label}]</h3>
            {showFlow && s.flow && (
              <span className="text-xs text-muted">
                débit {s.flow.pace}
                {s.flow.notes ? ` · ${s.flow.notes}` : ""}
              </span>
            )}
          </div>
          <ol className="space-y-0.5">
            {s.lines.map((l, li) => (
              <li key={li} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-2">
                <span className="min-w-0 break-words">
                  {l.segments.map((seg, k) => (
                    <SegmentView key={k} seg={seg} />
                  ))}
                </span>
                <SyllableBadge line={l} target={sectionUsesTarget(s.type) ? target : undefined} />
                <RhymeLetter family={l.family} colorIndex={l.colorIndex} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
