import { cn } from "@/components/ui/cn";

interface ReadingLevelBadgeProps {
  /** Consensus grade of the source text. */
  from: number;
  /** Consensus grade of the rewrite. */
  to: number;
  /** Target grade the rewrite was asked to hit. */
  target: number;
  size?: "full" | "compact";
  className?: string;
}

/**
 * The signature element.
 *
 * One claim, stated as two numbers and the distance between them: this document
 * was written at grade 16 and a patient now reads it at grade 5. Everything
 * else on the screen supports that claim.
 *
 * Design notes, because each of these was a decision and not a default:
 *
 *  - The numerals are the largest type in the product and are tabular, so the
 *    two figures align on the decimal and the eye reads the gap directly.
 *  - The bar underneath is filled to the fraction of grades removed, measured
 *    against the source grade. A drop from 16 to 5 fills 69 percent. It is a
 *    proportion of work done, not a progress indicator, so it never animates
 *    and never sits at an arbitrary width.
 *  - The target tick is drawn on the bar. A rewrite that missed the target
 *    shows the gap between the fill and the tick, which is the honest way to
 *    display a miss and the reason the console does not need a separate
 *    "did it work" indicator.
 *  - Teal marks the achieved reduction. When the target was missed the fill
 *    turns amber, because a badge that stays teal on a failed rewrite is a
 *    badge that lies to a compliance officer.
 */
export function ReadingLevelBadge({
  from,
  to,
  target,
  size = "full",
  className,
}: ReadingLevelBadgeProps) {
  const reduction = Math.max(0, from - to);
  const metTarget = to <= target + 0.5;

  // Guard against a zero or inverted source grade, which would make the
  // fraction meaningless rather than merely small.
  const span = from > 0 ? Math.min(1, reduction / from) : 0;
  const targetMark = from > 0 ? Math.min(1, Math.max(0, (from - target) / from)) : 0;

  if (size === "compact") {
    return (
      <span className={cn("tabular inline-flex items-baseline gap-1 text-sm", className)}>
        <span className="text-slate-dark">{from.toFixed(1)}</span>
        <span className="text-slate">to</span>
        <span className={cn("font-semibold", metTarget ? "text-accent-text" : "text-caution-text")}>
          {to.toFixed(1)}
        </span>
      </span>
    );
  }

  return (
    <div className={cn("tabular select-none", className)}>
      <div className="flex items-end justify-between gap-6">
        <Figure label="Source" value={from} tone="muted" />

        <div className="mb-2 flex flex-1 items-center gap-2" aria-hidden="true">
          <span className="h-px flex-1 bg-panel-strong" />
          <span className="text-2xs font-semibold uppercase tracking-label text-slate-dark">
            {reduction.toFixed(1)} grades
          </span>
          <span className="h-px flex-1 bg-panel-strong" />
        </div>

        <Figure label="Patient" value={to} tone={metTarget ? "accent" : "caution"} />
      </div>

      <div className="mt-3">
        <div className="relative h-1.5 w-full bg-panel-muted ring-1 ring-inset ring-panel-border">
          <div
            className={cn(
              "absolute inset-y-0 left-0",
              metTarget ? "bg-accent" : "bg-caution",
            )}
            style={{ width: `${span * 100}%` }}
          />
          <div
            className="absolute inset-y-[-3px] w-px bg-slate-ink"
            style={{ left: `${targetMark * 100}%` }}
            title={`Target: grade ${target}`}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-between text-2xs text-slate-dark">
          <span>
            {(span * 100).toFixed(0)}% reduction
          </span>
          <span>
            Target grade {target}
            {metTarget ? " met" : " not met"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "accent" | "caution";
}) {
  const toneClass =
    tone === "accent" ? "text-accent" : tone === "caution" ? "text-caution-text" : "text-slate-ink";

  return (
    <div className="flex flex-col">
      <span className="label-micro">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-1">
        <span className="text-2xs font-medium uppercase tracking-label text-slate">Grade</span>
        <span className={cn("text-4xl font-semibold leading-none tracking-tight", toneClass)}>
          {value.toFixed(1)}
        </span>
      </span>
    </div>
  );
}
