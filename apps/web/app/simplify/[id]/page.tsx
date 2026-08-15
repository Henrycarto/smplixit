"use client";

import type { SimplifyResponse, ValidateResponse } from "@smplixit/shared-types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BeforeAfterPanel } from "@/components/core/BeforeAfterPanel";
import { SimplifiedOutput } from "@/components/core/SimplifiedOutput";
import { DrugWarningPanel } from "@/components/guard/DrugWarningPanel";
import { SafetyScoreIndicator } from "@/components/guard/SafetyScoreIndicator";
import { Panel } from "@/components/ui/Panel";
import { StatusPill, statusLabel, statusTone } from "@/components/ui/StatusPill";
import { core, guard } from "@/lib/api";

/**
 * Read-only view of a stored job.
 *
 * This is the screen a compliance officer opens when asked what a specific
 * patient was handed. It is deliberately not editable: reopening a released
 * document for edit would break the audit chain between what was validated and
 * what was printed.
 */
export default function JobDetailPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<SimplifyResponse | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await core.getJob(params.id);
        if (cancelled) return;
        setJob(response);

        // Guard holds recent verdicts in process memory only, so this is a best
        // effort lookup. The durable record is the audit trail in Core.
        try {
          const detail = await guard.getValidation(params.id);
          if (!cancelled) setValidation(detail);
        } catch {
          if (!cancelled) setValidation(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load this job");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return (
      <main className="p-3">
        <div className="h-24 animate-pulse border border-shell-border bg-shell-raised" />
      </main>
    );
  }

  if (error || !job) {
    return (
      <main className="p-3">
        <div className="border border-danger bg-danger-muted px-4 py-3">
          <span className="text-2xs font-semibold uppercase tracking-label text-danger-text">
            Job not found
          </span>
          <p className="mt-1 text-sm text-danger-text">{error}</p>
          <Link
            href="/dashboard"
            className="mt-2 inline-block text-xs text-danger-text underline underline-offset-2"
          >
            Back to job history
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="panel-scroll flex h-full min-h-0 flex-col overflow-auto">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-shell-border bg-shell-raised px-3 py-2">
        <Link href="/dashboard" className="text-xs text-slate hover:text-white">
          Job history
        </Link>
        <span className="text-slate-dark">/</span>
        <span className="font-mono text-xs text-white">{job.job_id}</span>
        <StatusPill tone={statusTone(job.status)}>{statusLabel(job.status)}</StatusPill>
        <span className="tabular ml-auto text-2xs text-slate">
          {new Date(job.created_at).toLocaleString()}
        </span>
      </div>

      <div className="shrink-0 px-3 pt-3">
        <BeforeAfterPanel result={job} sourceScore={null} targetGrade={job.target_grade} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_360px]">
        <Panel
          title="Clinical source"
          bodyClassName="min-h-0 overflow-auto panel-scroll"
          meta={<span className="tabular">{job.original_text.length.toLocaleString()} chars</span>}
        >
          <pre className="whitespace-pre-wrap px-3 py-2.5 font-mono text-sm leading-relaxed text-slate-ink">
            {job.original_text}
          </pre>
        </Panel>

        <SimplifiedOutput result={job} loading={false} />

        <aside className="flex min-h-0 flex-col gap-3">
          <SafetyScoreIndicator guard={job.guard} unavailable={!job.guard} />

          {job.attempts.length > 0 ? (
            <Panel title="Rewrite passes" meta={`${job.attempts.length}`}>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-panel-border bg-panel-muted">
                    <th className="px-3 py-1 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      Pass
                    </th>
                    <th className="px-3 py-1 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      SMOG
                    </th>
                    <th className="px-3 py-1 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      F-K
                    </th>
                    <th className="px-3 py-1 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {job.attempts.map((attempt) => (
                    <tr key={attempt.attempt} className="border-b border-panel-border">
                      <td className="px-3 py-1 text-xs text-slate-ink">{attempt.attempt}</td>
                      <td className="px-3 py-1 text-xs text-slate-dark">
                        {attempt.resulting_level.smog.toFixed(1)}
                      </td>
                      <td className="px-3 py-1 text-xs text-slate-dark">
                        {attempt.resulting_level.flesch_kincaid.toFixed(1)}
                      </td>
                      <td className="px-3 py-1 text-xs">
                        <span
                          className={
                            attempt.accepted ? "text-accent-text" : "text-caution-text"
                          }
                        >
                          {attempt.accepted ? "accepted" : "rejected"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : (
            <Panel title="Rewrite passes">
              <p className="px-3 py-2.5 text-xs leading-snug text-slate-dark">
                Per-pass detail is held in the audit trail rather than on the job record.
                Query the audit_events table for job {job.job_id.slice(0, 8)} to reconstruct
                every attempt, including rejected ones.
              </p>
            </Panel>
          )}

          <DrugWarningPanel validation={validation} />
        </aside>
      </div>
    </main>
  );
}
