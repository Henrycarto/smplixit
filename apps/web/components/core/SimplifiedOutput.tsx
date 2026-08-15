"use client";

import type { SimplifyResponse } from "@smplixit/shared-types";

import { Panel } from "@/components/ui/Panel";
import { StatusPill, statusLabel, statusTone } from "@/components/ui/StatusPill";
import { cn } from "@/components/ui/cn";

interface SimplifiedOutputProps {
  result: SimplifyResponse | null;
  /** Translated text replaces the English body when a language is selected. */
  translatedText?: string | null;
  rtl?: boolean;
  loading: boolean;
  error?: string | null;
}

/**
 * Right pane: the patient-facing text.
 *
 * A held document still shows its text. Hiding the output on a review hold
 * would leave the clinician nothing to review, which is the opposite of what
 * a hold is for. The status strip above the text carries the reason instead.
 */
export function SimplifiedOutput({
  result,
  translatedText,
  rtl,
  loading,
  error,
}: SimplifiedOutputProps) {
  const body = translatedText ?? result?.simplified_text ?? "";

  return (
    <Panel
      title={translatedText ? "Patient instructions (translated)" : "Patient instructions"}
      className="min-h-0"
      bodyClassName="flex min-h-0 flex-col"
      meta={
        result ? (
          <>
            <StatusPill tone={statusTone(result.status)}>{statusLabel(result.status)}</StatusPill>
            <span className="tabular">{result.duration_ms.toLocaleString()} ms</span>
            <span className="tabular">
              {result.attempts.length} pass{result.attempts.length === 1 ? "" : "es"}
            </span>
          </>
        ) : null
      }
    >
      {result && result.review_reasons.length > 0 ? (
        <div className="shrink-0 border-b border-caution/40 bg-caution-muted px-3 py-2">
          <span className="text-2xs font-semibold uppercase tracking-label text-caution-text">
            Held for clinician review
          </span>
          <ul className="mt-1 space-y-0.5">
            {result.review_reasons.map((reason, index) => (
              <li key={index} className="text-xs leading-snug text-caution-text">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel-scroll min-h-0 flex-1 overflow-auto">
        {loading ? (
          <SkeletonBody />
        ) : error ? (
          <div className="px-3 py-2.5">
            <span className="text-2xs font-semibold uppercase tracking-label text-danger-text">
              Rewrite failed
            </span>
            <p className="mt-1 text-sm leading-snug text-slate-ink">{error}</p>
          </div>
        ) : body ? (
          <pre
            dir={rtl ? "rtl" : "ltr"}
            className={cn(
              "whitespace-pre-wrap px-3 py-2.5 font-sans text-base leading-relaxed text-slate-ink",
              rtl && "text-right",
            )}
          >
            {body}
          </pre>
        ) : (
          <p className="px-3 py-2.5 text-sm text-slate">
            The rewritten instructions appear here.
          </p>
        )}
      </div>

      {result && result.difficult_terms_removed.length > 0 && !translatedText ? (
        <div className="shrink-0 border-t border-panel-border bg-panel-muted px-3 py-1.5">
          <span className="label-micro">
            Clinical terms removed ({result.difficult_terms_removed.length})
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {result.difficult_terms_removed.slice(0, 10).map((term) => (
              <span
                key={term.term}
                className="border border-panel-border bg-panel px-1.5 py-0.5 font-mono text-2xs text-slate-dark line-through"
              >
                {term.term}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function SkeletonBody() {
  // Fixed widths rather than random ones, so the placeholder does not shift
  // between renders and read as a glitch.
  const widths = ["92%", "78%", "85%", "64%", "88%", "71%", "80%", "58%"];
  return (
    <div className="space-y-2 px-3 py-2.5" aria-label="Rewriting" role="status">
      {widths.map((width, index) => (
        <div key={index} className="h-3 animate-pulse bg-panel-muted" style={{ width }} />
      ))}
    </div>
  );
}
