"use client";

import type { JobSummary } from "@smplixit/shared-types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ReadingLevelBadge } from "@/components/core/ReadingLevelBadge";
import { Panel } from "@/components/ui/Panel";
import { StatusPill, statusLabel, statusTone } from "@/components/ui/StatusPill";
import { cn } from "@/components/ui/cn";
import { core, serviceStatus } from "@/lib/api";

/**
 * Job history.
 *
 * The table is the screen. A held job and a released job sit in the same list
 * so the review queue is visible without a filter, and the aggregate strip
 * above it answers the question a CFO actually asks: across everything we ran
 * this period, how many grades did we remove and how many documents did the
 * safety check stop.
 */
export default function DashboardPage() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [services, setServices] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [jobResult, statusResult] = await Promise.allSettled([
        core.listJobs(100),
        serviceStatus(),
      ]);
      if (cancelled) return;

      if (jobResult.status === "fulfilled") {
        setJobs(jobResult.value);
        setError(null);
      } else {
        setError(
          jobResult.reason instanceof Error
            ? jobResult.reason.message
            : "Could not load job history",
        );
      }

      if (statusResult.status === "fulfilled") setServices(statusResult.value);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const held = jobs.filter((job) => job.status === "needs_review").length;
  const averageReduction =
    jobs.length > 0
      ? jobs.reduce((sum, job) => sum + (job.original_grade - job.simplified_grade), 0) / jobs.length
      : 0;
  const scored = jobs.filter((job) => job.safety_score !== null);
  const averageSafety =
    scored.length > 0
      ? scored.reduce((sum, job) => sum + (job.safety_score ?? 0), 0) / scored.length
      : null;

  return (
    <main className="panel-scroll flex h-full min-h-0 flex-col overflow-auto p-3">
      <div className="grid shrink-0 grid-cols-2 gap-px border border-shell-border bg-shell-border lg:grid-cols-4">
        <Stat label="Documents processed" value={jobs.length.toString()} />
        <Stat
          label="Average grade reduction"
          value={averageReduction > 0 ? averageReduction.toFixed(1) : "--"}
          tone="accent"
        />
        <Stat
          label="Held for review"
          value={held.toString()}
          tone={held > 0 ? "danger" : "default"}
        />
        <Stat
          label="Average safety score"
          value={averageSafety !== null ? averageSafety.toFixed(0) : "--"}
        />
      </div>

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
        <Panel
          title="Rewrite jobs"
          meta={loading ? "loading" : `${jobs.length} shown`}
          bodyClassName="min-h-0 overflow-auto panel-scroll"
        >
          {error ? (
            <div className="px-3 py-2.5">
              <span className="text-2xs font-semibold uppercase tracking-label text-danger-text">
                History unavailable
              </span>
              <p className="mt-1 text-sm text-slate-dark">{error}</p>
              <p className="mt-1 text-xs text-slate">
                Rewrites still run. Only the durable history is affected.
              </p>
            </div>
          ) : jobs.length === 0 && !loading ? (
            <div className="px-3 py-2.5">
              <p className="text-sm text-slate-dark">No jobs yet.</p>
              <Link
                href="/simplify"
                className="mt-1 inline-block text-xs text-accent-text underline underline-offset-2"
              >
                Run the first rewrite
              </Link>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-panel-muted">
                <tr className="border-b border-panel-border">
                  <Th>Job</Th>
                  <Th>Patient</Th>
                  <Th>Reading level</Th>
                  <Th className="text-right">Target</Th>
                  <Th className="text-right">Safety</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Created</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.job_id}
                    className="border-b border-panel-border transition-colors hover:bg-panel-muted"
                  >
                    <Td>
                      <Link
                        href={`/simplify/${job.job_id}`}
                        className="font-mono text-2xs text-accent-text underline underline-offset-2"
                      >
                        {job.job_id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td>
                      <span className="font-mono text-2xs text-slate-dark">
                        {job.patient_id ?? "no chart"}
                      </span>
                    </Td>
                    <Td>
                      <ReadingLevelBadge
                        size="compact"
                        from={job.original_grade}
                        to={job.simplified_grade}
                        target={job.target_grade}
                      />
                    </Td>
                    <Td className="tabular text-right">{job.target_grade}</Td>
                    <Td className="tabular text-right">
                      {job.safety_score !== null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            job.safety_score >= 90 ? "text-accent-text" : "text-danger-text",
                          )}
                        >
                          {job.safety_score.toFixed(0)}
                        </span>
                      ) : (
                        <span className="text-slate">--</span>
                      )}
                    </Td>
                    <Td>
                      <StatusPill tone={statusTone(job.status)}>
                        {statusLabel(job.status)}
                      </StatusPill>
                    </Td>
                    <Td className="tabular text-right text-2xs text-slate-dark">
                      {new Date(job.created_at).toLocaleString()}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Services" tone="dark">
          <dl className="divide-y divide-shell-border">
            {(["core", "poly", "guard"] as const).map((service) => (
              <div key={service} className="flex items-center justify-between px-3 py-2">
                <dt className="text-xs capitalize text-slate">{service}</dt>
                <dd className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5",
                      services[service] ? "bg-accent" : "bg-danger",
                    )}
                  />
                  <span
                    className={cn(
                      "text-2xs uppercase tracking-label",
                      services[service] ? "text-accent" : "text-danger",
                    )}
                  >
                    {services[service] ? "up" : "down"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "danger";
}) {
  return (
    <div className="bg-shell-raised px-4 py-3">
      <span className="label-micro">{label}</span>
      <div
        className={cn(
          "tabular mt-1 text-3xl font-semibold leading-none tracking-tight",
          tone === "accent" && "text-accent",
          tone === "danger" && "text-danger",
          tone === "default" && "text-white",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-1.5 text-2xs font-semibold uppercase tracking-label text-slate-dark",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-1.5 text-sm text-slate-ink", className)}>{children}</td>;
}
