"use client";

import type { ScoreResponse, SimplifyResponse } from "@smplixit/shared-types";

import { ReadingLevelBadge } from "./ReadingLevelBadge";
import { cn } from "@/components/ui/cn";

interface BeforeAfterPanelProps {
  result: SimplifyResponse | null;
  /** Live source score, shown before a rewrite has been run. */
  sourceScore: ScoreResponse | null;
  targetGrade: number;
}

/**
 * The strip that sits above the two-column split.
 *
 * Before a rewrite runs it shows the source grade alone, which is already the
 * argument: a document written at grade 16 is not readable by the population it
 * was handed to. After a rewrite it becomes the before and after.
 */
export function BeforeAfterPanel({
  result,
  sourceScore,
  targetGrade,
}: BeforeAfterPanelProps) {
  if (result) {
    return (
      <div className="grid grid-cols-1 border border-panel-border bg-panel lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="px-4 py-3">
          <ReadingLevelBadge
            from={result.original_level.consensus_grade}
            to={result.simplified_level.consensus_grade}
            target={result.target_grade}
          />
        </div>

        <dl className="tabular grid grid-cols-2 border-t border-panel-border lg:grid-cols-1 lg:border-l lg:border-t-0">
          <Cell
            label="SMOG"
            before={result.original_level.smog}
            after={result.simplified_level.smog}
            target={targetGrade}
          />
          <Cell
            label="Flesch-Kincaid"
            before={result.original_level.flesch_kincaid}
            after={result.simplified_level.flesch_kincaid}
            target={targetGrade}
          />
        </dl>
      </div>
    );
  }

  const grade = sourceScore?.level.consensus_grade;

  return (
    <div className="flex items-center justify-between border border-panel-border bg-panel px-4 py-3">
      <div>
        <span className="label-micro">Source reading level</span>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="tabular text-4xl font-semibold leading-none tracking-tight text-slate-ink">
            {grade !== undefined ? grade.toFixed(1) : "--"}
          </span>
          <span className="text-xs text-slate">
            {grade !== undefined
              ? `grade level, target is ${targetGrade}`
              : "paste a discharge summary to measure"}
          </span>
        </div>
      </div>

      {grade !== undefined ? (
        <div className="text-right">
          <span className="label-micro">Reduction required</span>
          <div className="tabular mt-0.5 text-2xl font-semibold leading-none text-danger-text">
            {Math.max(0, grade - targetGrade).toFixed(1)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Cell({
  label,
  before,
  after,
  target,
}: {
  label: string;
  before: number;
  after: number;
  target: number;
}) {
  const met = after <= target + 0.5;
  return (
    <div className="flex items-center justify-between border-b border-panel-border px-4 py-2 last:border-b-0">
      <dt className="label-micro">{label}</dt>
      <dd className="flex items-baseline gap-1.5 text-sm">
        <span className="text-slate-dark">{before.toFixed(1)}</span>
        <span className="text-slate">to</span>
        <span className={cn("font-semibold", met ? "text-accent-text" : "text-caution-text")}>
          {after.toFixed(1)}
        </span>
      </dd>
    </div>
  );
}
