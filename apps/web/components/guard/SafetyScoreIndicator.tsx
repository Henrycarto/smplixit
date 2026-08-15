import type { GuardSummary } from "@smplixit/shared-types";

import { cn } from "@/components/ui/cn";

interface SafetyScoreIndicatorProps {
  guard: GuardSummary | null;
  /** Guard could not be reached. Distinct from a failing score. */
  unavailable?: boolean;
  className?: string;
}

/**
 * Guard verdict at a glance.
 *
 * The score and the verdict are separate readings on purpose. A document can
 * score 94 and still be blocked by one critical finding, so the pass or fail
 * word is what the strip leads with and the number is supporting evidence. A
 * UI that showed the number alone would invite somebody to argue a 94 into
 * release.
 */
export function SafetyScoreIndicator({
  guard,
  unavailable,
  className,
}: SafetyScoreIndicatorProps) {
  if (unavailable || !guard) {
    return (
      <div
        className={cn(
          "flex items-center justify-between border border-caution/50 bg-caution-muted px-3 py-2",
          className,
        )}
      >
        <div>
          <span className="text-2xs font-semibold uppercase tracking-label text-caution-text">
            Drug safety not verified
          </span>
          <p className="mt-0.5 text-xs text-caution-text">
            This document must not be released to a patient until validation runs.
          </p>
        </div>
      </div>
    );
  }

  const failed = !guard.passed;

  return (
    <div
      className={cn(
        "border",
        failed ? "border-danger bg-danger-muted" : "border-accent/40 bg-panel",
        className,
      )}
    >
      <div className="flex items-stretch">
        <div
          className={cn(
            "flex w-20 shrink-0 flex-col items-center justify-center border-r px-2 py-2",
            failed ? "border-danger/40 bg-danger text-white" : "border-accent/30 bg-accent text-white",
          )}
        >
          <span className="tabular text-2xl font-semibold leading-none">
            {guard.safety_score.toFixed(0)}
          </span>
          <span className="mt-0.5 text-2xs font-semibold uppercase tracking-label opacity-80">
            Safety
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
          <span
            className={cn(
              "text-2xs font-semibold uppercase tracking-label",
              failed ? "text-danger-text" : "text-accent-text",
            )}
          >
            {failed ? "Blocked, do not release" : "Medication check passed"}
          </span>
          <p className="mt-0.5 text-xs text-slate-dark">
            {guard.drugs_in_source} drug{guard.drugs_in_source === 1 ? "" : "s"} in source,{" "}
            {guard.drugs_in_output} in output.{" "}
            {failed
              ? `${guard.critical_findings} critical finding${guard.critical_findings === 1 ? "" : "s"}.`
              : guard.warning_findings > 0
                ? `${guard.warning_findings} advisory finding${guard.warning_findings === 1 ? "" : "s"}.`
                : "No discrepancies found."}
          </p>
        </div>
      </div>
    </div>
  );
}
