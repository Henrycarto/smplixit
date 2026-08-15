"use client";

import type { ScoreResponse } from "@smplixit/shared-types";
import { useEffect, useRef, useState } from "react";

import { core } from "@/lib/api";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";

interface DischargeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Reports the live source score up to the parent for the badge. */
  onScored?: (score: ScoreResponse | null) => void;
  targetGrade: number;
}

const DEBOUNCE_MS = 600;

/**
 * Left pane: the raw clinical text.
 *
 * Scores as the clinician pastes. The grade appears before anyone spends a
 * model call, which is what makes the tool feel like an instrument rather than
 * a form: you paste a discharge summary and it immediately tells you the
 * document is written at grade 16.
 */
export function DischargeInput({
  value,
  onChange,
  disabled,
  onScored,
  targetGrade,
}: DischargeInputProps) {
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [scoring, setScoring] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const text = value.trim();
    if (text.length < 40) {
      setScore(null);
      onScored?.(null);
      return;
    }

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setScoring(true);
      try {
        const result = await core.score({ text, target_grade: targetGrade });
        // Drop the response if a newer keystroke already fired. Without this
        // guard a slow early request overwrites a fast later one.
        if (id !== requestId.current) return;
        setScore(result);
        onScored?.(result);
      } catch {
        if (id !== requestId.current) return;
        setScore(null);
        onScored?.(null);
      } finally {
        if (id === requestId.current) setScoring(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // onScored is a parent callback and is intentionally excluded. Including it
    // would re-run scoring on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, targetGrade]);

  const characters = value.length;
  const words = score?.level.word_count ?? 0;

  return (
    <Panel
      title="Clinical source"
      className="min-h-0"
      bodyClassName="flex min-h-0 flex-col"
      meta={
        <>
          <span className="tabular">{characters.toLocaleString()} chars</span>
          {words > 0 ? <span className="tabular">{words.toLocaleString()} words</span> : null}
          {scoring ? <span className="text-accent-text">scoring</span> : null}
        </>
      }
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        spellCheck={false}
        placeholder="Paste the discharge summary, or load it from the patient chart."
        className={cn(
          "panel-scroll min-h-0 flex-1 resize-none border-0 bg-panel px-3 py-2.5",
          "font-mono text-sm leading-relaxed text-slate-ink",
          "placeholder:font-sans placeholder:text-slate",
          "focus:outline-none disabled:bg-panel-muted disabled:text-slate-dark",
        )}
      />

      <SourceMetrics score={score} targetGrade={targetGrade} />
    </Panel>
  );
}

function SourceMetrics({
  score,
  targetGrade,
}: {
  score: ScoreResponse | null;
  targetGrade: number;
}) {
  if (!score) {
    return (
      <div className="shrink-0 border-t border-panel-border bg-panel-muted px-3 py-1.5 text-2xs text-slate-dark">
        Paste at least 40 characters to measure the reading level.
      </div>
    );
  }

  const { level } = score;
  const gap = Math.max(0, level.consensus_grade - targetGrade);

  return (
    <div className="shrink-0 border-t border-panel-border bg-panel-muted">
      <dl className="tabular grid grid-cols-4 divide-x divide-panel-border">
        <Metric label="SMOG" value={level.smog.toFixed(1)} />
        <Metric label="Flesch-Kincaid" value={level.flesch_kincaid.toFixed(1)} />
        <Metric label="Avg sentence" value={`${level.avg_sentence_length.toFixed(0)} w`} />
        <Metric
          label="Above target"
          value={`+${gap.toFixed(1)}`}
          tone={gap > 0 ? "danger" : "accent"}
        />
      </dl>
      {score.difficult_terms.length > 0 ? (
        <div className="border-t border-panel-border px-3 py-1.5">
          <span className="label-micro">Driving the grade</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {score.difficult_terms.slice(0, 8).map((term) => (
              <span
                key={term.term}
                title={
                  term.plain_language_suggestion
                    ? `Suggested: ${term.plain_language_suggestion}`
                    : `${term.syllables} syllables, ${term.occurrences} occurrences`
                }
                className="border border-panel-border bg-panel px-1.5 py-0.5 font-mono text-2xs text-slate-ink"
              >
                {term.term}
                <span className="ml-1 text-slate">{term.syllables}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "danger";
}) {
  return (
    <div className="px-3 py-1.5">
      <dt className="label-micro">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm font-semibold",
          tone === "danger" && "text-danger-text",
          tone === "accent" && "text-accent-text",
          tone === "default" && "text-slate-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
